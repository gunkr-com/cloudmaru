// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
const boundary = vi.hoisted(() => ({ db: null as PGlite | null, provider: vi.fn() }));
vi.mock("./db/client", () => ({ getDb: async () => boundary.db! }));
vi.mock("./claude", async original => ({ ...await original<typeof import("./claude")>(), requestStructuredOutput: boundary.provider }));
vi.mock("./operator-prices", async () => {
  const { loadCatalog } = await import("@/lib/catalog/load");
  const { loadExtensionSupportCatalog } = await import("@/lib/catalog/extension-support");
  return { acquireOperatorPrices: async () => {
    const catalog = loadCatalog();
    return { ok: true, catalog, support: loadExtensionSupportCatalog(catalog) };
  } };
});
import { createExtensionJobServices } from "./extension-job";
import { ClaudeError } from "./claude";
import { createTestDatabase, insertTestWorkspace } from "@/lib/db/test-db.test-data";
import { createScansDb } from "./db/scans";
import { createExtensionsDb } from "./db/extensions";
import { fixture, proposalInput, proposalInventory, proposalScan } from "@/lib/extend/proposal.test-data";
import { summarizeInventory } from "@/lib/inventory/summarize";
import { loadExtensionSupportCatalog } from "@/lib/catalog/extension-support";
import { loadCatalog } from "@/lib/catalog/load";
import type { ExtensionInput } from "@/types/extension";
import { unsafeClaimsAndLiterals } from "@/lib/extend/prose-policy.test-data";

