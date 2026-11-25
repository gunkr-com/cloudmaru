import { afterEach, expect, it, vi } from "vitest";
import { createRoadmapJobs } from "./job";
import { roadmapFixture, roadmapModelFixture } from "./fixtures.test-data";
import { buildRoadmapContext } from "./context";
import type { StructuredLlm } from "@/types/analysis";
import type { AssessmentRecord } from "@/types/assessment";
const usage = { promptTokens: 2, completionTokens: 3, costUsd: 0.1 };
function fixture() {
  const { parent, catalogData } = roadmapFixture();
  const context = buildRoadmapContext(parent, catalogData);
  const output = roadmapModelFixture(context.payload);
  let row: AssessmentRecord = { id: parent.id, workspaceId: parent.workspaceId, sourceScanId: parent.sourceScanId,
    previousScanId: null, input: { schemaVersion: 1, workspaceId: parent.workspaceId, sourceScanId: parent.sourceScanId, previousScanId: null },
    status: "succeeded", result: parent, error: null, createdAt: parent.createdAt, completedAt: parent.local.evaluatedAt,
    roadmap: { status: "not-requested", attemptId: null, content: null, error: null, usage: null, createdAt: null, completedAt: null } };
  const attemptId = "00000000-0000-4000-8000-000000009999";
  const deps = {
    getAssessmentRoadmap: vi.fn(async () => row), getAssessmentRoadmapCatalogData: vi.fn(async () => catalogData),
    reserveAssessmentRoadmap: vi.fn(async () => { row = { ...row, roadmap: { ...row.roadmap, status: "pending", attemptId, createdAt: new Date().toISOString() } }; return { id: row.id, attemptId, created: true, status: "pending" as const }; }),
    completeAssessmentRoadmap: vi.fn<Parameters<typeof createRoadmapJobs>[0]["completeAssessmentRoadmap"]>(async () => true),
    failAssessmentRoadmap: vi.fn<Parameters<typeof createRoadmapJobs>[0]["failAssessmentRoadmap"]>(async () => true),
    hasKey: vi.fn(async () => true), request: vi.fn<(id: string, input: Parameters<StructuredLlm>[0]) => ReturnType<StructuredLlm>>(async () => ({ data: output, usage })),
    now: () => new Date(),
  };
  const jobs = createRoadmapJobs(deps);
  return { deps, jobs, row, output, attemptId, setRow: (value: AssessmentRecord) => { row = value; } };
}
afterEach(() => vi.useRealTimers());
it("skips no-data before key, reservation or paid call", async () => {
  const f = fixture(); f.row.result!.local.findings = []; f.row.result!.local.coverage = { total: 0, included: 0, excluded: 0, reasons: [] };
  expect(await f.jobs.start(f.row.id, f.row.workspaceId, f.row.workspaceId, vi.fn())).toMatchObject({ status: 409, code: "no-data" });
  expect(f.deps.hasKey).not.toHaveBeenCalled(); expect(f.deps.reserveAssessmentRoadmap).not.toHaveBeenCalled(); expect(f.deps.request).not.toHaveBeenCalled();
});
it("rejects changed cookies and missing keys without reservation; owner always comes from saved row", async () => {
  const f = fixture(); const schedule = vi.fn();
  expect(await f.jobs.start(f.row.id, "other", f.row.workspaceId, schedule)).toMatchObject({ status: 409, code: "workspace-changed" });
  f.deps.hasKey.mockResolvedValue(false);
  expect(await f.jobs.start(f.row.id, f.row.workspaceId, f.row.workspaceId, schedule)).toMatchObject({ status: 409, code: "key-unavailable", workspaceId: f.row.workspaceId });
  expect(f.deps.reserveAssessmentRoadmap).not.toHaveBeenCalled(); expect(schedule).not.toHaveBeenCalled();
});
it("schedules once; reused pending or success does not require a key or schedule work", async () => {
  const f = fixture(), queue: (() => Promise<void>)[] = [];
  await f.jobs.start(f.row.id, f.row.workspaceId, f.row.workspaceId, task => queue.push(task));
  f.deps.hasKey.mockResolvedValue(false);
  expect(await f.jobs.start(f.row.id, f.row.workspaceId, f.row.workspaceId, vi.fn())).toMatchObject({ status: 202 });
  expect(queue).toHaveLength(1); expect(f.deps.reserveAssessmentRoadmap).toHaveBeenCalledTimes(1);
  f.deps.hasKey.mockResolvedValue(true); await queue[0]();
  expect(f.deps.completeAssessmentRoadmap).toHaveBeenCalledWith(f.row.id, f.attemptId, expect.objectContaining({ schemaVersion: 1 }), usage);
});
it("retains validation retry and provider-failure aggregate; failure closes only roadmap", async () => {
  const f = fixture();
  f.deps.request.mockResolvedValueOnce({ data: {}, usage }).mockRejectedValueOnce({ usage });
  let task!: () => Promise<void>;
  await f.jobs.start(f.row.id, f.row.workspaceId, f.row.workspaceId, callback => { task = callback; }); await task();
  expect(f.deps.request).toHaveBeenCalledTimes(2);
  expect(f.deps.failAssessmentRoadmap).toHaveBeenCalledWith(f.row.id, f.attemptId, "validation-failed", { promptTokens: 4, completionTokens: 6, costUsd: 0.2 });
  expect(f.row.status).toBe("succeeded");
});
it("bounded timeout returns before ignored provider cancellation; late known usage cannot complete", async () => {
  vi.useFakeTimers(); const f = fixture(); let resolve!: (value: {data: unknown; usage: typeof usage}) => void;
  f.deps.request.mockImplementation(() => new Promise(done => { resolve = done; }));
  await f.deps.reserveAssessmentRoadmap();
  const running = f.jobs.runJob(f.row.id, f.attemptId);
  await vi.advanceTimersByTimeAsync(280_000);
  await running;
  expect(f.deps.failAssessmentRoadmap).toHaveBeenCalledWith(f.row.id, f.attemptId, "timeout", null);
  resolve({ data: f.output, usage }); await vi.advanceTimersByTimeAsync(0);
  expect(f.deps.completeAssessmentRoadmap).not.toHaveBeenCalled();
  expect(f.deps.failAssessmentRoadmap).toHaveBeenLastCalledWith(f.row.id, f.attemptId, "timeout", usage);
});
it("closes scheduling failure without calling the provider", async () => {
  const f = fixture();
  expect(await f.jobs.start(f.row.id, f.row.workspaceId, f.row.workspaceId, () => { throw new Error("SECRET"); })).toMatchObject({ status: 500, code: "internal" });
  expect(f.deps.failAssessmentRoadmap).toHaveBeenCalledWith(f.row.id, f.attemptId, "internal", null);
  expect(f.deps.request).not.toHaveBeenCalled();
});

