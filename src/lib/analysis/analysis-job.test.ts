// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadCatalog } from "@/lib/catalog/load";
import { loadExtensionSupportCatalog } from "@/lib/catalog/extension-support";
import type { AnalysisInput, AnalysisResult } from "@/types/analysis";
const runMock = vi.hoisted(() => ({ runAnalysis: vi.fn() }));
vi.mock("@/lib/analysis/run-analysis", () => ({ runAnalysis: runMock.runAnalysis }));
import { runAnalysisJob, resolveAnalysisStatus, startAnalysis } from "./analysis-job";

const input: AnalysisInput = { description: "예약 웹 서비스를 구축합니다", expectedUsers: "under-10k", monthlyBudget: 300000, region: "canadacentral", availability: "medium" };
const workspaceId = "workspace-1";
const now = new Date("2026-10-14T12:00:00Z");
const catalog = loadCatalog();
const validBody = { input, workspaceId };
function deps(overrides: Record<string, unknown> = {}) {
  return { acquireOperatorPrices: async () => ({ ok: true as const, catalog, support: loadExtensionSupportCatalog(catalog) }), getAnalysis: vi.fn(async () => null as { workspaceId: string } | null), hasWorkspaceClaudeKey: vi.fn<(workspaceId: string) => Promise<boolean>>(async () => true), createAnalysis: vi.fn(async () => "job-1"), schedule: vi.fn<(_task: () => Promise<void>) => void>(), runJob: vi.fn(async () => {}), ...overrides };
}
describe("startAnalysis", () => {
 it("rejects a missing company key before creating or scheduling an analysis", async () => {
  const d = deps({ hasWorkspaceClaudeKey: vi.fn(async () => false) });
  expect(await startAnalysis({ workspaceId, body: validBody, now }, d)).toEqual({ status: 409, errors: ["workspace.claude.unavailable"], workspaceId });
  expect(d.hasWorkspaceClaudeKey).toHaveBeenCalledWith(workspaceId);
  expect(d.createAnalysis).not.toHaveBeenCalled();
  expect(d.schedule).not.toHaveBeenCalled();
 });
 it("preflights and reserves a rerun in the original analysis workspace", async () => {
  const sourceAnalysisId = "123e4567-e89b-42d3-a456-426614174000";
  const d = deps(); d.getAnalysis.mockResolvedValue({ workspaceId: "original-company" });
  d.hasWorkspaceClaudeKey.mockImplementation(async owner => owner === "original-company");
  expect((await startAnalysis({ workspaceId, body: { ...validBody, sourceAnalysisId }, now }, d)).status).toBe(202);
  expect(d.hasWorkspaceClaudeKey).toHaveBeenCalledWith("original-company");
  expect(d.createAnalysis).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: "original-company", sourceAnalysisId }));
  const blocked = deps(); blocked.getAnalysis.mockResolvedValue({ workspaceId: "original-company" });
  blocked.hasWorkspaceClaudeKey.mockImplementation(async owner => owner === workspaceId);
  expect(await startAnalysis({ workspaceId, body: { ...validBody, sourceAnalysisId }, now }, blocked)).toEqual({ status: 409, errors: ["workspace.claude.unavailable"], workspaceId: "original-company" });
  expect(blocked.createAnalysis).not.toHaveBeenCalled();
 });
 // 폼을 연 뒤 다른 탭에서 워크스페이스를 바꾸면, 쓰던 요구사항이 바뀐 고객사로 저장되면 안 된다.
 it("rejects a submission made for a different workspace than the current one", async () => {
  const d = deps();
  expect(await startAnalysis({ workspaceId, body: { ...validBody, workspaceId: "workspace-2" }, now }, d)).toEqual({ status: 409, errors: ["analysis.workspaceChanged"] });
  expect(d.createAnalysis).not.toHaveBeenCalled();
  expect((await startAnalysis({ workspaceId, body: { input }, now }, deps())).status).toBe(400);
 });
 it("rejects invalid input before looking up plan or reserving", async () => { const d = deps(); const r = await startAnalysis({ workspaceId, body: { input: {} }, now }, d); expect(r.status).toBe(400); expect(d.createAnalysis).not.toHaveBeenCalled(); expect(d.schedule).not.toHaveBeenCalled(); });
 it("creates in the current workspace before scheduling", async () => {
  const d = deps();
  expect(await startAnalysis({ workspaceId, body: validBody, now }, d)).toEqual({ status: 202, id: "job-1" });
  expect(d.createAnalysis).toHaveBeenCalledWith({ workspaceId, input, sourceAnalysisId: null });
  expect(d.runJob).not.toHaveBeenCalled();
  await d.schedule.mock.calls[0][0]();
  expect(d.runJob).toHaveBeenCalledWith({ id: "job-1", input, catalog });
 });
 it("hides reserve exceptions and validates source UUID", async () => { const d = deps({ createAnalysis: vi.fn(async () => { throw new Error("secret detail"); }) }); const failed = await startAnalysis({ workspaceId, body: validBody, now }, d); expect(failed.status).toBe(500); expect(JSON.stringify(failed)).not.toContain("secret detail"); expect(JSON.stringify(failed)).not.toContain("차감되지 않았습니다"); expect(await startAnalysis({ workspaceId, body: { ...validBody, sourceAnalysisId: "bad" }, now }, deps())).toEqual({ status: 400, errors: ["analysis.sourceNotFound"] }); });
 it("passes source id and defaults it to null", async () => { const d = deps(); const id = "123e4567-e89b-42d3-a456-426614174000"; await startAnalysis({ workspaceId, body: { ...validBody, sourceAnalysisId: id }, now }, d); expect(d.createAnalysis).toHaveBeenCalledWith(expect.objectContaining({ sourceAnalysisId: id })); const e = deps(); await startAnalysis({ workspaceId, body: validBody, now }, e); expect(e.createAnalysis).toHaveBeenCalledWith(expect.objectContaining({ sourceAnalysisId: null })); });
});
describe("runAnalysisJob", () => {
 const catalog = {} as never; const result = {} as AnalysisResult; const usage = { promptTokens: 1, completionTokens: 2, costUsd: null };
 function jobDeps(overrides: Record<string, unknown> = {}) {
  return { llm: vi.fn(async () => ({ data: {}, usage })), completeAnalysis: vi.fn(async () => {}), failAnalysis: vi.fn(async () => {}), ...overrides };
 }
 beforeEach(() => { runMock.runAnalysis.mockReset(); });
 it("completes on success with usage", async () => { runMock.runAnalysis.mockResolvedValue({ ok: true, result, usage }); const d = jobDeps(); await runAnalysisJob({ id: "job", input, catalog }, d); expect(runMock.runAnalysis).toHaveBeenCalledWith(input, { catalog, llm: d.llm }); expect(d.completeAnalysis).toHaveBeenCalledWith("job", result, usage); expect(d.failAnalysis).not.toHaveBeenCalled(); });
 it("fails on llm failure and swallows persistence failures", async () => { runMock.runAnalysis.mockResolvedValue({ ok: false, stage: "llm", errors: [], usage: null }); const failAnalysis = vi.fn(async () => { throw new Error("db"); }); await expect(runAnalysisJob({ id: "job", input, catalog }, jobDeps({ llm: vi.fn(async () => { throw Error(); }), failAnalysis }))).resolves.toBeUndefined(); expect(failAnalysis).toHaveBeenCalledWith("job", "llm", null); });
 it("records a model validation failure as validation with usage", async () => { runMock.runAnalysis.mockResolvedValue({ ok: false, stage: "validation", errors: ["bad"], usage }); const d = jobDeps(); await runAnalysisJob({ id: "job", input, catalog }, d); expect(d.failAnalysis).toHaveBeenCalledWith("job", "validation", usage); expect(d.completeAnalysis).not.toHaveBeenCalled(); });
 it("logs why the job failed without the user's input, since the row keeps only the stage", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const errors = ["requestTitle: 요청 제목은 40자 이하여야 합니다."];
  runMock.runAnalysis.mockResolvedValue({ ok: false, stage: "validation", errors, usage });
  await runAnalysisJob({ id: "job", input, catalog }, jobDeps());
  expect(warn).toHaveBeenCalledWith("분석 실패", { id: "job", stage: "validation", errors });
  expect(JSON.stringify(warn.mock.calls)).not.toContain(input.description);
  warn.mockClear();
  runMock.runAnalysis.mockResolvedValue({ ok: true, result, usage });
  await runAnalysisJob({ id: "job", input, catalog }, jobDeps());
  expect(warn).not.toHaveBeenCalled();
  warn.mockRestore();
 });
 it("records internal when completeAnalysis throws", async () => { runMock.runAnalysis.mockResolvedValue({ ok: true, result, usage }); const d = jobDeps({ completeAnalysis: vi.fn(async () => { throw new Error("db"); }) }); await expect(runAnalysisJob({ id: "job", input, catalog }, d)).resolves.toBeUndefined(); expect(d.failAnalysis).toHaveBeenCalledWith("job", "internal", usage); expect(runMock.runAnalysis).toHaveBeenCalledOnce(); });
 it("resolves status and stale pending", () => { expect(resolveAnalysisStatus({ status: "succeeded", createdAt: now.toISOString(), errorStage: null }, now)).toEqual({ status: "succeeded", failureReason: null }); expect(resolveAnalysisStatus({ status: "failed", createdAt: now.toISOString(), errorStage: "llm" }, now).failureReason).toBe("failed"); expect(resolveAnalysisStatus({ status: "pending", createdAt: "bad", errorStage: null }, now).failureReason).toBe("timeout"); expect(resolveAnalysisStatus({ status: "pending", createdAt: now.toISOString(), errorStage: null }, now).status).toBe("pending"); });
});
