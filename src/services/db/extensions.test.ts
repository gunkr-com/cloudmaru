// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDatabase, insertTestWorkspace } from "@/lib/db/test-db.test-data";
import { completeSnapshot, extension, ids, legacySnapshot, partialSnapshot } from "@/lib/completion/fixtures.test-data";
import { loadCatalog } from "@/lib/catalog/load";
import { createExtensionRequestContext } from "@/lib/extend/validate-proposal";
import { fixture } from "@/lib/extend/proposal.test-data";
import { processExtensionOutput } from "@/lib/extend/process";
import legacyEvidence from "@/lib/extend/legacy-evidence.test-data.json";
import type { ExtensionInput, ExtensionResult } from "@/types/extension";
import type { ScanInventory, ScanRecord } from "@/types/scan";
import { createScansDb } from "./scans";
import { createExtensionsDb } from "./extensions";

let db: PGlite;
let store: ReturnType<typeof createExtensionsDb>;
let input: ExtensionInput;
const usage = { promptTokens: 120, completionTokens: 45, costUsd: 0.03 };
const catalog = loadCatalog();
// 저장 계층 추가 DI는 제약만 더하며 실제 코어 검증은 항상 실행한다.
const validateResult = vi.fn((result: ExtensionResult) => {
  expect(result.plans).toHaveLength(3);
  expect(result.catalogVersion).toMatch(/^extend-core-v1:sha256:/);
});
async function makeResult(id: string): Promise<ExtensionResult> {
  const row = (await store.getExtension(id))!;
  const saved = (await store.getExtensionSourceScan(row.sourceScanId))!;
  const context = createExtensionRequestContext(row.input, saved.scan, saved.inventory, catalog);
  const { raw } = fixture();
  for (const plan of raw.plans) {
    plan.reusedResources = [];
    plan.usageIncreases = [];
    plan.subnetProposals = [];
    plan.newItems = [{ componentId: plan.tier === "ha" ? "app-service-linux-p1v3" : "app-service-linux-b1", quantity: plan.tier === "ha" ? 2 : 1, instanceCount: plan.tier === "ha" ? 2 : 1 }];
  }
  const processed = processExtensionOutput(raw, context, { id, createdAt: row.createdAt });
  if (!processed.ok) throw Error(JSON.stringify(processed.errors));
  return processed.value;
}
async function importSnapshot(snapshot: { record: ScanRecord; inventory: ScanInventory } = completeSnapshot) {
  return createScansDb({ db: async () => db }).createImportScan({ workspaceId: input.workspaceId,
    subscriptionIds: snapshot.record.subscriptionIds, inventory: snapshot.inventory,
    summary: snapshot.record.summary!, collectedAt: snapshot.record.collectedAt! });
}
beforeEach(async () => {
  db = await createTestDatabase();
  const workspaceId = await insertTestWorkspace(db);
  input = { ...extension.input, workspaceId };
  input.sourceScanId = await importSnapshot();
  store = createExtensionsDb({ db: async () => db, validateResult });
  validateResult.mockClear();
});
afterEach(async () => { await db.close(); vi.restoreAllMocks(); });

it("requires pinned evidence only for opted-in display reads while preserving legacy API reads", async () => {
  const row = (await store.reserveExtension(input))!;
  expect(await store.getExtension(row.id, { requireSavedEvidence: true })).toMatchObject({ status: "pending" });
  const result = await makeResult(row.id);
  await store.completeExtension(row.id, result);
  const pinned = await store.getExtension(row.id, { requireSavedEvidence: true });
  expect(pinned?.result).toEqual(result);
  expect(JSON.stringify(pinned)).not.toContain("saved_evidence");
  await db.query("update extensions set saved_evidence=null where id=$1", [row.id]);
  expect((await store.getExtension(row.id))?.result).toEqual(result);
  const loader = await import("@/lib/catalog/load");
  const current = vi.spyOn(loader, "loadCatalog").mockImplementation(() => { throw Error("current must not load"); });
  await expect(store.getExtension(row.id, { requireSavedEvidence: true })).rejects.toThrow("validation-failed");
  expect(current).not.toHaveBeenCalled();
  expect(await store.getExtension("invalid", { requireSavedEvidence: true })).toBeNull();
  expect(await store.getExtension(ids.extension, { requireSavedEvidence: true })).toBeNull();
});

it("rejects new writes without cardinality even when their older saved shape is valid", async () => {
  const row = (await store.reserveExtension(input))!;
  const result = await makeResult(row.id);
  for (const plan of result.plans) for (const item of plan.newItems) delete item.instanceCount;
  await expect(store.completeExtension(row.id, result)).rejects.toThrow("validation-failed");
  expect((await store.getExtension(row.id))?.status).toBe("pending");
});

