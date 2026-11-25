// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ analysis: null as unknown, records: [] as unknown[], reserved: { ok: true, id: "artifact-id", status: "pending", created: true }, afterTasks: [] as (() => Promise<void>)[], llm: vi.fn(), storeError: "" }));

vi.mock("@/services/db/analyses", () => ({ StoreError: class StoreError extends Error {}, getAnalysis: vi.fn(async () => { if (mocks.storeError) throw Error(mocks.storeError); return mocks.analysis; }) }));
vi.mock("@/services/db/artifacts", () => ({ listArtifacts: vi.fn(async () => { if (mocks.storeError) throw Error(mocks.storeError); return mocks.records; }), reserveArtifact: vi.fn(async () => mocks.reserved), completeArtifact: vi.fn(async () => {}), failArtifact: vi.fn(async () => {}) }));

vi.mock("@/services/claude", () => ({ requestStructuredOutput: mocks.llm }));
vi.mock("@/services/workspace-claude", () => ({ hasWorkspaceClaudeKey: vi.fn(async () => true), requestAnalysisStructuredOutput: vi.fn((_id, request) => mocks.llm(request)) }));
import { hasWorkspaceClaudeKey, requestAnalysisStructuredOutput } from "@/services/workspace-claude";
vi.mock("next/server", async (importOriginal) => { const actual = await importOriginal<typeof import("next/server")>(); return { ...actual, after: (task: () => Promise<void>) => { mocks.afterTasks.push(task); } }; });

import guide from "@/lib/artifacts/fixtures/sample-guide-output.json";
import { completeArtifact, failArtifact, reserveArtifact } from "@/services/db/artifacts";
import { POST, GET, maxDuration } from "./route";
import { loadCatalog } from "@/lib/catalog/load";
import { buildAnalysisResult } from "@/lib/analysis/build-result";
import { analysisInputSchema } from "@/lib/analysis/input-schema";
import input from "@/lib/analysis/fixtures/sample-input.json";
import output from "@/lib/analysis/fixtures/sample-model-output.json";
const parsedInput = analysisInputSchema.parse(input);
const built = buildAnalysisResult(output, parsedInput, loadCatalog());
if (!built.ok) throw new Error("invalid fixture");

const id = "11111111-1111-4111-8111-111111111111";
function context() { return { params: Promise.resolve({ id }) }; }
function request(body: string) { return new Request(`http://localhost/api/analyses/${id}/artifacts`, { method: "POST", body, headers: { "content-type": "application/json" } }) as never; }

describe("artifact route handlers", () => {
  beforeEach(() => { mocks.analysis = { id, status: "succeeded", input: parsedInput, result: built.result }; mocks.records = []; mocks.reserved = { ok: true, id: "artifact-id", status: "pending", created: true }; mocks.afterTasks = []; mocks.storeError = ""; mocks.llm.mockReset(); });
  it("rejects malformed JSON with no-store", async () => {
    const response = await POST(request("{"), context()); expect(response.status).toBe(400); expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it("returns the saved analysis owner's settings link context without reserving when its key is missing", async () => {
    mocks.analysis = { id, workspaceId: "owner-workspace", status: "succeeded", input: parsedInput, result: built.result };
    vi.mocked(hasWorkspaceClaudeKey).mockResolvedValueOnce(false);
    vi.mocked(reserveArtifact).mockClear();
    const response = await POST(request(JSON.stringify({ tier: "balanced", kind: "guide" })), context());
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ message: "workspace.claude.unavailable", workspaceId: "owner-workspace" });
    expect(reserveArtifact).not.toHaveBeenCalled();
    expect(mocks.afterTasks).toHaveLength(0);
  });
  it("returns mapped JSON statuses, schedules work with timeout, and reads stored artifacts", async () => {
    let response = await POST(request(JSON.stringify({ tier: "balanced", kind: "guide" })), context());
    expect(response.status).toBe(202); expect((await response.json()).artifact.status).toBe("pending");
    expect(mocks.afterTasks).toHaveLength(1);
    mocks.llm.mockResolvedValue({ data: {}, usage: null });
    await mocks.afterTasks[0](); expect(mocks.llm).toHaveBeenCalledWith(expect.objectContaining({ timeoutMs: 240_000 }));
    expect(requestAnalysisStructuredOutput).toHaveBeenCalledWith(id, expect.objectContaining({ timeoutMs: 240_000 }));
    response = await GET(new Request(`http://localhost/api/analyses/${id}/artifacts`) as never, context()); expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it("gives a validation retry only the time left in the job, capped at the per-call timeout", async () => {
    const now = vi.spyOn(Date, "now").mockImplementation(() => (mocks.llm.mock.calls.length === 0 ? 0 : 100_000));
    try {
      mocks.llm.mockResolvedValue({ data: {}, usage: null });
      await POST(request(JSON.stringify({ tier: "balanced", kind: "guide" })), context());
      await mocks.afterTasks[0]();
      expect(mocks.llm.mock.calls.map(([llmRequest]) => llmRequest.timeoutMs)).toEqual([240_000, 180_000]);
    } finally { now.mockRestore(); }
  });
  it("passes model usage to the PGlite completion and failure stores", async () => {
    const usage = { promptTokens: 12, completionTokens: 34, costUsd: 0.01 };
    mocks.llm.mockResolvedValue({ data: guide, usage });
    await POST(request(JSON.stringify({ tier: "balanced", kind: "guide" })), context());
    await mocks.afterTasks[0]();
    expect(completeArtifact).toHaveBeenCalledWith("artifact-id", guide, usage);
    mocks.llm.mockResolvedValue({ data: {}, usage });
    await POST(request(JSON.stringify({ tier: "balanced", kind: "guide" })), context());
    await mocks.afterTasks[1]();
    // 검증 실패는 한 번 다시 부르고(ADR-022) 두 호출의 사용량을 합쳐 남긴다.
    expect(failArtifact).toHaveBeenCalledWith("artifact-id", { promptTokens: 24, completionTokens: 68, costUsd: 0.02 });
  });
  it("maps store errors without leaking originals", async () => {
    mocks.storeError = "Private provider response and secret";
    const failedResponse = await POST(request(JSON.stringify({ tier: "balanced", kind: "guide" })), context());
    expect(failedResponse.status).toBe(500);
    expect(await failedResponse.json()).toEqual({ message: "artifacts.internalError" });
  });
  it("answers an unreadable stored success with 500 instead of pending", async () => {
    mocks.records = [{ id: "artifact-id", analysisId: id, tier: "balanced", kind: "guide", status: "succeeded", content: {}, createdAt: "2026-01-01T00:00:00.000Z", completedAt: "2026-01-01T00:01:00.000Z" }];
    mocks.reserved = { ok: true, id: "artifact-id", status: "succeeded", created: false };
    const response = await POST(request(JSON.stringify({ tier: "balanced", kind: "guide" })), context());
    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ message: "artifacts.generationFailed" });
    expect(mocks.afterTasks).toHaveLength(0);
  });
  it("exports literal route duration", () => { expect(maxDuration).toBe(300); });
});
