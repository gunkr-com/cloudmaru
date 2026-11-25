// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi, type MockInstance } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDatabase, insertTestWorkspace } from "@/lib/db/test-db.test-data";
import { completeSnapshot, ids } from "@/lib/completion/fixtures.test-data";
import { ASSESSMENT_STALE_MS, ASSESSMENT_TIMEOUT_MS } from "@/lib/assessment/app/job";
import { evaluateAssessmentRules } from "@/lib/assessment/rules/engine";
import { compareScans } from "@/lib/inventory/diff";
import { summarizeInventory } from "@/lib/inventory/summarize";
import { costPeriods } from "@/lib/assessment/cost-management-parse";
import type { ScanInventory, ScanSource } from "@/types/scan";
import type { AssessmentRecord } from "@/services/db/assessments";
const m = vi.hoisted(() => ({ db: vi.fn(), workspace: vi.fn(), after: vi.fn(), azure: vi.fn(), token: vi.fn(), claude: vi.fn() }));
vi.mock("@/services/db/client", () => ({ getDb: m.db }));
vi.mock("@/services/current-workspace", () => ({ getCurrentWorkspace: m.workspace }));
vi.mock("next/server", () => ({ after: m.after }));
vi.mock("@/services/db/workspace-azure", () => ({ getWorkspaceAzureSettings: m.azure }));
vi.mock("@/services/azure/credential", () => ({ createCertificateTokenProvider: m.token }));
vi.mock("@/services/claude", () => ({ requestStructuredOutput: m.claude }));
import { createScansDb } from "@/services/db/scans";
import { getAssessment, completeAssessment, failAssessment } from "@/services/db/assessments";
import { POST } from "./route";
import { GET } from "./[id]/route";
let db: PGlite;
let workspaceId: string;
let sourceScanId: string;
let external: MockInstance<typeof globalThis.fetch>;
const post = (body: unknown = { workspaceId, sourceScanId, previousScanId: null }) => POST(new Request("http://localhost/api/assessments", { method: "POST", body: JSON.stringify(body) }));
const read = (id: string) => GET(new Request("http://localhost"), { params: Promise.resolve({ id }) });
async function scan(owner = workspaceId, collectedAt = completeSnapshot.record.collectedAt!) {
  return createScansDb({ db: async () => db }).createImportScan({ workspaceId: owner,
    subscriptionIds: completeSnapshot.record.subscriptionIds, inventory: completeSnapshot.inventory,
    summary: completeSnapshot.record.summary!, collectedAt });
}
beforeEach(async () => {
  vi.resetAllMocks(); db = await createTestDatabase(); m.db.mockResolvedValue(db);
  workspaceId = await insertTestWorkspace(db); sourceScanId = await scan();
  m.workspace.mockResolvedValue({ id: workspaceId });
  external = vi.spyOn(globalThis, "fetch").mockRejectedValue(Error("unexpected external I/O"));
});
afterEach(async () => { vi.useRealTimers(); await db.close(); vi.restoreAllMocks(); });
async function noReservation(response: Response, code = "invalid-source") {
  expect(response.status).toBe(409); expect(await response.json()).toEqual({ code });
  expect((await db.query("select id from assessments")).rows).toHaveLength(0);
  expect(m.after).not.toHaveBeenCalled();
}
it("completes asynchronously with no key, fixes source/comparison and reopens twice after a cookie switch", async () => {
  const previousScanId = await scan(workspaceId, "2026-11-01T00:00:00Z");
  const response = await post({ workspaceId, sourceScanId, previousScanId });
  expect(response.status).toBe(202); const { id } = await response.json();
  expect((await getAssessment(id))!.status).toBe("pending");
  expect(m.after).toHaveBeenCalledTimes(1);
  m.workspace.mockResolvedValue({ id: await insertTestWorkspace(db) });
  await m.after.mock.calls[0][0]();
  const saved = (await getAssessment(id))!;
  expect(saved.status).toBe("succeeded");
  expect(saved.result!.local.findings.length).toBeGreaterThan(0);
  expect(saved.result!.diff).toMatchObject({ state: "available", data: { baselineScan: { id: previousScanId }, comparisonScan: { id: sourceScanId } } });
  // 이후 새 스캔을 저장해도 GET은 원래 결과를 반환한다.
  await scan(workspaceId, new Date().toISOString());
  for (let n = 0; n < 2; n++) {
    const reopened = await read(id); expect(reopened.status).toBe(200);
    expect(reopened.headers.get("cache-control")).toBe("no-store");
    expect(await reopened.json()).toEqual({ ...saved, workspaceMismatch: true });
  }
  expect(m.azure).not.toHaveBeenCalled(); expect(m.token).not.toHaveBeenCalled();
  expect(m.claude).not.toHaveBeenCalled(); expect(external).not.toHaveBeenCalled();
});
it("rejects a cookie switch and a source owned by another workspace", async () => {
  m.workspace.mockResolvedValue({ id: await insertTestWorkspace(db) });
  await noReservation(await post(), "workspace-changed");
  m.workspace.mockResolvedValue({ id: workspaceId });
  await noReservation(await post({ workspaceId, sourceScanId: await scan(await insertTestWorkspace(db)), previousScanId: null }));
});
it.each(["missing", "failed", "newer", "same", "equal-time", "other-owner"])("rejects %s comparison before reservation", async kind => {
  let previousScanId = kind === "same" ? sourceScanId : ids.oldScan as string;
  if (!["missing", "same"].includes(kind)) {
    previousScanId = await scan(kind === "other-owner" ? await insertTestWorkspace(db) : workspaceId,
      kind === "newer" ? new Date().toISOString() : kind === "equal-time" ? completeSnapshot.record.collectedAt! : "2026-11-01T00:00:00Z");
    if (kind === "failed") await db.query("update scans set status='failed',inventory=null,summary=null,error_code='internal' where id=$1", [previousScanId]);
  }
  await noReservation(await post({ workspaceId, sourceScanId, previousScanId }));
});
it.each(["missing", "failed", "invalid-inventory"])("rejects %s source", async kind => {
  if (kind === "missing") sourceScanId = ids.scan;
  if (kind === "failed") await db.query("update scans set status='failed',inventory=null,summary=null,error_code='internal' where id=$1", [sourceScanId]);
  if (kind === "invalid-inventory") await db.query("update scans set inventory=$2 where id=$1", [sourceScanId, { ...completeSnapshot.inventory, resources: [] }]);
  await noReservation(await post());
});
it("closes the actual reservation if after throws and exposes only a code", async () => {
  m.after.mockImplementation(() => { throw Error("PRIVATE scheduling details"); });
  const response = await post(); expect(response.status).toBe(500); expect(await response.json()).toEqual({ code: "internal" });
  const { rows } = await db.query<{ id: string }>("select id from assessments"); expect(rows).toHaveLength(1);
  expect(await getAssessment(rows[0].id)).toMatchObject({ status: "failed", result: null, error: { schemaVersion: 1, code: "internal" } });
});
it("sanitizes store failures without scheduling or leaking error details", async () => {
  m.db.mockRejectedValue(Error("PRIVATE database /private/data"));
  const response = await post(); expect(response.status).toBe(500); expect(await response.json()).toEqual({ code: "internal" });
  const missing = await read(ids.assessment); expect(missing.status).toBe(500); expect(await missing.json()).toEqual({ code: "internal" });
  expect(m.after).not.toHaveBeenCalled();
});
it("terminates stale pending once and prevents a late worker from overwriting it", async () => {
  const { id } = await (await post()).json();
  await db.query("update assessments set created_at=$2 where id=$1", [id, new Date(Date.now() - ASSESSMENT_STALE_MS).toISOString()]);
  const response = await read(id); expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ status: "failed", error: { schemaVersion: 1, code: "interrupted" } });
  await m.after.mock.calls[0][0]();
  expect(await failAssessment(id, "internal")).toBe(false);
  expect(await completeAssessment(id, {})).toBe(false);
  expect((await getAssessment(id))!.error!.code).toBe("interrupted");
  expect(external).not.toHaveBeenCalled();
});
it.each(["pending", "failed"])("preserves saved local success when roadmap is %s", async status => {
  const { id } = await (await post()).json(); await m.after.mock.calls[0][0]();
  await db.query("select * from reserve_assessment_roadmap($1,$2)", [id, new Date(0)]);
  if (status === "failed") await db.query("update assessments set roadmap_status='failed',roadmap_error=$2,roadmap_completed_at=now() where id=$1", [id, { schemaVersion: 1, code: "internal" }]);
  const response = await read(id); expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ status: "succeeded", result: { local: { findings: expect.any(Array) } }, roadmap: { status } });
  expect(m.claude).not.toHaveBeenCalled(); expect(external).not.toHaveBeenCalled();
});

