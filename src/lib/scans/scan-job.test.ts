import { afterEach, describe, expect, it, vi } from "vitest";
import { startScan, runLiveScanJob, type StartScanDeps, type RunLiveScanDeps } from "./scan-job";
import { SCAN_TIMEOUT_MS, getScanStaleBefore } from "./timing";
import { explicitNetworkResources } from "@/lib/inventory/fixtures.test-data";
import { buildInventory } from "@/lib/inventory/build-inventory";
import { AzureRequestError } from "@/services/azure/request";

const now = new Date("2026-11-06T12:00:00Z");
const job = { id: "scan", workspaceId: "workspace" };
const settings = { connection: { tenantId: "tenant", clientId: "client", certificatePath: "/private.pem", certificatePasswordEnv: null }, subscriptionIds: ["test"] };
const rows = { resourceRows: explicitNetworkResources(), containerRows: [] };
// inventory 컬럼에 저장하는 본문(요약·수집 시각·출처는 따로 저장한다).
const body = ({ resources, containers, relations, skippedRows }: ReturnType<typeof buildInventory>) => ({ resources, containers, relations, skippedRows });
function startDeps() {
  return {
    getWorkspaceAzureSettings: vi.fn().mockResolvedValue(settings),
    reserveLiveScan: vi.fn().mockResolvedValue({ id: job.id, created: true }),
    createImportScan: vi.fn().mockResolvedValue(job.id),
    schedule: vi.fn(), runJob: vi.fn().mockResolvedValue(undefined),
    failScan: vi.fn().mockResolvedValue(undefined),
  } satisfies StartScanDeps;
}
function liveDeps() {
  return {
    getWorkspaceAzureSettings: vi.fn().mockResolvedValue(settings),
    createTokenProvider: vi.fn(() => vi.fn().mockResolvedValue("token")),
    collectInventoryRows: vi.fn().mockResolvedValue(rows),
    completeScan: vi.fn().mockResolvedValue(undefined), failScan: vi.fn().mockResolvedValue(undefined), now: () => now,
  } satisfies RunLiveScanDeps;
}
function start(body: unknown, deps = startDeps()) { return startScan({ workspaceId: job.workspaceId, now, body }, deps); }
const live = { workspaceId: job.workspaceId, source: "live" };
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("스캔 시작", () => {
  it.each([null, {}, [], { ...live, source: "other" }, { source: "live" }, { ...live, workspaceId: "" }, { ...live, source: "import" }])("잘못된 본문은 저장하지 않는다: %j", async body => {
    const deps = startDeps();
    expect(await start(body, deps)).toEqual({ status: 400, code: "invalid-body" });
    expect(deps.getWorkspaceAzureSettings).not.toHaveBeenCalled();
    expect(deps.createImportScan).not.toHaveBeenCalled();
  });
  it.each(["live", "import"])("%s 요청의 워크스페이스 변경을 거절한다", async source => {
    const deps = startDeps();
    expect(await start({ workspaceId: "other", source, data: [] }, deps)).toEqual({ status: 409, code: "workspace-changed" });
    expect(deps.getWorkspaceAzureSettings).not.toHaveBeenCalled();
  });
  it.each([null, { ...settings, connection: null }, { ...settings, subscriptionIds: [] }])("연결 또는 구독이 없으면 예약하지 않는다", async config => {
    const deps = startDeps(); deps.getWorkspaceAzureSettings.mockResolvedValue(config);
    expect(await start(live, deps)).toEqual({ status: 409, code: "connection-missing" });
    expect(deps.reserveLiveScan).not.toHaveBeenCalled();
  });
  it.each([true, false])("새 행 여부 %s에 따라 한 번만 예약한다", async created => {
    const deps = startDeps(); deps.reserveLiveScan.mockResolvedValue({ id: job.id, created });
    expect(await start(live, deps)).toEqual({ status: 202, id: job.id, existing: !created });
    expect(deps.reserveLiveScan).toHaveBeenCalledWith({ workspaceId: job.workspaceId, subscriptionIds: settings.subscriptionIds, staleBefore: getScanStaleBefore(now) });
    expect(deps.schedule).toHaveBeenCalledTimes(created ? 1 : 0);
    expect(deps.runJob).not.toHaveBeenCalled();
    if (created) { await deps.schedule.mock.calls[0][0](); expect(deps.runJob).toHaveBeenCalledWith(job); }
  });
  it("작업 예약이 실패하면 예약한 스캔을 internal로 닫고 500을 돌려준다", async () => {
    const deps = startDeps();
    deps.schedule.mockImplementation(() => { throw new Error("after unavailable"); });
    expect(await startScan({ workspaceId: job.workspaceId, body: { workspaceId: job.workspaceId, source: "live" }, now }, deps))
      .toEqual({ status: 500, code: "internal" });
    expect(deps.failScan).toHaveBeenCalledWith(job.id, "internal");
    // 실패 저장도 실패하면 삼키고 500을 돌려준다(stale 판정이 처리한다).
    deps.failScan.mockRejectedValueOnce(new Error("db"));
    expect(await startScan({ workspaceId: job.workspaceId, body: { workspaceId: job.workspaceId, source: "live" }, now }, deps))
      .toEqual({ status: 500, code: "internal" });
  });
  it("가져오기를 정규화해 요약의 구독과 즉시 저장한다", async () => {
    const deps = startDeps();
    expect(await start({ ...live, source: "import", data: rows.resourceRows }, deps)).toEqual({ status: 201, id: job.id });
    const inventory = buildInventory({ source: "import", collectedAt: now, ...rows });
    expect(deps.createImportScan).toHaveBeenCalledWith({ workspaceId: job.workspaceId, inventory: body(inventory), summary: inventory.summary, collectedAt: inventory.collectedAt, subscriptionIds: inventory.summary.subscriptionIds });
    expect(deps.schedule).not.toHaveBeenCalled();
    expect(deps.getWorkspaceAzureSettings).not.toHaveBeenCalled();
  });
  it.each([[null, "import-invalid"], [Array(50_001).fill(null), "import-too-many-rows"], [[], "import-empty"], [[null, {}], "import-empty"]])("가져오기 오류 %s는 코드로 반환한다", async (data, code) => {
    const deps = startDeps();
    expect(await start({ ...live, source: "import", data }, deps)).toEqual({ status: 400, code });
    expect(deps.createImportScan).not.toHaveBeenCalled();
  });
  it.each(["getWorkspaceAzureSettings", "reserveLiveScan", "createImportScan"] as const)("%s 저장소 오류를 internal로 반환한다", async key => {
    const deps = startDeps(); deps[key].mockRejectedValue(new Error("private"));
    expect(await start(key === "createImportScan" ? { ...live, source: "import", data: rows.resourceRows } : live, deps)).toEqual({ status: 500, code: "internal" });
  });
});

