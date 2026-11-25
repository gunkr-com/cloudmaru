// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDatabase, insertTestWorkspace } from "@/lib/db/test-db.test-data";
import { processedFixture } from "@/lib/extend/proposal.test-data";
import { createExtensionRequestContext } from "@/lib/extend/validate-proposal";
import { processExtensionOutput } from "@/lib/extend/process";
import type { ExtensionArtifact, ExtensionArtifactRequest } from "@/types/extension";
import { createScansDb } from "./scans";
import { createExtensionsDb } from "./extensions";
import { createExtensionArtifactsDb, type ArtifactSemanticValidator } from "./extension-artifacts";
import { completeExtensionArtifact as defaultComplete } from "./extension-artifacts";
import { compilerFixture } from "@/lib/extend-artifacts/compiler.test-data";
import { bindBicepSource, createBicepContext } from "@/lib/extend-artifacts/bicep-semantics";

vi.mock("./client", () => ({ getDb: async () => db }));

let db: PGlite;
let store: ReturnType<typeof createExtensionArtifactsDb>;
let parents: ReturnType<typeof createExtensionsDb>;
let request: ExtensionArtifactRequest;
const f = processedFixture();
const usage = { promptTokens: 12, completionTokens: 5, costUsd: 0.01 };
const secondUsage = { promptTokens: 20, completionTokens: 10, costUsd: 0.03 };
const text = { en: "Attach the new workload", ko: "새 워크로드를 연결합니다." };
const guide = { overview: text, prerequisites: [text], cautions: [], steps: [{ title: text, goal: text,
  instructions: [text], componentIds: ["postgres-flex-b1ms"], reusedResourceIds: [f.result.plans[0].reusedResources[0].resourceId], verification: text }] };
// Test-only validator accepts this ONE reviewed synthetic guide, never arbitrary model code/content.
const semantic = vi.fn<ArtifactSemanticValidator>(async value => {
  if (value.kind !== "guide" || JSON.stringify(value.content) !== JSON.stringify(guide)) throw Error("not-reviewed-fixture");
  return { policyVersion: "reviewed-fixture-v1" };
});
async function artifact(id: string): Promise<ExtensionArtifact> {
  const row = (await store.getExtensionArtifact(id))!;
  return { schemaVersion: 1, id, workspaceId: row.workspaceId, extensionId: row.extensionId,
    sourceScanId: row.sourceScanId, tier: row.tier, kind: "guide", createdAt: row.createdAt, content: structuredClone(guide) };
}
async function reserve() { return (await store.reserveExtensionArtifact(request, { staleBefore: new Date(0) }))!; }
async function renew() {
  return (await store.reserveExtensionArtifact(request, { staleBefore: new Date(Date.now() + 60_000) }))!;
}
async function calls() { return (await db.query<{ source_id: string }>("select * from llm_calls where source='extension-artifact'")).rows; }
beforeEach(async () => {
  db = await createTestDatabase();
  const workspaceId = await insertTestWorkspace(db);
  const scanId = await createScansDb({ db: async () => db }).createImportScan({ workspaceId,
    subscriptionIds: f.context.scan.subscriptionIds, inventory: f.context.inventory,
    summary: f.context.scan.summary!, collectedAt: f.context.scan.collectedAt! });
  parents = createExtensionsDb({ db: async () => db });
  const input = { ...f.result.input, workspaceId, sourceScanId: scanId };
  const reserved = (await parents.reserveExtension(input))!;
  const saved = (await parents.getExtensionSourceScan(scanId))!;
  const parent = (await parents.getExtension(reserved.id))!;
  const context = createExtensionRequestContext(input, saved.scan, saved.inventory, f.context.catalog, { support: f.context.support });
  const processed = processExtensionOutput(f.raw, context, { id: parent.id, createdAt: parent.createdAt });
  if (!processed.ok) throw Error(processed.errors.join(","));
  await parents.completeExtension(parent.id, processed.value);
  store = createExtensionArtifactsDb({ db: async () => db, validateArtifact: semantic });
  request = { schemaVersion: 1, extensionId: parent.id, tier: "low", kind: "guide" };
  semantic.mockClear();
});
afterEach(async () => { await db.close(); vi.restoreAllMocks(); vi.unstubAllEnvs(); });