// 실제 규칙·비교·phase14 수집기를 통과하는 저장 흐름 수용 테스트다.
// 모의 경계는 현재 cookie, after 큐, 인증 정보와 HTTP뿐이다.
function modernInventory(): ScanInventory {
  const inventory = structuredClone(completeSnapshot.inventory);
  inventory.resources = inventory.resources.map(resource => ({ ...resource,
    observedFields: ["tags", "zones", "managedBy", "sku", "properties", "location", "kind"],
  }));
  inventory.relations = [];
  return inventory;
}
function pair() {
  const all = modernInventory();
  const [shared, removed, added] = all.resources.filter(resource => resource.type === "microsoft.web/sites");
  const unsupported = all.resources.find(resource => resource.type === "microsoft.hybridcompute/machines")!;
  const before = { ...all, resources: [shared, removed, unsupported] };
  const after = structuredClone({ ...all, resources: [shared, added, unsupported] });
  after.resources[0].properties.httpsOnly = false;
  return { before, after, shared, removed, added, unsupported };
}
async function saveSnapshot(inventory: ScanInventory, options: {
  source?: ScanSource; collectedAt?: string; subscriptionIds?: string[];
} = {}) {
  const store = createScansDb({ db: async () => db });
  const data = { inventory, subscriptionIds: options.subscriptionIds ?? [ids.subscription],
    collectedAt: options.collectedAt ?? "2026-11-10T12:00:00Z",
    summary: summarizeInventory(inventory.resources, inventory.containers) };
  const id = options.source === "import" ? await store.createImportScan({ workspaceId, ...data })
    : (await store.reserveLiveScan({ workspaceId, subscriptionIds: data.subscriptionIds, staleBefore: new Date(0) })).id;
  if (options.source !== "import") await store.completeScan(id, data);
  return { scan: (await store.getScan(id))!, inventory: (await store.getScanInventory(id))! };
}
async function queueSavedPair(before: ScanInventory, after: ScanInventory, source: ScanSource = "live") {
  const baseline = await saveSnapshot(before, { source, collectedAt: "2026-11-09T12:00:00Z" });
  const comparison = await saveSnapshot(after, { source });
  const response = await post({ workspaceId, sourceScanId: comparison.scan.id, previousScanId: baseline.scan.id });
  expect(response.status).toBe(202);
  const { id } = await response.json();
  expect((await getAssessment(id))!.status).toBe("pending");
  return { id: id as string, baseline, comparison, run: m.after.mock.calls.at(-1)![0] as () => Promise<void> };
}
async function reopen(id: string): Promise<AssessmentRecord & { workspaceMismatch: boolean }> {
  const response = await read(id);
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  return response.json();
}
function configureAzure() {
  const connection = { tenantId: ids.subscription, clientId: ids.subscription,
    certificatePath: "/private/synthetic-only.pem", certificatePasswordEnv: null };
  // 넓어진 설정이 저장 스캔의 조회 범위를 넓혀서는 안 된다.
  m.azure.mockResolvedValue({ connection, subscriptionIds: [ids.subscription, ids.otherSubscription] });
  m.token.mockReturnValue(async () => "SYNTHETIC PRIVATE TOKEN");
  return connection;
}
function costResponse(rows: unknown[][]) {
  return Response.json({ properties: { columns: [{ name: "Currency", type: "String" },
    { name: "ResourceId", type: "String" }, { name: "PreTaxCost", type: "Number" }], rows, nextLink: null } });
}
function requestSlot(url: unknown, init?: RequestInit) {
  if (String(url).includes("Microsoft.Advisor")) return "advisor";
  const from = JSON.parse(init!.body as string).timePeriod.from as string;
  return from.endsWith("01T00:00:00.000Z") ? "monthToDate" : "trailing30Days";
}

