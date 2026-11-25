// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { completeSnapshot, ids } from "@/lib/completion/fixtures.test-data";
import { evaluateAssessmentRules } from "@/lib/assessment/rules/engine";
import { compareScans } from "@/lib/inventory/diff";
import { collectAssessmentInsights } from "@/services/azure/insights";
import { parseAssessmentRow, validateAssessmentResult } from "./storage-validation";
import type { AssessmentSnapshot } from "./storage-validation";
import { ASSESSMENT_STALE_MS, ASSESSMENT_TIMEOUT_MS, runAssessmentJob, startAssessment, isAssessmentStale } from "./job";
import type { RunAssessmentDeps } from "./job";
import type { AssessmentResult } from "@/types/assessment";

const time = "2026-11-11T15:30:00.000Z";
function fixture() {
  const source: AssessmentSnapshot = { scan: structuredClone(completeSnapshot.record), inventory: structuredClone(completeSnapshot.inventory) };
  source.scan.source = "live";
  const previous = structuredClone(source);
  previous.scan.id = ids.oldScan; previous.scan.collectedAt = "2026-11-09T12:00:00.000Z";
  const input = { schemaVersion: 1 as const, workspaceId: ids.workspace, sourceScanId: ids.scan, previousScanId: null as string | null };
  const row = () => parseAssessmentRow({ id: ids.assessment, workspace_id: input.workspaceId, source_scan_id: input.sourceScanId,
    previous_scan_id: input.previousScanId, input, status: "pending", result: null, error: null,
    created_at: time, completed_at: null, roadmap_status: "not-requested", roadmap_attempt_id: null,
    roadmap_content: null, roadmap_error: null, roadmap_usage: null, roadmap_created_at: null, roadmap_completed_at: null }, source, input.previousScanId ? previous : null);
  let saved: AssessmentResult | null = null;
  const deps: RunAssessmentDeps = {
    getAssessment: vi.fn(async () => row()),
    loadSnapshot: vi.fn(async id => id === ids.scan ? source : id === ids.oldScan ? previous : null),
    getWorkspaceAzureSettings: vi.fn(async () => ({ connection: { tenantId: ids.subscription, clientId: ids.subscription,
      certificatePath: "/private/test.pem", certificatePasswordEnv: null }, subscriptionIds: [ids.subscription] })),
    prepareTransport: vi.fn(() => ({ getToken: async () => "fake", fetch: vi.fn(async () => new Response(null, { status: 403 })) })),
    collectInsights: vi.fn(collectAssessmentInsights),
    completeAssessment: vi.fn(async (id, result) => { saved = validateAssessmentResult(result, { id, input, createdAt: time, source, previous: input.previousScanId ? previous : null }); return true; }),
    failAssessment: vi.fn(async () => true), now: () => new Date(time),
  };
  return { source, previous, input, row, deps, saved: () => saved };
}
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

it("uses saved ownership and actual engines without a key, cookie or implicit latest baseline", async () => {
  const f = fixture(); f.input.previousScanId = ids.oldScan;
  await runAssessmentJob(ids.assessment, f.deps);
  const saved = f.saved()!;
  expect(saved.local).toEqual(evaluateAssessmentRules(f.source.inventory.resources, time));
  expect(saved.diff).toEqual({ state: "available", data: compareScans(f.previous, f.source, time) });
  expect(saved.roadmap).toEqual({ state: "not-requested" });
  expect(f.deps.loadSnapshot).toHaveBeenCalledWith(ids.oldScan);
  expect(f.deps.getWorkspaceAzureSettings).toHaveBeenCalledWith(ids.workspace);
  expect(saved.advisor).toEqual({ state: "unavailable", reason: "forbidden" });
  expect(saved.sourceScan.collectedAt).not.toBe(time);
});

it("does not load an unrequested diff or use Azure for an import", async () => {
  const f = fixture(); f.source.scan.source = "import";
  await runAssessmentJob(ids.assessment, f.deps);
  expect(f.saved()?.diff).toEqual({ state: "not-requested" });
  expect(f.saved()?.advisor).toEqual({ state: "unavailable", reason: "not-supported" });
  expect(f.deps.loadSnapshot).toHaveBeenCalledExactlyOnceWith(ids.scan);
  expect(f.deps.getWorkspaceAzureSettings).not.toHaveBeenCalled();
  expect(f.deps.prepareTransport).not.toHaveBeenCalled();
  expect(f.deps.collectInsights).toHaveBeenCalledWith(expect.anything(), null);
});

it.each(["missing", "connection", "subscriptions", "wrong-subscription"])("uses unavailable/null for %s connection scope", async kind => {
  const f = fixture();
  vi.mocked(f.deps.getWorkspaceAzureSettings).mockResolvedValue(kind === "missing" ? null : { connection: kind === "connection" ? null : {
    tenantId: ids.subscription, clientId: ids.subscription, certificatePath: "/test.pem", certificatePasswordEnv: null },
    subscriptionIds: kind === "wrong-subscription" ? [ids.otherSubscription] : [] });
  await runAssessmentJob(ids.assessment, f.deps);
  expect(f.saved()?.advisor).toEqual({ state: "unavailable", reason: "not-configured" });
  expect(f.deps.prepareTransport).not.toHaveBeenCalled();
});

