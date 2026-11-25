// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { startExtension, runExtensionJob, ExtensionJobError } from "./job";
import type { RunExtensionDeps, StartExtensionDeps } from "./job";
import { processedFixture } from "@/lib/extend/proposal.test-data";
import type { ExtensionRecord } from "@/services/db/extensions";

function setup() {
  const f = processedFixture();
  const row: ExtensionRecord = { id: f.result.id, workspaceId: f.result.workspaceId, sourceScanId: f.result.sourceScanId,
    sourceExtensionId: null, status: "pending", input: f.result.input, sourceScan: f.result.sourceScan,
    result: null, error: null, usage: null, createdAt: f.result.createdAt, completedAt: null };
  const source = { scan: f.context.scan, inventory: f.context.inventory, sourceScan: f.result.sourceScan };
  const deps = {
    getExtension: vi.fn(async () => row), getExtensionSourceScan: vi.fn(async () => source),
    reserveExtension: vi.fn(async () => ({ id: row.id, status: "pending" as const, created: true as const })),
    acquireOperatorPrices: async () => ({ ok: true, catalog: f.context.catalog, support: f.context.support }),
    hasWorkspaceClaudeKey: vi.fn(async () => true), schedule: vi.fn<StartExtensionDeps["schedule"]>(), runJob: vi.fn(async () => {}),
    completeExtension: vi.fn(async () => true), failExtension: vi.fn(async () => true),
    loadCoreData: vi.fn(() => ({ catalog: f.context.catalog, support: f.context.support })),
    request: vi.fn<RunExtensionDeps["request"]>(async () => ({ data: f.raw, usage: null })), now: () => new Date(row.createdAt),
  } satisfies StartExtensionDeps & RunExtensionDeps;
  return { f, row, deps, request: { workspaceId: row.workspaceId, body: row.input } };
}
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

it("observes each validation attempt without letting diagnostics change retries or storage", async()=>{
 const s=setup(); const observe=vi.fn(()=>{throw Error("logging-unavailable");});
 s.deps.request.mockResolvedValueOnce({data:{},usage:null}).mockResolvedValueOnce({data:s.f.raw,usage:null});
 await runExtensionJob(s.row.id,{...s.deps,onValidation:observe});
 expect(observe).toHaveBeenCalledTimes(2);
 expect(observe.mock.calls[0]).toEqual([{attempt:1,errors:expect.any(Array)}]);
 expect(observe.mock.calls[1]).toEqual([{attempt:2,errors:[]}]);
 expect(s.deps.completeExtension).toHaveBeenCalledWith(s.row.id,s.f.result,null, s.deps.loadCoreData());
 expect(s.deps.request).toHaveBeenCalledTimes(2);
});