// Real-compiler contract (docs/SELF_HOSTING.md#native-bicep-compiler): CLOUDSIGHT_TEST_BICEP_PATH names the pinned CLI; unset skips explicitly, a wrong path fails.
const realCompiler = process.env.CLOUDSIGHT_TEST_BICEP_PATH ?? "";
it.skipIf(!realCompiler)("production validator compiles exact saved17 Bicep, atomically retains compiler/attempt evidence and never recompiles reads/reuse", async () => {
  const synthetic = compilerFixture();
  const saved = (await parents.getExtensionSourceScan((await parents.getExtension(request.extensionId))!.sourceScanId))!;
  const input = { ...synthetic.basis.extension.input, workspaceId: saved.scan.workspaceId, sourceScanId: saved.scan.id };
  const pending = (await parents.reserveExtension(input))!;
  const parent = (await parents.getExtension(pending.id))!;
  const context = createExtensionRequestContext(input, saved.scan, saved.inventory, synthetic.f.context.catalog, { support: synthetic.f.context.support });
  const processed = processExtensionOutput(synthetic.f.raw, context, { id: parent.id, createdAt: parent.createdAt });
  if (!processed.ok) throw Error(JSON.stringify(processed));
  await parents.completeExtension(parent.id, processed.value);
  const r = (await store.reserveExtensionArtifact({ schemaVersion: 1, extensionId: parent.id, tier: "ha", kind: "bicep" }, { staleBefore: new Date(0) }))!;
  const row = (await store.getExtensionArtifact(r.id))!;
  const binding = { id: row.id, extensionId: row.extensionId, sourceScanId: row.sourceScanId, workspaceId: row.workspaceId, createdAt: row.createdAt, tier: row.tier, kind: "bicep" as const };
  const basis = { extension: processed.value, inventory: saved.inventory, catalogData: (await parents.getExtensionCoreData(parent.id))! };
  const bicepContext = createBicepContext(binding, basis);
  const bound = bindBicepSource(bicepContext.payload.source, bicepContext);
  const value = { ...synthetic.artifact, ...binding, content: { ...synthetic.artifact.content, code: bound.code,
    existingResourceIds: bound.existingResourceIds, newComponentIds: bound.newComponentIds } };
  vi.stubEnv("CLOUDSIGHT_BICEP_PATH", realCompiler);
  expect(await defaultComplete(row.id, row.attemptId, value, usage)).toBe(true);
  const proofs = (await db.query<{ evidence: { validation: unknown } }>("select evidence from extension_artifact_evidence where artifact_id=$1 and attempt_id=$2", [row.id, row.attemptId])).rows;
  expect(proofs).toHaveLength(1);
  expect(proofs[0].evidence.validation).toEqual({ policyVersion: "extend-bicep-source-arm-v1", compilerVersion: "bicep-0.49.2-b34271ac51-arm-0.49.2.45890" });
  vi.stubEnv("CLOUDSIGHT_BICEP_PATH", "/missing/compiler");
  expect((await store.getExtensionArtifact(row.id))!.content).toEqual(value);
  expect((await store.listExtensionArtifacts(parent.id))[0].content).toEqual(value);
  expect(await store.reserveExtensionArtifact(row.input, { staleBefore: new Date(0) })).toMatchObject({ created: false, status: "succeeded" });
  expect(await defaultComplete(row.id, row.attemptId, value, usage)).toBe(false);
  expect(await calls()).toHaveLength(1);
}, 30000);