it("requires every saved subscription while querying only the original scope", async () => {
  const f = fixture(); f.source.scan.subscriptionIds.push(ids.otherSubscription);
  await runAssessmentJob(ids.assessment, f.deps);
  expect(f.deps.prepareTransport).not.toHaveBeenCalled();
  expect(f.deps.collectInsights).toHaveBeenCalledWith(expect.objectContaining({ scan: f.source.scan }), null);
  expect(f.saved()?.advisor).toEqual({ state: "unavailable", reason: "not-configured" });
});

it.each(["settings", "transport", "collector", "malformed"])("preserves local results after optional %s failure", async kind => {
  const f = fixture(); const error = new Error("PRIVATE SETTINGS AND TOKEN");
  if (kind === "settings") vi.mocked(f.deps.getWorkspaceAzureSettings).mockRejectedValue(error);
  if (kind === "transport") vi.mocked(f.deps.prepareTransport).mockImplementation(() => { throw error; });
  if (kind === "collector") vi.mocked(f.deps.collectInsights).mockRejectedValue(error);
  if (kind === "malformed") vi.mocked(f.deps.collectInsights).mockResolvedValue({ advisor: { state: "available", data: {} } } as never);
  await runAssessmentJob(ids.assessment, f.deps);
  expect(f.saved()?.local.findings.length).toBeGreaterThan(0);
  expect(f.saved()?.advisor).toEqual({ state: "failed", reason: kind === "malformed" ? "invalid-response" : "internal" });
  expect(f.deps.failAssessment).not.toHaveBeenCalled();
  expect(JSON.stringify(f.saved())).not.toContain("PRIVATE");
});

it.each(["inventory", "owner", "input", "future", "baseline"])("fails sanitized on invalid saved %s", async kind => {
  const f = fixture(); const row = f.row();
  vi.mocked(f.deps.getAssessment).mockResolvedValue(row);
  if (kind === "inventory") vi.mocked(f.deps.loadSnapshot).mockResolvedValue(null);
  if (kind === "owner") f.source.scan.workspaceId = ids.otherWorkspace;
  if (kind === "input") row.input.sourceScanId = ids.oldScan;
  if (kind === "future") row.createdAt = "2026-11-12T00:00:00.000Z";
  if (kind === "baseline") { row.previousScanId = ids.oldScan; row.input.previousScanId = ids.oldScan; f.previous.scan.collectedAt = f.source.scan.collectedAt; }
  await runAssessmentJob(ids.assessment, f.deps);
  expect(f.deps.failAssessment).toHaveBeenCalledWith(ids.assessment, "validation-failed");
  expect(f.deps.completeAssessment).not.toHaveBeenCalled(); expect(f.deps.collectInsights).not.toHaveBeenCalled();
});

it("closes stale pending work and ignores terminal/missing rows", async () => {
  const f = fixture(); f.deps.now = () => new Date(Date.parse(time) + ASSESSMENT_STALE_MS);
  await runAssessmentJob(ids.assessment, f.deps);
  expect(f.deps.failAssessment).toHaveBeenCalledWith(ids.assessment, "interrupted");
  for (const row of [null, { ...f.row(), status: "succeeded" as const }]) {
    vi.mocked(f.deps.failAssessment).mockClear(); vi.mocked(f.deps.getAssessment).mockResolvedValue(row);
    await runAssessmentJob(ids.assessment, f.deps); expect(f.deps.failAssessment).not.toHaveBeenCalled();
  }
});