let db: PGlite;
let input: ExtensionInput;
let services: ReturnType<typeof createExtensionJobServices>;
let store: ReturnType<typeof createExtensionsDb>;
const usage = { promptTokens: 321, completionTokens: 123, costUsd: 0.04 };
let task: (() => Promise<void>) | undefined;
const schedule = (next: () => Promise<void>) => { task = next; };
async function start(sourceExtensionId?: string, workspaceId = input.workspaceId) {
  const result = await services.start({ workspaceId, body: input, sourceExtensionId }, schedule);
  expect(result.status).toBe(202);
  if (result.status !== 202) throw Error("start failed");
  return result.id;
}
async function calls() { return (await db.query("select * from llm_calls where source='extension'")).rows; }
beforeEach(async () => {
  db = await createTestDatabase();
  boundary.db = db;
  const workspaceId = await insertTestWorkspace(db);
  await db.query("update workspaces set claude_api_key_env='CLOUDSIGHT_CLAUDE_KEY_TEST' where id=$1", [workspaceId]);
  const sourceScanId = await createScansDb({ db: async () => db }).createImportScan({ workspaceId,
    subscriptionIds: proposalScan.subscriptionIds, inventory: structuredClone(proposalInventory),
    summary: proposalScan.summary!, collectedAt: proposalScan.collectedAt! });
  input = { ...proposalInput, workspaceId, sourceScanId };
  services = createExtensionJobServices({ db: async () => db });
  store = createExtensionsDb({ db: async () => db });
  vi.stubEnv("CLOUDSIGHT_CLAUDE_KEY_TEST", "fake-company-key");
  vi.stubEnv("ANTHROPIC_API_KEY", "fake-personal-key");
  boundary.provider.mockReset().mockResolvedValue({ data: fixture().raw, usage, model: "synthetic" });
  task = undefined;
});
afterEach(async () => {
  vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks();
  await db.close(); boundary.db = null;
});
it("logs first and retry validation diagnostics while retaining failure billing and safe DTOs", async()=>{
 const log=vi.spyOn(console,"info").mockImplementation(()=>{});
 const raw=fixture().raw;raw.plans[0].title={en:"sk-ant-private-company-value",ko:"검토합니다."};
 boundary.provider.mockResolvedValue({data:raw,usage});
 const id=await start();await task!();
 const events=log.mock.calls.filter(call=>call[0]==="[cloudsight:extension-validation]");
 expect(events).toHaveLength(2);
 expect(events[0][1]).toMatchObject({id,attempt:1,valid:false});
 expect(events[1][1]).toMatchObject({id,attempt:2,valid:false});
 expect(JSON.stringify(events)).not.toContain("sk-ant-private-company-value");
 expect(await store.getExtension(id)).toMatchObject({status:"failed",usage:{promptTokens:642,completionTokens:246,costUsd:0.08}});
 expect(await calls()).toHaveLength(1);
});
it("shares stale recovery between detail and history with an exclusive boundary", async () => {
  const id = await start();
  const row = (await store.getExtension(id))!;
  const instant = Date.parse(row.createdAt) + 330_000;
  let now = instant;
  const reads = createExtensionJobServices({ db: async () => db, now: () => new Date(now) });
  expect((await reads.get(id))!.status).toBe("pending");
  expect((await reads.list(input.workspaceId))[0].status).toBe("pending");
  now++;
  expect((await reads.list(input.workspaceId))[0]).toMatchObject({ status: "failed", error: { code: "interrupted" } });
  expect((await reads.get(id))!.status).toBe("failed");
  expect(boundary.provider).not.toHaveBeenCalled();
});
it.each(["get", "list"] as const)("%s rereads a concurrent real success when stale failure loses the race", async operation => {
  const id = await start();
  const row = (await store.getExtension(id))!;
  let finish!: () => void;
  boundary.provider.mockImplementation(() => new Promise(resolve => {
    finish = () => resolve({ data: fixture().raw, usage });
  }));
  const running = task!();
  await vi.waitFor(() => expect(boundary.provider).toHaveBeenCalledTimes(1));
  let acquisitions = 0;
  const reads = createExtensionJobServices({
    now: () => new Date(Date.parse(row.createdAt) + 330_001),
    db: async () => {
      // 첫 read는 pending, 조건부 fail 직전에 실제 워커가 성공을 저장한다.
      if (++acquisitions === 2) { finish(); await running; }
      return db;
    },
  });
  const result = operation === "get" ? await reads.get(id) : (await reads.list(input.workspaceId))[0];
  expect(result).toMatchObject({ id, status: "succeeded", usage });
  expect((await store.getExtension(id))!.status).toBe("succeeded");
  expect(await calls()).toHaveLength(1);
});
it("reserves, reloads, prompts, validates and stores real cost/checks plus one bill with pinned evidence", async () => {
  input.description = "가".repeat(2000);
  const id = await start();
  expect(boundary.provider).not.toHaveBeenCalled();
  expect((await store.getExtension(id))!.status).toBe("pending");
  await task!();
  const row = (await store.getExtension(id))!;
  expect(row).toMatchObject({ status: "succeeded", workspaceId: input.workspaceId, sourceScanId: input.sourceScanId, usage });
  expect(row.result!.plans).toHaveLength(3);
  expect(row.result!.contextCoverage).toEqual({ total: 4, included: 4, excluded: 0, reasons: [] });
  const request = boundary.provider.mock.calls[0][0];
  expect(request.apiKeyEnv).toBe("CLOUDSIGHT_CLAUDE_KEY_TEST");
  expect(request.user).toContain(input.description);
  expect(request.user).not.toMatch(/sample-vnet|sample-plan|\/subscriptions\/|aliasToResourceId|"unitPrice"|"meterId"|"prices"|10\.1\.0/);
  expect(request.schemaName).toBeTruthy();
  expect(request.jsonSchema).toBeTruthy();
  expect(await calls()).toHaveLength(1);
  const costs = row.result!.plans[0].incrementalCost;
  expect(costs.state).toBe("available");
  if (costs.state !== "available") throw Error("missing cost");
  expect(costs.data.lines.find(line => line.componentId === "log-analytics-ingestion")!.amount).toBeGreaterThan(0);
  expect(costs.data.lines.find(line => line.componentId === "virtual-network-subnet")!.amount).toBe(0);
  const catalog = structuredClone(loadCatalog()); catalog.prices.asOf = "2027-01-01";
  const later = createExtensionsDb({ db: async () => db, coreData: { catalog, support: (await store.getExtensionCoreData(id))!.support } });
  expect(await later.getExtension(id)).toEqual(row);
  await task!();
  expect(boundary.provider).toHaveBeenCalledTimes(1);
});
it.each(["alias", "catalog", "price"])("rejects invalid %s, retries just once, preserves aggregate bill", async kind => {
  const raw = fixture().raw;
  if (kind === "alias") raw.plans[0].reusedResources[0].resourceId = "r999999";
  if (kind === "catalog") raw.plans[0].newItems[0].componentId = "invented-component";
  if (kind === "price") Object.assign(raw, { total: 0 });
  boundary.provider.mockResolvedValue({ data: raw, usage });
  const id = await start(); await task!();
  expect((await store.getExtension(id))!).toMatchObject({ status: "failed", error: { code: "validation-failed" }, usage: {
    promptTokens: 642, completionTokens: 246, costUsd: 0.08 } });
  expect(boundary.provider).toHaveBeenCalledTimes(2);
  expect(await calls()).toHaveLength(1);
  expect(boundary.provider.mock.calls[1][0].user).toContain("<validation_errors>");
});
it("recovers one invalid response and aggregates both calls without partial billing", async () => {
  boundary.provider.mockResolvedValueOnce({ data: {}, usage });
  const id = await start(); await task!();
  expect((await store.getExtension(id))!).toMatchObject({ status: "succeeded", usage: { promptTokens: 642 } });
  expect(await calls()).toHaveLength(1);
});