it("reserves from actual17 saved parent, completes atomically with proof and reuses success/fresh pending", async () => {
  const first = await reserve();
  expect(first).toMatchObject({ status: "pending", created: true });
  expect(await reserve()).toEqual({ ...first, created: false });
  const value = await artifact(first.id);
  expect(await store.completeExtensionArtifact(first.id, first.attemptId, value, usage)).toBe(true);
  expect(await store.getExtensionArtifact(first.id)).toMatchObject({ status: "succeeded", content: value, usage });
  expect(await reserve()).toEqual({ ...first, status: "succeeded", created: false });
  expect(await store.listExtensionArtifacts(request.extensionId)).toHaveLength(1);
  expect(await store.listExtensionArtifacts(request.extensionId, { tier: "ha" })).toEqual([]);
  const proofs = await db.query("select * from extension_artifact_evidence where artifact_id=$1", [first.id]);
  expect(proofs.rows).toHaveLength(1);
  expect(JSON.stringify(await store.getExtensionArtifact(first.id))).not.toMatch(/basisDigest|contentDigest|inventory|apiKey/);
  semantic.mockClear();
  await store.getExtensionArtifact(first.id);
  await store.listExtensionArtifacts(request.extensionId);
  expect(semantic).not.toHaveBeenCalled();
});
it("fails closed with no semantic validator; billing survives validation failure", async () => {
  const row = await reserve();
  const closed = createExtensionArtifactsDb({ db: async () => db });
  await expect(closed.completeExtensionArtifact(row.id, row.attemptId, await artifact(row.id), usage)).rejects.toThrow("validation-failed");
  expect(await calls()).toHaveLength(1);
  expect((await store.getExtensionArtifact(row.id))!.status).toBe("pending");
  expect((await db.query("select * from extension_artifact_evidence")).rows).toEqual([]);
});
it("requires exact parent/tier/scan/owner and strict member/outer schemas before validation or proof", async () => {
  const row = await reserve();
  const value = await artifact(row.id);
  const otherWorkspace = await insertTestWorkspace(db);
  for (const patch of [{ extensionId: row.id }, { workspaceId: otherWorkspace }, { sourceScanId: row.id },
    { tier: "ha" }, { extra: "not-allowed" }, { evidence: {} }]) {
    await expect(store.completeExtensionArtifact(row.id, row.attemptId, { ...value, ...patch })).rejects.toThrow("validation-failed");
  }
  const invalid = structuredClone(value);
  if (invalid.kind !== "guide") throw Error();
  invalid.content.steps[0].componentIds = ["app-service-linux-b1"];
  await expect(store.completeExtensionArtifact(row.id, row.attemptId, invalid)).rejects.toThrow("validation-failed");
  expect(semantic).not.toHaveBeenCalled();
});
it("renewed attempts reject old complete AND fail, bill old final aggregates once and accumulate known usage", async () => {
  const old = await reserve();
  const oldContent = await artifact(old.id);
  const current = await renew();
  expect(current.id).toBe(old.id);
  expect(current.attemptId).not.toBe(old.attemptId);
  expect(await store.completeExtensionArtifact(old.id, old.attemptId, oldContent, usage)).toBe(false);
  expect(await store.failExtensionArtifact(old.id, old.attemptId, "internal", usage)).toBe(false);
  expect(await store.completeExtensionArtifact(current.id, current.attemptId, await artifact(current.id), secondUsage)).toBe(true);
  expect(await store.failExtensionArtifact(old.id, old.attemptId, "timeout", usage)).toBe(false);
  expect((await store.getExtensionArtifact(old.id))!.usage).toEqual({ promptTokens: 32, completionTokens: 15, costUsd: 0.04 });
  expect((await calls()).map(r => r.source_id).sort()).toEqual([old.attemptId, current.attemptId].sort());
  expect((await db.query("select * from extension_artifact_evidence")).rows).toHaveLength(1);
});
it("failed retries preserve usage; success cannot be terminated and rejects changed final aggregate", async () => {
  const first = await reserve();
  expect(await store.failExtensionArtifact(first.id, first.attemptId, "timeout", usage)).toBe(true);
  expect(await store.failExtensionArtifact(first.id, first.attemptId, "internal", usage)).toBe(false);
  const next = await reserve();
  expect(next.attemptId).not.toBe(first.attemptId);
  expect((await store.getExtensionArtifact(next.id))!.usage).toEqual(usage);
  expect(await store.completeExtensionArtifact(next.id, next.attemptId, await artifact(next.id), { ...secondUsage, costUsd: null })).toBe(true);
  expect(await store.failExtensionArtifact(next.id, next.attemptId, "timeout")).toBe(false);
  expect((await store.getExtensionArtifact(next.id))!.usage).toEqual({ promptTokens: 32, completionTokens: 15, costUsd: null });
  await expect(store.failExtensionArtifact(first.id, first.attemptId, "timeout", secondUsage)).rejects.toThrow("validation-failed");
  expect(await calls()).toHaveLength(2);
});
it("deduplicates concurrent final usage callbacks even for stale 0-writes", async () => {
  const old = await reserve();
  await renew();
  expect(await Promise.all(Array.from({ length: 5 }, () => store.failExtensionArtifact(old.id, old.attemptId, "timeout", usage)))).toEqual(Array(5).fill(false));
  expect(await calls()).toHaveLength(1);
  expect((await store.getExtensionArtifact(old.id))!.usage).toEqual(usage);
});
it("keeps independent billing when terminal SQL or proof insertion fails and rolls back success/proof together", async () => {
  const row = await reserve();
  await db.exec(`create function artifact_test_reject() returns trigger language plpgsql as $$ begin raise exception 'private detail'; end $$;
    create trigger artifact_test_reject before insert on extension_artifact_evidence for each row execute function artifact_test_reject();`);
  await expect(store.completeExtensionArtifact(row.id, row.attemptId, await artifact(row.id), usage)).rejects.toThrow("internal");
  expect((await store.getExtensionArtifact(row.id))!.status).toBe("pending");
  expect(await calls()).toHaveLength(1);
  expect((await db.query("select * from extension_artifact_evidence")).rows).toEqual([]);
});
it("rejects stored content corruption, missing/wrong attempt proof and source corruption on get/list", async () => {
  const row = await reserve();
  const value = await artifact(row.id);
  await store.completeExtensionArtifact(row.id, row.attemptId, value);
  const corrupt = structuredClone(value);
  if (corrupt.kind !== "guide") throw Error();
  corrupt.content.overview.en = "Changed after validation";
  await db.query("update extension_artifacts set content=$2 where id=$1", [row.id, corrupt]);
  await expect(store.getExtensionArtifact(row.id)).rejects.toThrow("validation-failed");
  await expect(store.listExtensionArtifacts(request.extensionId)).rejects.toThrow("validation-failed");
  await db.query("update extension_artifacts set content=$2 where id=$1", [row.id, value]);
  await db.query("delete from extension_artifact_evidence where artifact_id=$1", [row.id]);
  await expect(store.getExtensionArtifact(row.id)).rejects.toThrow("validation-failed");
});
it("pins the immutable parent.result/catalog basis across late parent usage changes", async () => {
  const row = await reserve();
  const value = await artifact(row.id);
  await store.completeExtensionArtifact(row.id, row.attemptId, value);
  await parents.failExtension(request.extensionId, "internal", usage); // 0-write but late billing changes parent.usage
  expect((await store.getExtensionArtifact(row.id))!.content).toEqual(value);
  const source = (await parents.getExtension(request.extensionId))!.sourceScanId;
  const inventory = structuredClone(f.context.inventory);
  inventory.resources[0].properties = { tampered: true };
  await db.query("update scans set inventory=$2 where id=$1", [source, inventory]);
  await expect(store.getExtensionArtifact(row.id)).rejects.toThrow("validation-failed");
});
it("rejects request-supplied source/evidence, missing or unsuccessful parents and malformed identifiers", async () => {
  await expect(store.reserveExtensionArtifact({ ...request, workspaceId: await insertTestWorkspace(db) } as ExtensionArtifactRequest, { staleBefore: new Date(0) })).rejects.toThrow("validation-failed");
  expect(await store.reserveExtensionArtifact({ ...request, extensionId: "00000000-0000-4000-8000-000000000001" }, { staleBefore: new Date(0) })).toBeNull();
  expect(await store.getExtensionArtifact("bad")).toBeNull();
  expect(await store.listExtensionArtifacts("bad")).toEqual([]);
  expect(await store.failExtensionArtifact("bad", "bad", "internal")).toBe(false);
  const parent = (await parents.getExtension(request.extensionId))!;
  const pending = (await parents.reserveExtension(parent.input))!;
  expect(await store.reserveExtensionArtifact({ ...request, extensionId: pending.id }, { staleBefore: new Date(0) })).toBeNull();
});
it("refuses unregistered/cross-artifact attempts before billing", async () => {
  const first = await reserve();
  const other = (await store.reserveExtensionArtifact({ ...request, tier: "ha" }, { staleBefore: new Date(0) }))!;
  expect(await store.failExtensionArtifact(first.id, other.attemptId, "timeout", usage)).toBe(false);
  expect(await store.failExtensionArtifact(first.id, "00000000-0000-4000-8000-000000000001", "timeout", usage)).toBe(false);
  expect(await calls()).toEqual([]);
  const restarted = createExtensionArtifactsDb({ db: async () => db, validateArtifact: semantic });
  await renew();
  expect(await restarted.failExtensionArtifact(first.id, first.attemptId, "timeout", usage)).toBe(false);
  expect(await calls()).toHaveLength(1);
});
it("a renewal during semantic validation makes the old success a 0-write without proof", async () => {
  const first = await reserve();
  const duringValidation = createExtensionArtifactsDb({ db: async () => db, validateArtifact: async (value, context) => {
    const metadata = await semantic(value, context);
    await renew();
    return metadata;
  } });
  expect(await duringValidation.completeExtensionArtifact(first.id, first.attemptId, await artifact(first.id), usage)).toBe(false);
  expect((await store.getExtensionArtifact(first.id))!.status).toBe("pending");
  expect((await db.query("select * from extension_artifact_evidence")).rows).toEqual([]);
  expect(await calls()).toHaveLength(1);
});
it("concurrent success/fail permits one terminal state, one charge and proofs only for success", async () => {
  const row = await reserve();
  const value = await artifact(row.id);
  const results = await Promise.all([store.completeExtensionArtifact(row.id, row.attemptId, value, usage),
    store.failExtensionArtifact(row.id, row.attemptId, "timeout", usage)]);
  expect(results.filter(Boolean)).toHaveLength(1);
  expect(await calls()).toHaveLength(1);
  const saved = (await store.getExtensionArtifact(row.id))!;
  expect(saved.status).not.toBe("pending");
  expect((await db.query("select * from extension_artifact_evidence")).rows).toHaveLength(saved.status === "succeeded" ? 1 : 0);
});
it("terminal update failure preserves once-only billing for a later retry callback", async () => {
  const row = await reserve();
  await db.exec(`create function artifact_test_update_reject() returns trigger language plpgsql as $$ begin raise exception 'private terminal detail'; end $$;
    create trigger artifact_test_update_reject before update of status on extension_artifacts for each row execute function artifact_test_update_reject();`);
  await expect(store.failExtensionArtifact(row.id, row.attemptId, "timeout", usage)).rejects.toThrow("internal");
  expect(await calls()).toHaveLength(1);
  expect((await store.getExtensionArtifact(row.id))!.usage).toEqual(usage);
  await db.exec("drop trigger artifact_test_update_reject on extension_artifacts");
  expect(await store.failExtensionArtifact(row.id, row.attemptId, "timeout", usage)).toBe(true);
  expect(await calls()).toHaveLength(1);
});
it("no-op or malformed semantic validators cannot seal a success", async () => {
  const row = await reserve();
  const noop = createExtensionArtifactsDb({ db: async () => db, validateArtifact: (async () => undefined) as unknown as ArtifactSemanticValidator });
  await expect(noop.completeExtensionArtifact(row.id, row.attemptId, await artifact(row.id))).rejects.toThrow("validation-failed");
  const compilerMetadataOnGuide = createExtensionArtifactsDb({ db: async () => db,
    validateArtifact: async () => ({ policyVersion: "test-v1", compilerVersion: "test-v1" }) });
  await expect(compilerMetadataOnGuide.completeExtensionArtifact(row.id, row.attemptId, await artifact(row.id))).rejects.toThrow("validation-failed");
});
it("reopens pinned catalog evidence without loading today's catalog or rerunning semantic validation", async () => {
  const row = await reserve();
  const value = await artifact(row.id);
  await store.completeExtensionArtifact(row.id, row.attemptId, value);
  const loader = await import("@/lib/catalog/load");
  vi.spyOn(loader, "loadCatalog").mockImplementation(() => { throw Error("current generation must not run"); });
  semantic.mockClear();
  expect((await store.getExtensionArtifact(row.id))!.content).toEqual(value);
  expect(await reserve()).toEqual({ ...row, status: "succeeded", created: false });
  expect(semantic).not.toHaveBeenCalled();
});
it("rejects a valid proof borrowed from another artifact attempt", async () => {
  const first = await reserve();
  await store.completeExtensionArtifact(first.id, first.attemptId, await artifact(first.id));
  // Both plans contain this guide's B1ms component; HA correctly selects GP2.
  const other = (await store.reserveExtensionArtifact({ ...request, tier: "balanced" }, { staleBefore: new Date(0) }))!;
  await store.completeExtensionArtifact(other.id, other.attemptId, await artifact(other.id));
  const proof = (await db.query<{ evidence: unknown }>("select evidence from extension_artifact_evidence where artifact_id=$1", [first.id])).rows[0].evidence;
  await db.query("update extension_artifact_evidence set evidence=$2 where artifact_id=$1", [other.id, proof]);
  await expect(store.getExtensionArtifact(other.id)).rejects.toThrow("validation-failed");
});
it("rejects unpinned legacy parents before invoking current generation engines", async () => {
  const row = await reserve();
  await store.completeExtensionArtifact(row.id, row.attemptId, await artifact(row.id));
  await db.query("update extensions set saved_evidence=null where id=$1", [request.extensionId]);
  const loader = await import("@/lib/catalog/load");
  const current = vi.spyOn(loader, "loadCatalog").mockImplementation(() => { throw Error("current generation engine called"); });
  await expect(store.getExtensionArtifact(row.id)).rejects.toThrow("validation-failed");
  expect(current).not.toHaveBeenCalled();
});