it.each([true, false])("roundtrips pre-cardinality historical rows exactly (pinned=%s)", async pinned => {
  const legacy = structuredClone(legacyEvidence);
  await db.query("insert into workspaces(id,name) values($1,'Synthetic legacy')", [legacy.result.workspaceId]);
  const scan = legacy.source.scan;
  await db.query(`insert into scans(id,workspace_id,status,source,subscription_ids,summary,inventory,collected_at,created_at,completed_at)
    values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [scan.id, scan.workspaceId, scan.status, scan.source,
    scan.subscriptionIds, scan.summary, legacy.source.inventory, scan.collectedAt, scan.createdAt, scan.completedAt]);
  const result = legacy.result;
  await db.query(`insert into extensions(id,workspace_id,source_scan_id,status,input,result,saved_evidence,created_at,completed_at)
    values($1,$2,$3,'succeeded',$4,$5,$6,$7,$8)`, [result.id, result.workspaceId, result.sourceScanId,
    result.input, result, pinned ? legacy.evidence : null, result.createdAt, result.createdAt]);
  expect((await store.getExtension(result.id))?.result).toEqual(result);
  expect((await store.listExtensions(result.workspaceId))[0].result).toEqual(result);
  const rows = await db.query<{result: unknown; saved_evidence: unknown}>("select result,saved_evidence from extensions where id=$1", [result.id]);
  expect(rows.rows[0]).toEqual({result, saved_evidence: pinned ? legacy.evidence : null});
});

it("reserves, completes, reads and lists a saved result with bound inventory/provenance", async () => {
  const first = (await store.reserveExtension(input))!;
  const second = (await store.reserveExtension(input))!;
  expect(first).toMatchObject({ status: "pending", created: true });
  expect(first.id).not.toBe(second.id);
  const result = await makeResult(first.id);
  expect(await store.completeExtension(first.id, result, usage)).toBe(true);
  const saved = await store.getExtension(first.id);
  expect(saved).toMatchObject({ status: "succeeded", input, result, usage,
    sourceScan: { id: input.sourceScanId, workspaceId: input.workspaceId,
      completeness: { reasons: ["import-scope-unverified", "legacy-completeness-unknown"] } } });
  expect(validateResult).toHaveBeenCalledWith(result, expect.objectContaining({ inventory: completeSnapshot.inventory, sourceScan: saved!.sourceScan, input }));
  expect(await store.listExtensions(input.workspaceId)).toHaveLength(2);
  expect(await store.listExtensions(input.workspaceId, { sourceScanId: ids.oldScan })).toEqual([]);
  expect(await store.listExtensions(await insertTestWorkspace(db))).toEqual([]);
  await importSnapshot(); // 새 스캔이나 다른 회사 선택은 원래 결과를 바꾸지 않는다.
  await insertTestWorkspace(db, "Other selected workspace");
  expect(await store.getExtension(first.id)).toEqual(saved);
  expect((await store.getExtensionSourceScan(input.sourceScanId))?.inventory).toEqual(completeSnapshot.inventory);
});

it("fails once, reanalyses failed parents as new rows, and never rebinds owner", async () => {
  const first = (await store.reserveExtension(input))!;
  expect(await store.failExtension(first.id, "validation-failed", usage)).toBe(true);
  expect(await store.failExtension(first.id, "internal", usage)).toBe(false);
  expect(await store.getExtension(first.id)).toMatchObject({ status: "failed", result: null, usage, error: { schemaVersion: 1, code: "validation-failed" } });
  const next = (await store.reserveExtension(input, { sourceExtensionId: first.id }))!;
  expect(next.id).not.toBe(first.id);
  expect(await store.getExtension(next.id)).toMatchObject({ sourceExtensionId: first.id, input });
  const otherWorkspaceId = await insertTestWorkspace(db);
  const otherScanId = await createScansDb({ db: async () => db }).createImportScan({ workspaceId: otherWorkspaceId,
    subscriptionIds: completeSnapshot.record.subscriptionIds, inventory: completeSnapshot.inventory,
    summary: completeSnapshot.record.summary!, collectedAt: completeSnapshot.record.collectedAt! });
  expect(await store.reserveExtension({ ...input, workspaceId: otherWorkspaceId, sourceScanId: otherScanId }, { sourceExtensionId: first.id })).toBeNull();
});

it("rejects malformed input and missing/failed/cross-company source scans before reservation", async () => {
  for (const invalid of [{ ...input, amount: 5 }, { ...input, monthlyBudget: Infinity }, { ...input, schemaVersion: 2 }]) {
    await expect(store.reserveExtension(invalid as ExtensionInput)).rejects.toThrow("validation-failed");
  }
  await expect(store.reserveExtension(input, { sourceExtensionId: "secret-invalid-id" })).rejects.toThrow("validation-failed");
  expect(await store.reserveExtension({ ...input, workspaceId: await insertTestWorkspace(db) })).toBeNull();
  expect(await store.reserveExtension({ ...input, sourceScanId: ids.oldScan })).toBeNull();
  expect(await store.reserveExtension(input, { sourceExtensionId: ids.extension })).toBeNull();
  await db.query("update scans set status='failed',error_code='internal' where id=$1", [input.sourceScanId]);
  expect(await store.reserveExtension(input)).toBeNull();
  expect((await db.query("select id from extensions")).rows).toEqual([]);
});

it("validates actual semantics without an injected validator", async () => {
  const id = (await store.reserveExtension(input))!.id;
  const strict = createExtensionsDb({ db: async () => db });
  const result = await makeResult(id);
  expect(await strict.completeExtension(id, result)).toBe(true);
  expect((await strict.getExtension(id))!.result).toEqual(result);
});

it("rejects wrong envelope/input/provenance, catalog IDs and evidence members", async () => {
  const id = (await store.reserveExtension(input))!.id;
  const good = await makeResult(id);
  const wrongs: unknown[] = [
    { ...good, id: ids.extension }, { ...good, createdAt: "2026-11-12T00:00:00Z" },
    { ...good, workspaceId: ids.otherWorkspace }, { ...good, sourceScanId: ids.oldScan },
    { ...good, input: { ...input, monthlyBudget: 999 } },
    { ...good, sourceScan: { ...good.sourceScan, completeness: { state: "complete", reasons: [] } } },
    { ...good, unexpected: "secret" },
  ];
  const component = structuredClone(good); component.plans[0].newItems[0].componentId = "invented-component"; wrongs.push(component);
  const arch = structuredClone(good); arch.plans[0].referenceArchitectureId = "invented-architecture"; wrongs.push(arch);
  const evidence = structuredClone(good); evidence.plans[0].checks[0].evidence = [{ resourceId: `${completeSnapshot.inventory.resources[0].id}-outside`, propertyPath: "/location", observation: { state: "missing" } }]; wrongs.push(evidence);
  for (const wrong of wrongs) await expect(store.completeExtension(id, wrong)).rejects.toThrow("validation-failed");
  expect((await store.getExtension(id))!.status).toBe("pending");
});

it("validates corrupted stored result/catalog/input/usage on get and list", async () => {
  const id = (await store.reserveExtension(input))!.id;
  const result = await makeResult(id);
  await store.completeExtension(id, result, usage);
  await db.query("update extensions set result=jsonb_set(result,'{plans,0,referenceArchitectureId}','\"invented-architecture\"') where id=$1", [id]);
  await expect(store.getExtension(id)).rejects.toThrow("validation-failed");
  await expect(store.listExtensions(input.workspaceId)).rejects.toThrow("validation-failed");
  await db.query("update extensions set result=$2, usage=$3 where id=$1", [id, result, { ...usage, promptTokens: -1 }]);
  await expect(store.getExtension(id)).rejects.toThrow("validation-failed");
  await db.query("update extensions set usage=$2, input=input || '{\"extra\":true}', result=jsonb_set(result,'{input}',input || '{\"extra\":true}') where id=$1", [id, usage]);
  await expect(store.getExtension(id)).rejects.toThrow("validation-failed");
});

it("keeps known usage despite invalid output, idempotent failure, and concurrent late terminal calls", async () => {
  const id = (await store.reserveExtension(input))!.id;
  await expect(store.completeExtension(id, {}, usage)).rejects.toThrow("validation-failed");
  expect((await store.getExtension(id))!.usage).toEqual(usage);
  expect(await store.failExtension(id, "validation-failed", usage)).toBe(true);
  const failed = await store.getExtension(id);
  expect(await store.completeExtension(id, await makeResult(id), usage)).toBe(false);
  await Promise.all([store.failExtension(id, "timeout", usage), store.failExtension(id, "internal", usage)]);
  expect(await store.getExtension(id)).toEqual(failed);
  expect((await db.query("select source,source_id,prompt_tokens,completion_tokens,cost_usd from llm_calls")).rows)
    .toEqual([{ source: "extension", source_id: id, prompt_tokens: 120, completion_tokens: 45, cost_usd: 0.03 }]);
  await expect(store.failExtension(id, "internal", { ...usage, promptTokens: 999 })).rejects.toThrow("validation-failed");
});

it("records usage that arrives after interruption without replacing the failure", async () => {
  const id = (await store.reserveExtension(input))!.id;
  const result = await makeResult(id);
  await store.failExtension(id, "interrupted");
  expect(await store.completeExtension(id, result, { ...usage, costUsd: null })).toBe(false);
  expect(await store.getExtension(id)).toMatchObject({ status: "failed", error: { code: "interrupted" }, usage: { ...usage, costUsd: null } });
  expect((await db.query("select cost_usd from llm_calls where source_id=$1", [id])).rows).toEqual([{ cost_usd: null }]);
});

it("does not replace successful results and retains billing after the parent is deleted", async () => {
  const id = (await store.reserveExtension(input))!.id;
  const result = await makeResult(id);
  await store.completeExtension(id, result, usage);
  const saved = await store.getExtension(id);
  expect(await store.completeExtension(id, {}, usage)).toBe(false);
  expect(await store.failExtension(id, "timeout", usage)).toBe(false);
  expect(await store.getExtension(id)).toEqual(saved);
  await db.query("delete from extensions where id=$1", [id]);
  expect((await db.query("select source_id from llm_calls")).rows).toEqual([{ source_id: id }]);
});

it("detects a stored source/header mismatch and rejects a formerly successful scan", async () => {
  const id = (await store.reserveExtension(input))!.id;
  const result = await makeResult(id);
  await store.completeExtension(id, result);
  // W0 DB 제약은 source ID까지 막는다. DB가 허용하는 timestamp 변조도 읽기 검증이 막아야 한다.
  await db.query(`update extensions set result=jsonb_set(result,'{sourceScan,collectedAt}',
    '"2026-11-01T00:00:00.000Z"') where id=$1`, [id]);
  await expect(store.getExtension(id)).rejects.toThrow("validation-failed");
  await db.query("update scans set status='failed',error_code='internal' where id=$1", [input.sourceScanId]);
  await expect(store.getExtension(id)).rejects.toThrow("validation-failed");
});

it("sanitizes validator exceptions while preserving independently committed usage", async () => {
  const id = (await store.reserveExtension(input))!.id;
  const broken = createExtensionsDb({ db: async () => db, validateResult: () => { throw Error("secret model response"); } });
  await expect(broken.completeExtension(id, await makeResult(id), usage)).rejects.toMatchObject({ code: "validation-failed", message: "validation-failed" });
  expect((await db.query("select source_id from llm_calls")).rows).toEqual([{ source_id: id }]);
});

it("serializes concurrent completion billing and performs one pending-only terminal update", async () => {
  const id = (await store.reserveExtension(input))!.id;
  const result = await makeResult(id);
  const completed = await Promise.all([store.completeExtension(id, result, usage), store.completeExtension(id, result, usage)]);
  expect(completed.filter(Boolean)).toHaveLength(1);
  expect((await db.query("select source_id from llm_calls")).rows).toEqual([{ source_id: id }]);
  expect((await store.getExtension(id))!.status).toBe("succeeded");
});

it("preserves billing if the terminal SQL update fails", async () => {
  const id = (await store.reserveExtension(input))!.id;
  const result = await makeResult(id);
  const query = db.query.bind(db);
  vi.spyOn(db, "query").mockImplementation(((sql: string, ...args: unknown[]) => {
    if (sql.startsWith("update extensions set status='succeeded'")) throw Error("private SQL details");
    return query(sql, ...args as []);
  }) as typeof db.query);
  await expect(store.completeExtension(id, result, usage)).rejects.toThrow("internal");
  expect((await db.query("select source_id from llm_calls")).rows).toEqual([{ source_id: id }]);
  expect((await store.getExtension(id))!.status).toBe("pending");
});

it.each([legacySnapshot, partialSnapshot])("preserves legacy/partial import source coverage", async snapshot => {
  input.sourceScanId = await importSnapshot(snapshot);
  const id = (await store.reserveExtension(input))!.id;
  const result = await makeResult(id);
  expect(result.sourceScan.completeness.reasons).toContain("import-scope-unverified");
  expect(result.sourceScan.completeness.state).not.toBe("complete");
  await store.completeExtension(id, result);
  expect((await store.getExtension(id))!.result!.sourceScan).toEqual(result.sourceScan);
});

it("sanitizes input/storage errors and never opens DB for malformed read IDs", async () => {
  const getDb = vi.fn().mockRejectedValue(Error("secret database path"));
  const unavailable = createExtensionsDb({ db: getDb });
  expect(await unavailable.getExtension("bad")).toBeNull();
  expect(await unavailable.listExtensions("bad")).toEqual([]);
  expect(await unavailable.completeExtension("bad", {}, usage)).toBe(false);
  expect(getDb).not.toHaveBeenCalled();
  await expect(unavailable.getExtension(ids.extension)).rejects.toMatchObject({ message: "internal", code: "internal" });
  const id = (await store.reserveExtension(input))!.id;
  await expect(store.failExtension(id, "private error" as "internal")).rejects.toThrow("validation-failed");
  await expect(store.failExtension(id, "internal", { ...usage, costUsd: Infinity })).rejects.toThrow("validation-failed");
  expect((await db.query("select id from llm_calls")).rows).toEqual([]);
});

it("rejects malformed counted results after evidence loss instead of entering legacy replay",async()=>{
 const id=(await store.reserveExtension(input))!.id;const result=await makeResult(id);
 await store.completeExtension(id,result);
 const item=result.plans[0].newItems.find(i=>i.instanceCount!>0)!;item.instanceCount=0;
 await db.query("update extensions set result=$2,saved_evidence=null where id=$1",[id,result]);
 await expect(store.getExtension(id)).rejects.toThrow("validation-failed");
 await expect(store.listExtensions(input.workspaceId)).rejects.toThrow("validation-failed");
});

it("pages more than twenty tied records without duplicates and rejects foreign/missing anchors", async () => {
  const rows = [];
  for (let i = 0; i < 45; i++) rows.push((await store.reserveExtension(input))!);
  // Preserve sub-millisecond precision; JS Date roundtrips must not skip rows.
  await db.query("update extensions set created_at='2026-11-12T10:00:00.123456Z'");
  const all = await store.listExtensions(input.workspaceId, { limit: 100 });
  const first = await store.listExtensions(input.workspaceId);
  const second = await store.listExtensions(input.workspaceId, { beforeId: first.at(-1)!.id });
  const third = await store.listExtensions(input.workspaceId, { beforeId: second.at(-1)!.id });
  expect([first.length, second.length, third.length]).toEqual([20, 20, 5]);
  expect([...first, ...second, ...third].map(r => r.id)).toEqual(all.map(r => r.id));
  const other = await insertTestWorkspace(db);
  await expect(store.listExtensions(other, { beforeId: first[0].id })).rejects.toThrow("validation-failed");
  await expect(store.listExtensions(input.workspaceId, { beforeId: "private-invalid" })).rejects.toThrow("validation-failed");
  await expect(store.listExtensions(input.workspaceId, { beforeId: first[0].id, sourceScanId: ids.oldScan })).rejects.toThrow("validation-failed");
  await db.query("delete from extensions where id=$1", [first.at(-1)!.id]);
  await expect(store.listExtensions(input.workspaceId, { beforeId: first.at(-1)!.id })).rejects.toThrow("validation-failed");
});

it("replays an unsealed result only with matching operator pricing and still rejects structural corruption", async () => {
  const { loadExtensionSupportCatalog } = await import("@/lib/catalog/extension-support");
  const support = loadExtensionSupportCatalog(catalog);
  const readOperatorPrices = vi.fn(async () => ({ catalog, support }) as { catalog: typeof catalog; support: typeof support } | null);
  const live = createExtensionsDb({ db: async () => db, readOperatorPrices });
  const row = (await store.reserveExtension(input))!;
  const result = await makeResult(row.id);
  await store.completeExtension(row.id, result);
  expect((await live.getExtension(row.id))?.result).toEqual(result);
  expect(readOperatorPrices).not.toHaveBeenCalled();

  await db.query("update extensions set saved_evidence=null where id=$1", [row.id]);
  expect((await live.getExtension(row.id))?.result).toEqual(result);
  readOperatorPrices.mockResolvedValueOnce({ catalog: { ...catalog, prices: { ...catalog.prices, asOf: "2034-01-01" } }, support });
  expect((await live.getExtension(row.id))?.result).toBeNull();
  readOperatorPrices.mockResolvedValue(null);
  expect((await live.listExtensions(input.workspaceId))[0].result).toBeNull();

  result.plans[0].newItems[0].componentId = "unknown-component";
  await db.query("update extensions set result=$2 where id=$1", [row.id, result]);
  await expect(live.getExtension(row.id)).rejects.toThrow("validation-failed");
});
