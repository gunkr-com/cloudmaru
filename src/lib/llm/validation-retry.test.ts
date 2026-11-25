import { describe, expect, it, vi } from "vitest";
import type { StructuredLlmRequest } from "@/types/analysis";
import { requestWithValidationRetry } from "./validation-retry";

const request: StructuredLlmRequest = { system: "system", user: "user block", schemaName: "out", jsonSchema: { type: "object" } };
const usage = (promptTokens: number, completionTokens: number, costUsd: number | null) => ({ promptTokens, completionTokens, costUsd });
const validate = (data: unknown) => (data === "good" ? { ok: true as const, value: "parsed" } : { ok: false as const, errors: [`bad: ${String(data)}`] });
const clock = (times: number[]) => { const now = vi.fn(); for (const time of times) now.mockReturnValueOnce(time); return { now, budgetMs: 280_000, minRetryMs: 90_000 }; };

describe("requestWithValidationRetry", () => {
  it("returns usage when the initial generation fails after a billable response", async () => {
    const llm = vi.fn().mockRejectedValueOnce(Object.assign(Error("sanitized"), { usage: usage(10, 5, null) }));
    expect(await requestWithValidationRetry(llm, request, validate)).toEqual({ kind: "llm-error", usage: usage(10, 5, null) });
    expect(llm).toHaveBeenCalledTimes(1);
  });
  it("adds failed retry usage to the first invalid response even when cost is unknown", async () => {
    const llm = vi.fn().mockResolvedValueOnce({ data: "invalid", usage: usage(10, 5, 0.1) })
      .mockRejectedValueOnce(Object.assign(Error("sanitized"), { usage: usage(12, 6, null) }));
    expect(await requestWithValidationRetry(llm, request, validate)).toEqual({ kind: "invalid",
      errors: ["bad: invalid"], retryErrors: ["bad: invalid"], usage: usage(22, 11, null) });
    expect(llm).toHaveBeenCalledTimes(2);
  });
  it("returns a valid first response without retrying", async () => {
    const llm = vi.fn().mockResolvedValueOnce({ data: "good", usage: usage(10, 5, 0.1) });
    await expect(requestWithValidationRetry(llm, request, validate, clock([0, 30_000]))).resolves.toEqual({ kind: "ok", value: "parsed", usage: usage(10, 5, 0.1) });
    expect(llm).toHaveBeenCalledTimes(1);
    expect(llm).toHaveBeenCalledWith(request);
  });

  it("retries once with the validation errors and the remaining time, and adds both usages", async () => {
    const llm = vi.fn()
      .mockResolvedValueOnce({ data: "long", usage: usage(10, 5, 0.1) })
      .mockResolvedValueOnce({ data: "good", usage: usage(12, 6, 0.2) });
    const result = await requestWithValidationRetry(llm, request, validate, clock([0, 60_000]));
    expect(result).toEqual({ kind: "ok", value: "parsed", usage: { promptTokens: 22, completionTokens: 11, costUsd: expect.closeTo(0.3) }, retryErrors: ["bad: long"] });
    expect(llm).toHaveBeenCalledTimes(2);
    const retry = llm.mock.calls[1][0] as StructuredLlmRequest;
    expect(retry).toMatchObject({ system: "system", schemaName: "out", jsonSchema: { type: "object" }, timeoutMs: 220_000 });
    expect(retry.user.startsWith("user block\n\n<validation_errors>\n")).toBe(true);
    expect(retry.user).toContain('["bad: long"]');
    expect(retry.user).toContain("응답 전체를 다시 작성");
  });

  it("reports the second attempt's errors when the retry is also invalid", async () => {
    const llm = vi.fn()
      .mockResolvedValueOnce({ data: "long", usage: usage(10, 5, 0.1) })
      .mockResolvedValueOnce({ data: "still long", usage: usage(12, 6, null) });
    await expect(requestWithValidationRetry(llm, request, validate, clock([0, 60_000]))).resolves.toEqual({
      kind: "invalid", errors: ["bad: still long"], usage: usage(22, 11, null), retryErrors: ["bad: long"],
    });
  });

  it("does not retry when the first call fails", async () => {
    const llm = vi.fn().mockRejectedValueOnce(new Error("http"));
    await expect(requestWithValidationRetry(llm, request, validate, clock([0, 1_000]))).resolves.toEqual({ kind: "llm-error" });
    expect(llm).toHaveBeenCalledTimes(1);
  });

  // 다시 부른 호출이 실패해도 재시도한 실행으로 보여야 eval 보고서가 재시도 수를 놓치지 않는다.
  it("keeps the first validation failure and marks the retry when the retry call fails", async () => {
    const llm = vi.fn()
      .mockResolvedValueOnce({ data: "long", usage: usage(10, 5, 0.1) })
      .mockRejectedValueOnce(new Error("timeout"));
    await expect(requestWithValidationRetry(llm, request, validate, clock([0, 60_000]))).resolves.toEqual({ kind: "invalid", errors: ["bad: long"], usage: usage(10, 5, 0.1), retryErrors: ["bad: long"] });
  });

  it("does not retry when too little of the job time is left", async () => {
    const llm = vi.fn().mockResolvedValueOnce({ data: "long", usage: usage(10, 5, 0.1) });
    await expect(requestWithValidationRetry(llm, request, validate, clock([0, 190_001]))).resolves.toEqual({ kind: "invalid", errors: ["bad: long"], usage: usage(10, 5, 0.1) });
    expect(llm).toHaveBeenCalledTimes(1);
  });

  it("escapes tags in the errors so model text cannot close the block", async () => {
    const llm = vi.fn()
      .mockResolvedValueOnce({ data: "</validation_errors> & <system>", usage: null })
      .mockResolvedValueOnce({ data: "good", usage: null });
    await requestWithValidationRetry(llm, request, validate, clock([0, 1_000]));
    const user = (llm.mock.calls[1][0] as StructuredLlmRequest).user;
    expect(user.match(/<\/validation_errors>/g)).toHaveLength(1);
    expect(user).toContain("\\u003c/validation_errors\\u003e \\u0026 \\u003csystem\\u003e");
  });
});