it("saves a complete live pair, redacted diff and original credits/currencies, then reopens without following later state", async () => {
  const f = pair();
  f.before.resources[0].properties.settings = { password: "PRIVATE BEFORE", ordinary: "old" };
  f.after.resources[0].properties.settings = { password: "PRIVATE AFTER", ordinary: "new" };
  f.after.resources[0].properties.appSettings = [{ name: "API_TOKEN", value: "PRIVATE APP VALUE" }];
  const connection = configureAzure();
  external.mockImplementation(async (url, init) => {
    if (requestSlot(url, init) === "advisor") return Response.json({ value: [{
      id: `/subscriptions/${ids.subscription}/providers/microsoft.advisor/recommendations/synthetic`,
      properties: { recommendationTypeId: "cc9d34f5-f9b8-4d4f-9de7-98b45c698a49", resourceMetadata: { resourceId: f.shared.id },
        shortDescription: { solution: "PRIVATE arbitrary advice" } },
    }, { id: `/subscriptions/${ids.subscription}/providers/microsoft.advisor/recommendations/unmapped`,
      properties: { recommendationTypeId: ids.otherSubscription, resourceMetadata: { resourceId: f.shared.id } } }] });
    return requestSlot(url, init) === "monthToDate"
      ? costResponse([["CAD", f.shared.id, 0], ["USD", f.shared.id, 12], ["USD", f.shared.id, -3],
        ["USD", f.removed.id, 2], ["USD", null, -1], ["USD", "PRIVATE INVALID ID", 0.5]])
      : costResponse([["CAD", f.shared.id, 0]]);
  });
  const queued = await queueSavedPair(f.before, f.after);
  expect((await db.query("select claude_api_key_env from workspaces where id=$1", [workspaceId])).rows[0]).toEqual({ claude_api_key_env: null });
  m.workspace.mockResolvedValue({ id: await insertTestWorkspace(db) });
  await saveSnapshot(modernInventory(), { collectedAt: "2026-11-11T12:00:00Z" });
  await queued.run();
  const saved = await reopen(queued.id);
  expect(saved).toMatchObject({ status: "succeeded", workspaceId, workspaceMismatch: true, sourceScanId: queued.comparison.scan.id });
  const result = saved.result!;
  expect(result.sourceScan).toMatchObject({ collectedAt: queued.comparison.scan.collectedAt, completeness: { state: "complete", reasons: [] } });
  expect(result.local).toEqual(evaluateAssessmentRules(queued.comparison.inventory.resources, result.local.evaluatedAt));
  expect(result.local.findings.map(finding => finding.verdict)).toEqual(expect.arrayContaining(["pass", "violation", "unknown"]));
  expect(result.local.coverage).toMatchObject({ total: 3, included: 2, excluded: 1 });
  expect(result.diff).toEqual({ state: "available", data: compareScans(queued.baseline, queued.comparison, result.local.evaluatedAt) });
  if (result.diff.state !== "available") throw Error("expected saved diff");
  expect(result.diff.data.counts).toEqual({ added: 1, removed: 1, changed: 1, unknown: 0 });
  expect(JSON.stringify(result.diff)).toContain("[redacted]");
  expect(result.advisor).toMatchObject({ state: "partial", reasons: ["unmapped-advisor-type"], data: {
    coverage: { total: 2, included: 1, excluded: 1 }, recommendations: [{ resourceId: f.shared.id }],
  } });
  const month = result.actualCost.monthToDate;
  expect(month.state).toBe("available");
  if (!("data" in month)) throw Error("expected preserved charges");
  expect(month.data.period).toEqual(costPeriods(month.data.retrievedAt).monthToDate);
  expect(month.data.rows.map(row => row.amount)).toEqual([0, 12, -3, 2, -1, 0.5]);
  expect(month.data.rows.slice(3).map(row => row.attribution)).toEqual([
    { kind: "unattributed", resourceId: f.removed.id, reason: "outside-inventory" },
    { kind: "unattributed", resourceId: null, reason: "missing-resource-id" },
    { kind: "unattributed", resourceId: null, reason: "invalid-resource-id" },
  ]);
  expect(month.data.totals).toEqual([{ currency: "CAD", amount: 0, subscriptionIds: [ids.subscription] },
    { currency: "USD", amount: 10.5, subscriptionIds: [ids.subscription] }]);
  expect(result.actualCost.trailing30Days).toMatchObject({ state: "available", data: {
    period: costPeriods(month.data.retrievedAt).trailing30Days, totals: [{ currency: "CAD", amount: 0 }],
  } });
  expect(m.azure).toHaveBeenCalledExactlyOnceWith(workspaceId);
  expect(m.token).toHaveBeenCalledExactlyOnceWith(connection);
  expect(external).toHaveBeenCalledTimes(3);
  for (const [url, init] of external.mock.calls) {
    expect(String(url)).toContain(`/subscriptions/${ids.subscription}/`);
    expect(String(url)).not.toContain(ids.otherSubscription);
    expect(init?.method).toBe(String(url).includes("Microsoft.Advisor") ? "GET" : "POST");
  }
  expect(JSON.stringify(saved)).not.toMatch(/PRIVATE|synthetic-only\.pem/);
  const calls = external.mock.calls.length;
  m.azure.mockResolvedValue(null);
  await db.query("update workspaces set name='Later settings',subscription_ids=$2 where id=$1", [workspaceId, [ids.otherSubscription]]);
  for (let n = 0; n < 2; n++) expect(await reopen(queued.id)).toEqual(saved);
  await queued.run();
  expect(await completeAssessment(queued.id, {})).toBe(false);
  expect(await failAssessment(queued.id, "timeout")).toBe(false);
  expect(await reopen(queued.id)).toEqual(saved);
  expect(external).toHaveBeenCalledTimes(calls);
  expect(m.claude).not.toHaveBeenCalled();
  expect((await db.query("select * from llm_calls")).rows).toHaveLength(0);
});

