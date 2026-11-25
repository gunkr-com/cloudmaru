// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import sampleInput from "@/lib/analysis/fixtures/sample-input.json";
import sampleOutput from "@/lib/analysis/fixtures/sample-model-output.json";
const m = vi.hoisted(() => ({ getAnalysis: vi.fn(), getCurrentWorkspace: vi.fn(), createAnalysis: vi.fn(), completeAnalysis: vi.fn(), failAnalysis: vi.fn(), requestStructuredOutput: vi.fn(), acquire: vi.fn(), after: vi.fn(), task: undefined as undefined | (() => Promise<void>) }));
vi.mock("@/services/db/analyses", () => ({ getAnalysis: m.getAnalysis, createAnalysis: m.createAnalysis, completeAnalysis: m.completeAnalysis, failAnalysis: m.failAnalysis })); vi.mock("@/services/claude", () => ({ requestStructuredOutput: m.requestStructuredOutput })); vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), after: m.after }));
vi.mock("@/services/operator-prices", () => ({ acquireOperatorPrices: m.acquire }));
import { loadCatalog } from "@/lib/catalog/load";
vi.mock("@/services/current-workspace", () => ({ getCurrentWorkspace: m.getCurrentWorkspace }));
import { POST } from "./route";
vi.mock("@/services/workspace-claude", () => ({ hasWorkspaceClaudeKey: vi.fn(async () => true), requestAnalysisStructuredOutput: vi.fn((_id, request) => m.requestStructuredOutput(request)) }));
import { hasWorkspaceClaudeKey, requestAnalysisStructuredOutput } from "@/services/workspace-claude";
const id = "123e4567-e89b-42d3-a456-426614174000";
const usage = { promptTokens: 10, completionTokens: 20, costUsd: null };
const post = (input: unknown = sampleInput) => POST(new Request("http://local", { method: "POST", body: JSON.stringify({ input, workspaceId: "workspace" }) }));
beforeEach(() => { vi.clearAllMocks(); m.task = undefined; m.acquire.mockResolvedValue({ ok: true, catalog: loadCatalog() }); m.getCurrentWorkspace.mockResolvedValue({ id: "workspace" }); m.createAnalysis.mockResolvedValue(id); m.completeAnalysis.mockResolvedValue(undefined); m.failAnalysis.mockResolvedValue(undefined); m.requestStructuredOutput.mockResolvedValue({ data: {}, usage: null, model: "m" }); m.after.mockImplementation((task) => { m.task = task; }); });
describe("POST /api/analyses", () => {
  it("returns a sanitized 500 when the key preflight fails unexpectedly", async () => {
    vi.mocked(hasWorkspaceClaudeKey).mockRejectedValueOnce(Error("private-storage-error"));
    const response = await post();
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ message: "analysis.startFailed" });
    expect(m.createAnalysis).not.toHaveBeenCalled();
    expect(m.after).not.toHaveBeenCalled();
  });
  it("returns 409 for a missing company key without a pending analysis", async () => {
    vi.mocked(hasWorkspaceClaudeKey).mockResolvedValueOnce(false);
    const response = await post();
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ errors: ["workspace.claude.unavailable"], workspaceId: "workspace" });
    expect(m.createAnalysis).not.toHaveBeenCalled();
    expect(m.after).not.toHaveBeenCalled();
  });
  it("preflights a cross-workspace rerun against its saved owner", async () => {
    m.getAnalysis.mockResolvedValueOnce({ workspaceId: "original-company" });
    vi.mocked(hasWorkspaceClaudeKey).mockResolvedValueOnce(false);
    const response = await POST(new Request("http://local", { method: "POST", body: JSON.stringify({ input: sampleInput, workspaceId: "workspace", sourceAnalysisId: id }) }));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ errors: ["workspace.claude.unavailable"], workspaceId: "original-company" });
    expect(hasWorkspaceClaudeKey).toHaveBeenLastCalledWith("original-company");
    expect(m.createAnalysis).not.toHaveBeenCalled();
  });
  it("gives a validation retry only the time left in the job, capped at the per-call timeout", async () => {
    const now = vi.spyOn(Date, "now").mockImplementation(() => (m.requestStructuredOutput.mock.calls.length === 0 ? 0 : 100_000));
    try {
      expect((await post()).status).toBe(202);
      await m.task?.();
      expect(m.requestStructuredOutput.mock.calls.map(([request]) => request.timeoutMs)).toEqual([240000, 180000]);
    } finally { now.mockRestore(); }
  });
  it("rejects malformed JSON", async () => { const r = await POST(new Request("http://local", { method: "POST", body: "{" })); expect(r.status).toBe(400); expect(await r.json()).toEqual({ errors: ["analysis.invalidInput"] }); });
  it("returns 202 then completes the analysis through after", async () => {
    m.requestStructuredOutput.mockResolvedValue({ data: sampleOutput, usage, model: "m" });
    const r = await post();
    expect(r.status).toBe(202); expect(r.headers.get("cache-control")).toBe("no-store"); expect(await r.json()).toEqual({ id });
    expect(m.createAnalysis).toHaveBeenCalledWith({ workspaceId: "workspace", input: sampleInput, sourceAnalysisId: null }); expect(m.requestStructuredOutput).not.toHaveBeenCalled();
    await m.task?.();
    expect(requestAnalysisStructuredOutput).toHaveBeenCalledWith(id, expect.objectContaining({ timeoutMs: 240000 }));
    expect(m.requestStructuredOutput).toHaveBeenCalledWith(expect.objectContaining({ timeoutMs: 240000 }));
    expect(m.completeAnalysis).toHaveBeenCalledWith(id, expect.objectContaining({ recommendedTier: "balanced" }), usage);
    expect(m.failAnalysis).not.toHaveBeenCalled();
  });
  it("records a model validation failure through after", async () => {
    m.requestStructuredOutput.mockResolvedValue({ data: {}, usage, model: "m" });
    expect((await post()).status).toBe(202);
    await m.task?.();
    // 검증 실패는 한 번 다시 부르고(ADR-022) 두 호출의 사용량을 합쳐 남긴다.
    expect(m.requestStructuredOutput).toHaveBeenCalledTimes(2);
    expect(m.failAnalysis).toHaveBeenCalledWith(id, "validation", { promptTokens: 20, completionTokens: 40, costUsd: null }); expect(m.completeAnalysis).not.toHaveBeenCalled();
  });
  it.each(["missing", "unreadable", "invalid", "synthetic", "incomplete"])("returns 409 before reserving when pricing is %s", async reason => {
    m.acquire.mockResolvedValueOnce({ ok: false, reason });
    const response = await post();
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ errors: ["pricing.unavailable"] });
    expect(hasWorkspaceClaudeKey).not.toHaveBeenCalled();
    expect(m.createAnalysis).not.toHaveBeenCalled();
    expect(m.after).not.toHaveBeenCalled();
    expect(m.requestStructuredOutput).not.toHaveBeenCalled();
  });
  it("uses the catalog captured before the job starts", async () => {
    const catalog = structuredClone(loadCatalog());
    catalog.prices.asOf = "2034-01-01";
    m.acquire.mockResolvedValueOnce({ ok: true, catalog });
    m.requestStructuredOutput.mockResolvedValue({ data: sampleOutput, usage, model: "m" });
    expect((await post()).status).toBe(202);
    m.acquire.mockResolvedValue({ ok: false, reason: "missing" });
    await m.task?.();
    expect(m.completeAnalysis).toHaveBeenCalledWith(id, expect.objectContaining({ priceAsOf: "2034-01-01" }), usage);
    expect(m.acquire).toHaveBeenCalledTimes(1);
  });
  it("hides workspace and creation errors", async () => {
    m.createAnalysis.mockRejectedValueOnce(Error("secret"));
    const response = await post();
    expect(response.status).toBe(500); expect(await response.text()).not.toContain("secret");
    expect(m.after).not.toHaveBeenCalled();
    m.getCurrentWorkspace.mockRejectedValueOnce(Error("secret"));
    expect((await post()).status).toBe(500);
  });
});