it.each(["resolve", "reject"])("times out after local computation; late %s cannot write again", async kind => {
  vi.useFakeTimers(); vi.setSystemTime(time);
  const f = fixture(); f.deps.now = () => new Date();
  let resolve!: (value: never) => void, reject!: (error: Error) => void;
  vi.mocked(f.deps.collectInsights).mockImplementation(() => new Promise((yes, no) => { resolve = yes; reject = no; }));
  const work = runAssessmentJob(ids.assessment, f.deps);
  await vi.advanceTimersByTimeAsync(ASSESSMENT_TIMEOUT_MS);
  await work;
  expect(f.saved()?.local.findings.length).toBeGreaterThan(0);
  expect(f.saved()?.advisor).toEqual({ state: "failed", reason: "timeout" });
  expect(f.saved()?.actualCost.monthToDate).toEqual({ state: "failed", reason: "timeout" });
  if (kind === "resolve") resolve({} as never); else reject(new Error("PRIVATE late failure"));
  await vi.advanceTimersByTimeAsync(1);
  expect(f.deps.completeAssessment).toHaveBeenCalledTimes(1); expect(f.deps.failAssessment).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it("bounds loading too and does not compute/write after a late load", async () => {
  vi.useFakeTimers(); const f = fixture();
  let finish!: (value: ReturnType<typeof f.row>) => void;
  vi.mocked(f.deps.getAssessment).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const work = runAssessmentJob(ids.assessment, f.deps);
  await vi.advanceTimersByTimeAsync(ASSESSMENT_TIMEOUT_MS); await work;
  finish(f.row()); await vi.advanceTimersByTimeAsync(1);
  expect(f.deps.failAssessment).toHaveBeenCalledExactlyOnceWith(ids.assessment, "timeout");
  expect(f.deps.loadSnapshot).not.toHaveBeenCalled(); expect(f.deps.completeAssessment).not.toHaveBeenCalled();
});

it("times out a connection lookup after local work without preparing a late credential", async () => {
  vi.useFakeTimers(); const f = fixture();
  let release!: () => void;
  vi.mocked(f.deps.getWorkspaceAzureSettings).mockImplementation(() => new Promise(resolve => { release = () => resolve(null); }));
  const work = runAssessmentJob(ids.assessment, f.deps);
  await vi.advanceTimersByTimeAsync(ASSESSMENT_TIMEOUT_MS); await work;
  expect(f.saved()?.advisor).toEqual({ state: "failed", reason: "timeout" });
  release(); await vi.advanceTimersByTimeAsync(1);
  expect(f.deps.completeAssessment).toHaveBeenCalledTimes(1);
  expect(f.deps.prepareTransport).not.toHaveBeenCalled(); expect(f.deps.collectInsights).not.toHaveBeenCalled();
});

describe("start", () => {
  function setup() {
    const f = fixture(); const tasks: (() => Promise<void>)[] = [];
    return { ...f, tasks, startDeps: { loadSnapshot: f.deps.loadSnapshot,
      reserveAssessment: vi.fn(async () => ({ id: ids.assessment, status: "pending" as const, created: true as const })),
      schedule: vi.fn((task: () => Promise<void>) => { tasks.push(task); }),
      runJob: vi.fn(async () => {}), failAssessment: f.deps.failAssessment } };
  }
  it("reserves validated fixed input and schedules only its ID without requiring a key", async () => {
    const f = setup();
    expect(await startAssessment({ workspaceId: ids.workspace, body: f.input }, f.startDeps)).toEqual({ status: 202, id: ids.assessment });
    expect(f.startDeps.reserveAssessment).toHaveBeenCalledWith(f.input);
    await f.tasks[0](); expect(f.startDeps.runJob).toHaveBeenCalledExactlyOnceWith(ids.assessment);
  });
  it("rejects changed cookies and invalid/foreign sources before reservation", async () => {
    const f = setup();
    expect(await startAssessment({ workspaceId: ids.otherWorkspace, body: f.input }, f.startDeps)).toEqual({ status: 409, code: "workspace-changed" });
    expect(await startAssessment({ workspaceId: ids.workspace, body: { ...f.input, advisor: false } }, f.startDeps)).toEqual({ status: 400, code: "invalid-body" });
    f.source.scan.workspaceId = ids.otherWorkspace;
    expect(await startAssessment({ workspaceId: ids.workspace, body: f.input }, f.startDeps)).toEqual({ status: 409, code: "invalid-source" });
    expect(f.startDeps.reserveAssessment).not.toHaveBeenCalled();
  });
  it("closes a reservation when scheduling throws", async () => {
    const f = setup(); f.startDeps.schedule.mockImplementation(() => { throw new Error("PRIVATE"); });
    expect(await startAssessment({ workspaceId: ids.workspace, body: f.input }, f.startDeps)).toEqual({ status: 500, code: "internal" });
    expect(f.startDeps.failAssessment).toHaveBeenCalledWith(ids.assessment, "internal");
  });
});

it.each(["source","previous","save","timeout-save"])("classifies %s DB failure as internal",async kind=>{
 const f=fixture();
 if(kind === "previous") f.input.previousScanId=ids.oldScan;
 if(kind === "source" || kind === "previous") vi.mocked(f.deps.loadSnapshot).mockImplementation(async id=>{
   if(kind === "source" || id === ids.oldScan) throw Error("DB failure");return f.source;
 });
 if(kind === "save" || kind === "timeout-save") vi.mocked(f.deps.completeAssessment).mockRejectedValue(Error("DB failure"));
 if(kind === "timeout-save") {
   vi.useFakeTimers();vi.mocked(f.deps.collectInsights).mockReturnValue(new Promise(()=>{}));
   const pending=runAssessmentJob(ids.assessment,f.deps);await vi.advanceTimersByTimeAsync(ASSESSMENT_TIMEOUT_MS);await pending;
 } else await runAssessmentJob(ids.assessment,f.deps);
 expect(f.deps.failAssessment).toHaveBeenCalledExactlyOnceWith(ids.assessment,"internal");
});
it("shares exact pending stale boundaries without treating terminal results as interrupted",()=>{
 const now=new Date(time),createdAt=new Date(now.getTime()-ASSESSMENT_STALE_MS).toISOString();
 expect(isAssessmentStale({status:"pending",createdAt},now)).toBe(true);
 expect(isAssessmentStale({status:"pending",createdAt:new Date(Date.parse(createdAt)+1).toISOString()},now)).toBe(false);
 expect(isAssessmentStale({status:"succeeded",createdAt},now)).toBe(false);
});