it("treats two filtered imports as unverified scope, without inferring additions/deletions or querying Azure", async () => {
  const f = pair();
  const queued = await queueSavedPair(f.before, f.after, "import");
  await queued.run();
  const saved = await reopen(queued.id);
  expect(saved.status).toBe("succeeded");
  expect(saved.result!.sourceScan.completeness).toEqual({ state: "unknown", reasons: ["import-scope-unverified"] });
  expect(saved.result!.diff).toMatchObject({ state: "available", data: { counts: { added: 0, removed: 0, changed: 1, unknown: 2 },
    changes: expect.arrayContaining([
      { kind: "unknown", resourceId: f.removed.id, reasons: ["import-scope-unverified"] },
      { kind: "unknown", resourceId: f.added.id, reasons: ["import-scope-unverified"] },
    ]) } });
  for (const insight of [saved.result!.advisor, saved.result!.actualCost.monthToDate, saved.result!.actualCost.trailing30Days]) {
    expect(insight).toEqual({ state: "unavailable", reason: "not-supported" });
  }
  expect(await reopen(queued.id)).toEqual(saved);
  expect(m.azure).not.toHaveBeenCalled(); expect(m.token).not.toHaveBeenCalled(); expect(external).not.toHaveBeenCalled();
});

it.each(["legacy", "missing-field", "skipped-current", "skipped-baseline", "different-scope", "uncollected-scope"])(
  "preserves conservative %s findings and comparison through POST and reopen", async kind => {
    const f = pair();
    if (kind === "legacy") for (const resource of f.after.resources) {
      delete resource.observedFields; resource.tags = {}; resource.zones = []; resource.properties = {};
    }
    if (kind === "missing-field") {
      f.after.resources[0].observedFields = f.after.resources[0].observedFields!.filter(field => field !== "properties");
      f.after.resources[0].properties = {};
    }
    if (kind === "skipped-current") f.after.skippedRows = 2;
    if (kind === "skipped-baseline") f.before.skippedRows = 1;
    if (kind === "different-scope") {
      f.removed.id = f.removed.id.replace(ids.subscription, ids.otherSubscription);
      f.removed.subscriptionId = ids.otherSubscription;
    }
    const baseline = await saveSnapshot(f.before, { collectedAt: "2026-11-09T12:00:00Z",
      subscriptionIds: kind === "different-scope" ? [ids.subscription, ids.otherSubscription] : [ids.subscription] });
    const comparison = await saveSnapshot(f.after, {
      subscriptionIds: kind === "uncollected-scope" ? [ids.subscription, ids.otherSubscription] : [ids.subscription] });
    const response = await post({ workspaceId, sourceScanId: comparison.scan.id, previousScanId: baseline.scan.id });
    expect(response.status).toBe(202);
    const { id } = await response.json(); await m.after.mock.calls.at(-1)![0]();
    const saved = await reopen(id);
    expect(saved.status).toBe("succeeded");
    const result = saved.result!;
    expect(result.local).toEqual(evaluateAssessmentRules(comparison.inventory.resources, result.local.evaluatedAt));
    expect(result.diff).toEqual({ state: "available", data: compareScans(baseline, comparison, result.local.evaluatedAt) });
    if (result.diff.state !== "available") throw Error("expected comparison");
    const target = ["legacy", "missing-field"].includes(kind) ? f.shared.id : kind === "skipped-baseline" ? f.added.id : f.removed.id;
    const reason = kind === "legacy" ? "legacy-completeness-unknown" : kind === "missing-field" ? "missing-data"
      : kind.startsWith("skipped") ? "collection-partial" : "scope-not-collected";
    expect(result.diff.data.changes).toContainEqual({ kind: "unknown", resourceId: target, reasons: [reason] });
    if (["legacy", "missing-field"].includes(kind)) {
      expect(result.local.findings.find(finding => finding.ruleId === "web-https-only" && finding.resourceId === f.shared.id))
        .toMatchObject({ verdict: "unknown", reasonCode: "missing-data", evidence: [{ observation: { state: "missing" } }] });
    }
    expect(await reopen(id)).toEqual(saved);
    expect(m.token).not.toHaveBeenCalled(); expect(external).not.toHaveBeenCalled(); expect(m.claude).not.toHaveBeenCalled();
  });

