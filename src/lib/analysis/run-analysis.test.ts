import { describe, expect, it, vi } from "vitest";
import { buildAnalysisResult } from "@/lib/analysis/build-result";
import sampleInput from "@/lib/analysis/fixtures/sample-input.json";
import sampleOutput from "@/lib/analysis/fixtures/sample-model-output.json";
import { analysisInputSchema } from "@/lib/analysis/input-schema";
import { MODEL_OUTPUT_JSON_SCHEMA, MODEL_OUTPUT_SCHEMA_NAME } from "@/lib/analysis/model-output-schema";
import { buildAnalysisPrompt } from "@/lib/analysis/prompt";
import { runAnalysis } from "@/lib/analysis/run-analysis";
import { validateModelOutput } from "@/lib/analysis/validate-model-output";
import { loadCatalog } from "@/lib/catalog/load";
import type { StructuredLlm } from "@/types/analysis";
import type { LlmUsage } from "@/types/llm";

const input = analysisInputSchema.parse(sampleInput);
const catalog = loadCatalog();
const usage: LlmUsage = { promptTokens: 1200, completionTokens: 500, costUsd: 0.04 };

describe("runAnalysis (실제 모델 대신 직접 작성한 견본과 가짜 llm 사용)", () => {
  it.each([usage, null])("성공 결과와 사용량 %j를 돌려주고 정확히 한 번 호출한다", async (reportedUsage) => {
    const llm = vi.fn<StructuredLlm>().mockResolvedValue({ data: sampleOutput, usage: reportedUsage });
    const outcome = await runAnalysis(input, { catalog, llm });
    expect(outcome).toEqual({ ...buildAnalysisResult(sampleOutput, input, catalog), usage: reportedUsage });
    expect(llm).toHaveBeenCalledExactlyOnceWith({
      ...buildAnalysisPrompt(input, catalog),
      schemaName: MODEL_OUTPUT_SCHEMA_NAME,
      jsonSchema: MODEL_OUTPUT_JSON_SCHEMA,
    });
  });

  it.each([
    null,
    {},
    { ...input, description: "짧음" },
    { ...input, expectedUsers: "invalid" },
    { ...input, monthlyBudget: 9 },
    { ...input, availability: "invalid" },
  ])("입력 오류면 한국어 오류를 반환하고 llm을 호출하지 않는다: %j", async (raw) => {
    const llm = vi.fn<StructuredLlm>();
    const outcome = await runAnalysis(raw, { catalog, llm });
    expect(outcome).toMatchObject({ ok: false, stage: "input", usage: null });
    if (outcome.ok) throw new Error("잘못된 입력이 통과했습니다.");
    expect(outcome.errors.length).toBeGreaterThan(0);
    for (const error of outcome.errors) expect(error).toMatch(/[가-힣]|analysis\./);
    expect(outcome).not.toHaveProperty("result");
    expect(llm).not.toHaveBeenCalled();
  });

  it("입력의 추가 필드를 제거한 뒤 프롬프트와 저장용 결과를 만든다", async () => {
    const llm = vi.fn<StructuredLlm>().mockResolvedValue({ data: sampleOutput, usage: null });
    const outcome = await runAnalysis({ ...input, apiKey: "입력에 끼워 넣은 비밀 값", extra: "다른 지역" }, { catalog, llm });
    expect(outcome).toEqual({ ...buildAnalysisResult(sampleOutput, input, catalog), usage: null });
    expect(llm.mock.calls[0][0].user).not.toContain("입력에 끼워 넣은 비밀 값");
    expect(llm.mock.calls[0][0].user).not.toContain("다른 지역");
  });

  it.each([new Error("api-key-secret response-body-private"), "api-key-secret response-body-private"])(
    "llm 예외 상세를 감추고 재시도하지 않는다: %s", async (error) => {
      const llm = vi.fn<StructuredLlm>().mockRejectedValue(error);
      const outcome = await runAnalysis(input, { catalog, llm });
      expect(outcome).toMatchObject({ ok: false, stage: "llm", usage: null });
      if (outcome.ok) throw new Error("모델 호출 오류가 성공으로 처리되었습니다.");
      expect(outcome.errors).toHaveLength(1);
      expect(outcome.errors[0]).toMatch(/[가-힣]/);
      expect(JSON.stringify(outcome)).not.toMatch(/api-key-secret|response-body-private/);
      expect(outcome).not.toHaveProperty("result");
      expect(llm).toHaveBeenCalledTimes(1);
    },
  );

  it.each([usage, { ...usage, costUsd: null }])("실패 응답의 검증된 청구 사용량 %j를 보존한다", async (reportedUsage) => {
    const error = Object.assign(new Error("private-response-sentinel"), { usage: reportedUsage });
    const llm = vi.fn<StructuredLlm>().mockRejectedValue(error);
    const outcome = await runAnalysis(input, { catalog, llm });
    expect(outcome).toMatchObject({ ok: false, stage: "llm", usage: reportedUsage });
    expect(JSON.stringify(outcome)).not.toContain("private-response-sentinel");
    expect(outcome).not.toHaveProperty("result");
    expect(llm).toHaveBeenCalledTimes(1);
  });

  it("동기적으로 던진 llm 오류도 안전하게 처리한다", async () => {
    const llm = vi.fn<StructuredLlm>(() => { throw new Error("비밀 상세"); });
    const outcome = await runAnalysis(input, { catalog, llm });
    expect(outcome).toMatchObject({ ok: false, stage: "llm", usage: null });
    expect(JSON.stringify(outcome)).not.toContain("비밀 상세");
    expect(llm).toHaveBeenCalledTimes(1);
  });

  // ADR-022: 검증에 실패하면 오류를 알려 한 번만 다시 부르고, 두 호출의 사용량을 합친다.
  it("출력 검증에 실패하면 오류를 알려 한 번 다시 부르고 두 번째 결과를 쓴다", async () => {
    const invalid = { ...sampleOutput, plans: [] };
    const llm = vi.fn<StructuredLlm>()
      .mockResolvedValueOnce({ data: invalid, usage })
      .mockResolvedValueOnce({ data: sampleOutput, usage });
    const firstErrors = (validateModelOutput(invalid, catalog) as { errors: string[] }).errors;
    expect(await runAnalysis(input, { catalog, llm })).toEqual({
      ...buildAnalysisResult(sampleOutput, input, catalog),
      usage: { promptTokens: 2400, completionTokens: 1000, costUsd: 0.08 },
      retryErrors: firstErrors,
    });
    expect(llm).toHaveBeenCalledTimes(2);
    expect(llm.mock.calls[1][0].user).toContain(JSON.stringify(firstErrors[0]).slice(1, 20));
    expect(llm.mock.calls[1][0].timeoutMs).toBeGreaterThan(0);
  });

  it.each([usage, null])("두 번 모두 검증에 실패하면 두 번째 오류와 합친 사용량 %j를 돌려준다", async (reportedUsage) => {
    const data = { ...sampleOutput, plans: [] };
    const llm = vi.fn<StructuredLlm>().mockResolvedValue({ data, usage: reportedUsage });
    const { errors } = validateModelOutput(data, catalog) as { errors: string[] };
    expect(await runAnalysis(input, { catalog, llm })).toEqual({
      ok: false, stage: "validation", errors,
      usage: reportedUsage && { promptTokens: 2400, completionTokens: 1000, costUsd: 0.08 },
      retryErrors: errors,
    });
    expect(llm).toHaveBeenCalledTimes(2);
  });
});