describe("live 스캔 작업", () => {
  it("설정을 다시 읽고 토큰 provider와 수집 결과를 저장한다", async () => {
    const deps = liveDeps(); await runLiveScanJob(job, deps);
    expect(deps.getWorkspaceAzureSettings).toHaveBeenCalledWith(job.workspaceId);
    expect(deps.createTokenProvider).toHaveBeenCalledWith(settings.connection);
    expect(deps.collectInventoryRows).toHaveBeenCalledWith(settings.subscriptionIds, { getToken: deps.createTokenProvider.mock.results[0].value });
    const inventory = buildInventory({ source: "live", collectedAt: now, ...rows });
    // 요청한 구독("test")을 남긴다. 수집 결과의 구독 목록으로 바꾸지 않는다.
    expect(deps.completeScan).toHaveBeenCalledWith(job.id, { inventory: body(inventory), summary: inventory.summary, collectedAt: inventory.collectedAt, subscriptionIds: settings.subscriptionIds });
    expect(settings.subscriptionIds).not.toEqual(inventory.summary.subscriptionIds);
    expect(deps.failScan).not.toHaveBeenCalled();
  });
  it.each([null, { ...settings, connection: null }, { ...settings, subscriptionIds: [] }])("연결이 사라지면 실패 처리한다", async config => {
    const deps = liveDeps(); deps.getWorkspaceAzureSettings.mockResolvedValue(config);
    await runLiveScanJob(job, deps);
    expect(deps.failScan).toHaveBeenCalledWith(job.id, "connection-missing");
    expect(deps.createTokenProvider).not.toHaveBeenCalled();
  });
  it("원본 오류 없이 ID와 코드만 기록하고 실패 저장 오류도 삼킨다", async () => {
    const log = vi.spyOn(console, "warn").mockImplementation(() => {});
    const deps = liveDeps(); deps.collectInventoryRows.mockRejectedValue(new AzureRequestError("forbidden"));
    deps.failScan.mockRejectedValue(new Error("private.pem token"));
    await expect(runLiveScanJob(job, deps)).resolves.toBeUndefined();
    expect(deps.failScan).toHaveBeenCalledWith(job.id, "forbidden");
    expect(log).toHaveBeenCalledExactlyOnceWith({ id: job.id, code: "forbidden" });
    expect(deps.completeScan).not.toHaveBeenCalled();
  });
  it.each(["getWorkspaceAzureSettings", "collectInventoryRows", "completeScan"] as const)("%s 오류도 실패로 저장한다", async key => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const deps = liveDeps(); deps[key].mockRejectedValue(new Error("private"));
    await runLiveScanJob(job, deps);
    expect(deps.failScan).toHaveBeenCalledWith(job.id, "internal");
  });
  it.each(["settings", "collection"])("%s 대기를 포함해 10분 뒤 timeout, 늦은 결과는 저장하지 않는다", async stage => {
    vi.useFakeTimers(); vi.spyOn(console, "warn").mockImplementation(() => {});
    const deps = liveDeps();
    let finish!: () => void;
    if (stage === "settings") deps.getWorkspaceAzureSettings.mockImplementation(() => new Promise(resolve => { finish = () => resolve(settings); }));
    else deps.collectInventoryRows.mockImplementation(() => new Promise(resolve => { finish = () => resolve(rows); }));
    const pending = runLiveScanJob(job, deps);
    await vi.advanceTimersByTimeAsync(SCAN_TIMEOUT_MS);
    await pending;
    expect(deps.failScan).toHaveBeenCalledExactlyOnceWith(job.id, "timeout");
    finish(); await vi.advanceTimersByTimeAsync(0);
    expect(deps.completeScan).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