it.each(["advisor", "monthToDate", "trailing30Days"])("isolates %s failure from the other stored insights and local findings", async failed => {
  const f = pair(); configureAzure();
  external.mockImplementation(async (url, init) => {
    const slot = requestSlot(url, init);
    if (slot === failed) return slot === "advisor" ? new Response(null, { status: 403 })
      : slot === "monthToDate" ? Response.json({ malformed: "PRIVATE response" }) : new Response(null, { status: 204 });
    return slot === "advisor" ? Response.json({ value: [] }) : costResponse([["CAD", f.shared.id, 0]]);
  });
  const queued = await queueSavedPair(f.before, f.after); await queued.run();
  const saved = await reopen(queued.id);
  expect(saved.status).toBe("succeeded");
  expect(saved.result!.local.findings.length).toBeGreaterThan(0);
  const states = { advisor: saved.result!.advisor, ...saved.result!.actualCost };
  for (const key of ["advisor", "monthToDate", "trailing30Days"] as const) {
    expect(states[key]).toMatchObject(key !== failed ? { state: "available" }
      : key === "advisor" ? { state: "unavailable", reason: "forbidden" }
        : key === "monthToDate" ? { state: "failed", reason: "invalid-response" } : { state: "unavailable", reason: "no-data" });
  }
  expect(JSON.stringify(saved)).not.toContain("PRIVATE");
  expect(await reopen(queued.id)).toEqual(saved);
});