it.each(["Use snowflake for monitoring.", "Use DaTaDoG for monitoring.", "데이터독을 사용합니다.", "Cost is ＄１２.", "Cost is ＄\u200b１２.", "Cost is €12."])("rejects unsafe prose through the actual job, retries once and bills known aggregate: %s", async text => {
  const raw = fixture().raw;
  if (text.includes("사용")) raw.recommendationReason.ko = text;
  else raw.recommendationReason.en = text;
  boundary.provider.mockResolvedValue({data: raw, usage});
  const id = await start(); await task!();
  expect(await store.getExtension(id)).toMatchObject({status: "failed", error: {code: "validation-failed"}, result: null,
    usage: {promptTokens: 642, completionTokens: 246, costUsd: 0.08}});
  expect(boundary.provider).toHaveBeenCalledTimes(2);
  expect(boundary.provider.mock.calls[1][0].user).toContain("<validation_errors>");
  expect((await db.query("select result,saved_evidence from extensions where id=$1", [id])).rows)
    .toEqual([{result: null, saved_evidence: null}]);
  expect(await calls()).toHaveLength(1);
});
it.each(unsafeClaimsAndLiterals)("rejects reviewed claim/literal findings through the real job with one retry and aggregate billing: %j", async text => {
  const raw = fixture().raw; raw.recommendationReason = text;
  boundary.provider.mockResolvedValue({data: raw, usage});
  const id = await start(); await task!();
  expect(await store.getExtension(id)).toMatchObject({status: "failed", error: {code: "validation-failed"}, result: null,
    usage: {promptTokens: 642, completionTokens: 246, costUsd: 0.08}});
  expect(boundary.provider).toHaveBeenCalledTimes(2);
  expect((await db.query("select result,saved_evidence from extensions where id=$1", [id])).rows)
    .toEqual([{result: null, saved_evidence: null}]);
  expect(await calls()).toHaveLength(1);
});
it("blocks missing key before reservation even with a personal key", async () => {
  vi.stubEnv("CLOUDSIGHT_CLAUDE_KEY_TEST", "");
  expect(await services.start({ workspaceId: input.workspaceId, body: input }, schedule)).toEqual({
    status: 409, code: "claude-unavailable", workspaceId: input.workspaceId });
  expect(await store.listExtensions(input.workspaceId)).toEqual([]);
  expect(boundary.provider).not.toHaveBeenCalled();
});
it.each(["after-reserve", "retry"])("rereads the saved owner key at %s and never falls back", async phase => {
  const id = await start();
  if (phase === "after-reserve") vi.stubEnv("CLOUDSIGHT_CLAUDE_KEY_TEST", "");
  else boundary.provider.mockImplementationOnce(async () => {
    await db.query("update workspaces set claude_api_key_env=null where id=$1", [input.workspaceId]);
    return { data: {}, usage };
  });
  await task!();
  expect((await store.getExtension(id))!).toMatchObject({ status: "failed", error: { code: "not-configured" } });
  expect(boundary.provider).toHaveBeenCalledTimes(phase === "retry" ? 1 : 0);
  expect(await calls()).toHaveLength(phase === "retry" ? 1 : 0);
});
it.each(["config", "timeout", "http", "invalid-response"] as const)("sanitizes provider %s and preserves failure usage", async kind => {
  boundary.provider.mockRejectedValue(new ClaudeError(kind, "private-provider-response", kind === "http" ? 429 : undefined, usage));
  const id = await start(); await task!();
  const row = (await store.getExtension(id))!;
  expect(row).toMatchObject({ status: "failed", usage, error: { code: {
    config: "not-configured", timeout: "timeout", http: "throttled", "invalid-response": "invalid-response",
  }[kind] } });
  expect(JSON.stringify(row)).not.toContain("private-provider-response");
  expect(await calls()).toHaveLength(1);
});
it("keeps reanalysis on its original owner despite a different current cookie", async () => {
  const parent = await start(); await task!();
  const original = await store.getExtension(parent);
  const other = await insertTestWorkspace(db);
  input.monthlyBudget = 500;
  const child = await start(parent, other); await task!();
  expect(child).not.toBe(parent);
  expect(await store.getExtension(child)).toMatchObject({ sourceExtensionId: parent, workspaceId: input.workspaceId,
    sourceScanId: input.sourceScanId, status: "succeeded", input: { monthlyBudget: 500 } });
  expect(await store.getExtension(parent)).toEqual(original);
  expect(await store.listExtensions(other)).toEqual([]);
});
it("rejects rebinding a reanalysis to a newer scan of the same owner before reservation", async () => {
  const parent = await start(); await task!();
  const original = await store.getExtension(parent);
  input.sourceScanId = await createScansDb({ db: async () => db }).createImportScan({ workspaceId: input.workspaceId,
    subscriptionIds: proposalScan.subscriptionIds, inventory: structuredClone(proposalInventory),
    summary: proposalScan.summary!, collectedAt: proposalScan.collectedAt! });
  const scheduleNext = vi.fn();
  expect(await services.start({ workspaceId: input.workspaceId, body: input, sourceExtensionId: parent }, scheduleNext))
    .toEqual({ status: 409, code: "invalid-source" });
  expect(scheduleNext).not.toHaveBeenCalled();
  expect(await store.listExtensions(input.workspaceId)).toEqual([original]);
  expect(boundary.provider).toHaveBeenCalledTimes(1);
});
it.each([25, 205])("records %s extra supported resources with explicit coverage", async extra => {
  const inventory = structuredClone(proposalInventory);
  for (let i = 0; i < extra; i++) {
    const resource = structuredClone(inventory.resources[1]); resource.name = `z-extra-${i}`;
    resource.id = resource.id.slice(0, resource.id.lastIndexOf("/") + 1) + resource.name;
    inventory.resources.push(resource);
  }
  input.sourceScanId = await createScansDb({ db: async () => db }).createImportScan({ workspaceId: input.workspaceId,
    subscriptionIds: proposalScan.subscriptionIds, inventory, summary: summarizeInventory(inventory.resources, []),
    collectedAt: proposalScan.collectedAt! });
  const id = await start(); await task!();
  expect((await store.getExtension(id))!.result!.contextCoverage).toEqual({ total: 4 + extra, included: Math.min(200, 4 + extra), excluded: Math.max(0, 4 + extra - 200),
    reasons: extra > 200 ? [{ code: "context-limit", count: 9 }] : [] });
});
it("fails scheduling without a model or bill, and sanitizes database errors", async () => {
  expect(await services.start({ workspaceId: input.workspaceId, body: input }, () => { throw Error("scheduler-secret"); }))
    .toEqual({ status: 500, code: "internal" });
  expect((await store.listExtensions(input.workspaceId))[0]).toMatchObject({ status: "failed", error: { code: "internal" } });
  const broken = createExtensionJobServices({ db: async () => { throw Error("private-database"); } });
  expect(await broken.start({ workspaceId: input.workspaceId, body: input }, schedule)).toEqual({ status: 500, code: "internal" });
  expect(boundary.provider).not.toHaveBeenCalled();
});