it("retains a rejected persistence callback for bounded retry without replacing known usage with null", async () => {
  const f = fixture();
  f.deps.completeAssessmentRoadmap.mockRejectedValue(new Error("private-write-failure"));
  f.deps.failAssessmentRoadmap.mockRejectedValue(new Error("private-bill-failure"));
  let task!: () => Promise<void>;
  await f.jobs.start(f.row.id, f.row.workspaceId, f.row.workspaceId, value => { task = value; });
  await expect(task()).rejects.toThrow("assessment-roadmap-persistence-pending");
  expect(f.deps.completeAssessmentRoadmap.mock.calls.length).toBeLessThanOrEqual(3);
  expect(f.deps.failAssessmentRoadmap.mock.calls.length).toBeLessThanOrEqual(3);
  expect(f.deps.failAssessmentRoadmap.mock.calls.every(call => call[3] === usage)).toBe(true);
  f.deps.completeAssessmentRoadmap.mockResolvedValue(true);
  await f.jobs.runJob(f.row.id, f.attemptId);
  expect(f.deps.request).toHaveBeenCalledTimes(1);
  expect(f.deps.completeAssessmentRoadmap).toHaveBeenLastCalledWith(f.row.id, f.attemptId, expect.anything(), usage);
});

it("retains and reports exhausted late persistence, then retries that callback without another provider call", async () => {
  vi.useFakeTimers(); const f = fixture();
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  let resolve!: (value: { data: unknown; usage: typeof usage }) => void;
  f.deps.request.mockImplementation(() => new Promise(done => { resolve = done; }));
  f.deps.failAssessmentRoadmap.mockImplementation(async (_id, _attempt, _code, aggregate) => {
    if (aggregate) throw new Error("private-billing-failure"); return true;
  });
  await f.deps.reserveAssessmentRoadmap(); const running = f.jobs.runJob(f.row.id, f.attemptId);
  await vi.advanceTimersByTimeAsync(280_000); await running;
  resolve({ data: f.output, usage }); await vi.advanceTimersByTimeAsync(0);
  expect(log).toHaveBeenCalledWith("assessment-roadmap-persistence-pending");
  const knownCalls = f.deps.failAssessmentRoadmap.mock.calls.filter(call => call[3] !== null);
  expect(knownCalls).toHaveLength(3);
  f.deps.failAssessmentRoadmap.mockResolvedValue(true);
  await f.jobs.runJob(f.row.id, f.attemptId);
  expect(f.deps.failAssessmentRoadmap).toHaveBeenLastCalledWith(f.row.id, f.attemptId, "timeout", usage);
  expect(f.deps.request).toHaveBeenCalledTimes(1); log.mockRestore();
});