it("stores local findings/diff at the overall deadline and ignores a late settings resolution", async () => {
  const f = pair(); const queued = await queueSavedPair(f.before, f.after);
  const connection = configureAzure();
  let release!: () => void;
  m.azure.mockReturnValue(new Promise(resolve => { release = () => resolve({ connection, subscriptionIds: [ids.subscription] }); }));
  vi.useFakeTimers();
  const work = queued.run();
  await vi.waitFor(() => expect(m.azure).toHaveBeenCalled(), { interval: 1 });
  await vi.advanceTimersByTimeAsync(ASSESSMENT_TIMEOUT_MS);
  await work;
  const saved = await reopen(queued.id);
  expect(saved.status).toBe("succeeded");
  expect(saved.result!.local.findings.length).toBeGreaterThan(0);
  expect(saved.result!.diff.state).toBe("available");
  for (const insight of [saved.result!.advisor, saved.result!.actualCost.monthToDate, saved.result!.actualCost.trailing30Days]) {
    expect(insight).toEqual({ state: "failed", reason: "timeout" });
  }
  release(); await vi.advanceTimersByTimeAsync(1);
  expect(await reopen(queued.id)).toEqual(saved);
  expect(m.token).not.toHaveBeenCalled(); expect(external).not.toHaveBeenCalled();
});