it("preflights validated input/source/key before reservation and schedules only the saved id", async () => {
  const s = setup();
  expect(await startExtension(s.request, s.deps)).toEqual({ status: 202, id: s.row.id });
  expect(s.deps.hasWorkspaceClaudeKey).toHaveBeenCalledWith(s.row.workspaceId);
  expect(s.deps.reserveExtension).toHaveBeenCalledWith(s.row.input, { sourceExtensionId: null });
  await s.deps.schedule.mock.calls[0][0]();
  expect(s.deps.runJob).toHaveBeenCalledWith(s.row.id, s.deps.loadCoreData());
});
it.each(["body", "workspace", "source", "key", "storage"])("blocks %s before reserving", async kind => {
  const s = setup();
  if (kind === "body") s.request.body = { ...s.row.input, description: "" };
  if (kind === "workspace") s.request.workspaceId = "other-workspace";
  if (kind === "source") s.deps.getExtensionSourceScan.mockResolvedValue(null!);
  if (kind === "key") s.deps.hasWorkspaceClaudeKey.mockResolvedValue(false);
  if (kind === "storage") s.deps.getExtensionSourceScan.mockRejectedValue(Error("private-secret"));
  const result = await startExtension(s.request, s.deps);
  expect(result.status).toBe(kind === "body" ? 400 : kind === "storage" ? 500 : 409);
  expect(JSON.stringify(result)).not.toContain("private-secret");
  expect(s.deps.reserveExtension).not.toHaveBeenCalled();
});
it("allows reanalysis under the saved parent owner after the cookie changed and rejects rebinding", async () => {
  const s = setup();
  s.request.workspaceId = "different-current-cookie";
  const request = { ...s.request, sourceExtensionId: s.row.id };
  expect((await startExtension(request, s.deps)).status).toBe(202);
  expect(s.deps.reserveExtension).toHaveBeenCalledWith(s.row.input, { sourceExtensionId: s.row.id });
  expect((await startExtension({ ...request, body: { ...s.row.input, workspaceId: "00000000-0000-4000-8000-000000000001" } }, s.deps)).status).toBe(409);
});
it("terminates scheduling failures and sanitizes a failed cleanup", async () => {
  const s = setup();
  s.deps.schedule.mockImplementation(() => { throw Error("private-scheduler"); });
  s.deps.failExtension.mockRejectedValue(Error("private-db"));
  expect(await startExtension(s.request, s.deps)).toEqual({ status: 500, code: "internal" });
  expect(s.deps.failExtension).toHaveBeenCalledWith(s.row.id, "internal");
});
it("processes only the reloaded row using real core/schema and final combined retry usage", async () => {
  const s = setup();
  const usage = { promptTokens: 10, completionTokens: 5, costUsd: 0.01 };
  s.deps.request.mockResolvedValueOnce({ data: {}, usage }).mockResolvedValueOnce({ data: s.f.raw, usage });
  await runExtensionJob(s.row.id, s.deps);
  expect(s.deps.request).toHaveBeenCalledTimes(2);
  expect(s.deps.request.mock.calls[1][1]).toMatchObject({ timeoutMs: 300_000 });
  expect(s.deps.completeExtension).toHaveBeenCalledWith(s.row.id, s.f.result,
    { promptTokens: 20, completionTokens: 10, costUsd: 0.02 }, s.deps.loadCoreData());
  expect(s.deps.failExtension).not.toHaveBeenCalled();
});
it("does not call a provider for terminal/stale rows", async () => {
  const s = setup();
  s.row.status = "failed";
  await runExtensionJob(s.row.id, s.deps);
  expect(s.deps.failExtension).not.toHaveBeenCalled();
  s.row.status = "pending";
  s.deps.now = () => new Date(Date.parse(s.row.createdAt) + 331_000);
  await runExtensionJob(s.row.id, s.deps);
  expect(s.deps.failExtension).toHaveBeenCalledWith(s.row.id, "interrupted", null);
  expect(s.deps.request).not.toHaveBeenCalled();
});
it("returns at the deadline even for an uncooperative provider and delivers late aggregate usage only", async () => {
  const s = setup();
  vi.useFakeTimers();
  vi.setSystemTime(s.row.createdAt);
  s.deps.now = () => new Date();
  const usage = { promptTokens: 10, completionTokens: 5, costUsd: null };
  let finish!: (value: { data: unknown; usage: typeof usage }) => void;
  s.deps.request.mockResolvedValueOnce({ data: {}, usage })
    .mockImplementationOnce(() => new Promise(resolve => { finish = resolve as typeof finish; }));
  const run = runExtensionJob(s.row.id, s.deps);
  await vi.advanceTimersByTimeAsync(300_000);
  await run;
  expect(s.deps.failExtension).toHaveBeenCalledWith(s.row.id, "timeout", null);
  finish({ data: s.f.raw, usage });
  await vi.advanceTimersByTimeAsync(0);
  expect(s.deps.failExtension).toHaveBeenLastCalledWith(s.row.id, "timeout", { promptTokens: 20, completionTokens: 10, costUsd: null });
  expect(s.deps.completeExtension).not.toHaveBeenCalled();
});
it("does not retry with less than 90 seconds remaining, and preserves provider failure usage", async () => {
  const s = setup();
  const origin = Date.parse(s.row.createdAt);
  let now = origin;
  s.deps.now = () => new Date(now);
  s.deps.request.mockImplementation(async () => { now += 211_000; return { data: {}, usage: null }; });
  await runExtensionJob(s.row.id, s.deps);
  expect(s.deps.request).toHaveBeenCalledTimes(1);
  expect(s.deps.failExtension).toHaveBeenCalledWith(s.row.id, "validation-failed", null);
  const usage = { promptTokens: 1, completionTokens: 2, costUsd: 0.01 };
  s.deps.request.mockRejectedValue(new ExtensionJobError("auth-failed", usage));
  now = origin;
  await runExtensionJob(s.row.id, s.deps);
  expect(s.deps.failExtension).toHaveBeenLastCalledWith(s.row.id, "auth-failed", usage);
});

it("deducts queue delay from the watchdog even if the provider ignores its timeout", async () => {
  const s = setup();
  vi.useFakeTimers();
  vi.setSystemTime(Date.parse(s.row.createdAt) + 100_000);
  s.deps.now = () => new Date();
  s.deps.request.mockImplementation(() => new Promise(() => {}));
  let returned = false;
  const run = runExtensionJob(s.row.id, s.deps).then(() => { returned = true; });
  await vi.advanceTimersByTimeAsync(200_000);
  expect(returned).toBe(true);
  expect(s.deps.failExtension).toHaveBeenCalledWith(s.row.id, "timeout", null);
  await run;
});
it("preserves a second-call provider reason and aggregate error usage", async () => {
  const s = setup();
  const usage = { promptTokens: 10, completionTokens: 5, costUsd: 0.01 };
  s.deps.request.mockResolvedValueOnce({ data: {}, usage })
    .mockRejectedValueOnce(new ExtensionJobError("invalid-response", usage));
  await runExtensionJob(s.row.id, s.deps);
  expect(s.deps.failExtension).toHaveBeenCalledWith(s.row.id, "invalid-response", { promptTokens: 20, completionTokens: 10, costUsd: 0.02 });
});

it("attempts sanitized pending-only failure after storage errors, preserving known usage", async () => {
  const s = setup();
  s.deps.getExtension.mockRejectedValueOnce(Error("private-storage"));
  await runExtensionJob(s.row.id, s.deps);
  expect(s.deps.failExtension).toHaveBeenCalledWith(s.row.id, "internal", null);
  const usage = { promptTokens: 10, completionTokens: 5, costUsd: 0.01 };
  s.deps.request.mockResolvedValue({ data: s.f.raw, usage });
  s.deps.completeExtension.mockRejectedValueOnce(Error("private-write"));
  await runExtensionJob(s.row.id, s.deps);
  expect(s.deps.failExtension).toHaveBeenLastCalledWith(s.row.id, "internal", usage);
});