it.each(["timeout", "stale"])("preserves the %s terminal state and bills a late aggregate once", async mode => {
  const id = await start();
  const row = (await store.getExtension(id))!;
  let clock = Date.parse(row.createdAt);
  const runner = createExtensionJobServices({ db: async () => db, now: () => new Date(clock) });
  const entered = Promise.withResolvers<void>();
  const late = Promise.withResolvers<{ data: unknown; usage: typeof usage }>();
  boundary.provider.mockResolvedValueOnce({ data: {}, usage }).mockImplementationOnce(() => {
    entered.resolve(); return late.promise;
  });
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const run = runner.runJob(id, { catalog: loadCatalog(), support: loadExtensionSupportCatalog() });
  await entered.promise;
  if (mode === "timeout") {
    clock += 300_000;
    await vi.advanceTimersByTimeAsync(300_000);
    await run;
    await vi.waitUntil(async () => (await store.getExtension(id))!.status === "failed", { timeout: 2000 });
  } else await store.failExtension(id, "interrupted");
  const terminated = (await store.getExtension(id))!;
  expect(terminated).toMatchObject({ status: "failed", error: { code: mode === "timeout" ? "timeout" : "interrupted" }, usage: null });
  expect(await calls()).toHaveLength(0);
  late.resolve({ data: fixture().raw, usage });
  vi.useRealTimers();
  await run;
  // 반환한 timeout 호출과 분리된 늦은 사용량 저장까지 기다린다.
  await vi.waitUntil(async () => (await calls()).length === 1, { timeout: 2000 });
  const final = (await store.getExtension(id))!;
  expect(final).toMatchObject({ status: "failed", error: terminated.error, completedAt: terminated.completedAt,
    usage: { promptTokens: 642, completionTokens: 246, costUsd: 0.08 } });
  expect(final.result).toBeNull();
  expect(boundary.provider).toHaveBeenCalledTimes(2);
});