it("does not let an already running worker replace a GET-interrupted terminal row", async () => {
  const f = pair(); const queued = await queueSavedPair(f.before, f.after);
  let release!: () => void;
  m.azure.mockReturnValue(new Promise(resolve => { release = () => resolve(null); }));
  const work = queued.run();
  await vi.waitFor(() => expect(m.azure).toHaveBeenCalled(), { interval: 1 });
  await db.query("update assessments set created_at=$2 where id=$1", [queued.id,
    new Date(Date.now() - ASSESSMENT_STALE_MS - 1).toISOString()]);
  const interrupted = await reopen(queued.id);
  expect(interrupted).toMatchObject({ status: "failed", result: null, error: { code: "interrupted" } });
  release(); await work;
  expect(await reopen(queued.id)).toEqual(interrupted);
  expect(await failAssessment(queued.id, "internal")).toBe(false);
  expect(m.token).not.toHaveBeenCalled(); expect(external).not.toHaveBeenCalled();
});

it("exposes the authoritative roadmap attempt UUID across retry without changing local results", async () => {
  const f = pair(); const queued = await queueSavedPair(f.before, f.after, "import");
  await queued.run();
  const local = (await reopen(queued.id)).result;
  const first = await db.query<{ attempt_id: string }>("select * from reserve_assessment_roadmap($1,$2)", [queued.id, new Date(0)]);
  const attempt = first.rows[0].attempt_id;
  expect(attempt).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  const pending = await reopen(queued.id);
  expect(pending.result).toEqual(local);
  expect(pending.roadmap).toMatchObject({ status: "pending", attemptId: attempt, content: null, error: null, completedAt: null });
  await db.query("update assessments set roadmap_status='failed',roadmap_error=$2,roadmap_completed_at=now() where id=$1 and roadmap_attempt_id=$3", [queued.id,
    { schemaVersion: 1, code: "validation-failed" }, attempt]);
  expect((await reopen(queued.id)).roadmap).toMatchObject({ status: "failed", attemptId: attempt, error: { code: "validation-failed" } });
  const retry = await db.query<{ attempt_id: string }>("select * from reserve_assessment_roadmap($1,$2)", [queued.id, new Date(0)]);
  expect(retry.rows[0].attempt_id).not.toBe(attempt);
  const late = await db.query(`update assessments set roadmap_status='failed',roadmap_error=$2,roadmap_completed_at=now()
    where id=$1 and roadmap_attempt_id=$3 and roadmap_status='pending' returning id`, [queued.id,
    { schemaVersion: 1, code: "internal" }, attempt]);
  expect(late.rows).toHaveLength(0);
  const reopened = await reopen(queued.id);
  expect(reopened.roadmap).toMatchObject({ status: "pending", attemptId: retry.rows[0].attempt_id, content: null, error: null });
  expect(reopened.result).toEqual(local);
  expect(m.claude).not.toHaveBeenCalled(); expect(external).not.toHaveBeenCalled();
});