it("marks old pending interrupted without calling a provider", async () => {
  const id = await start();
  const row = (await store.getExtension(id))!;
  const old = createExtensionJobServices({ db: async () => db, now: () => new Date(Date.parse(row.createdAt) + 331_000) });
  await old.runJob(id, { catalog: loadCatalog(), support: loadExtensionSupportCatalog() });
  expect(await store.getExtension(id)).toMatchObject({ status: "failed", error: { code: "interrupted" } });
  expect(boundary.provider).not.toHaveBeenCalled();
});

it("keeps the single aggregate bill when the result UPDATE fails and stores a sanitized failure", async () => {
  const id = await start();
  const query = db.query.bind(db);
  let rejectWrite = true;
  vi.spyOn(db, "query").mockImplementation(async (...args: Parameters<typeof db.query>) => {
    if (rejectWrite && String(args[0]).startsWith("update extensions set status='succeeded'")) {
      rejectWrite = false; throw Error("private-storage-write");
    }
    return query(...args);
  });
  await task!();
  expect(await store.getExtension(id)).toMatchObject({ status: "failed", error: { code: "internal" }, usage });
  expect(await calls()).toHaveLength(1);
});

it("charges unverified leading free grants for both new metered items and usage increases", async () => {
  const raw = fixture().raw;
  raw.plans[0].reusedResources = raw.plans[0].reusedResources.filter(item => item.componentId !== "log-analytics-ingestion");
  raw.plans[0].usageIncreases = raw.plans[0].usageIncreases.filter(item => item.componentId !== "log-analytics-ingestion");
  raw.plans[0].newItems.push({ componentId: "log-analytics-ingestion", quantity: 1, instanceCount: 1 });
  boundary.provider.mockResolvedValue({ data: raw, usage });
  const id = await start(); await task!();
  const result = (await store.getExtension(id))!.result!;
  for (const plan of result.plans) {
    expect(plan.incrementalCost.state).toBe("available");
    if (plan.incrementalCost.state !== "available") throw Error("cost unavailable");
    const logs = plan.incrementalCost.data.lines.find(line => line.componentId === "log-analytics-ingestion")!;
    expect(logs.kind).toBe(plan.tier === "low" ? "new" : "usage-increase");
    expect(logs.amount).toBeGreaterThan(0);
  }
});

it("settles stale pending rows on older history pages without dropping the cursor or invoking providers", async () => {
  for (let i = 0; i < 25; i++) await store.reserveExtension(input);
  await db.query("update extensions set created_at='2026-11-12T00:00:00.123456Z'");
  const reads = createExtensionJobServices({ db: async () => db, now: () => new Date("2026-11-13T00:00:00Z") });
  const first = await reads.list(input.workspaceId, { limit: 20 });
  const second = await reads.list(input.workspaceId, { limit: 20, beforeId: first.at(-1)!.id });
  expect(first).toHaveLength(20); expect(second).toHaveLength(5);
  expect(new Set([...first, ...second].map(row => row.id)).size).toBe(25);
  expect(second.every(row => row.status === "failed" && row.error?.code === "interrupted")).toBe(true);
  expect(boundary.provider).not.toHaveBeenCalled();
});
