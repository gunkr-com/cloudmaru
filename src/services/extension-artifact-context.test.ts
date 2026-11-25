// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDatabase, insertTestWorkspace } from "@/lib/db/test-db.test-data";
import { processedFixture } from "@/lib/extend/proposal.test-data";
import { createExtensionRequestContext } from "@/lib/extend/validate-proposal";
import { processExtensionOutput } from "@/lib/extend/process";
import { validateArtifactTextOutput, validateTextArtifactSemantics } from "@/lib/extend-artifacts/guide-evaluation";
import { createScansDb } from "./db/scans";
import { createExtensionsDb } from "./db/extensions";
import { createExtensionArtifactsDb } from "./db/extension-artifacts";
import { createExtensionArtifactContextService } from "./extension-artifact-context";

let db: PGlite;
let parents: ReturnType<typeof createExtensionsDb>;
let artifacts: ReturnType<typeof createExtensionArtifactsDb>;
let service: ReturnType<typeof createExtensionArtifactContextService>;
let artifactId: string;
let extensionId: string;
const f = processedFixture();
beforeEach(async () => {
  db = await createTestDatabase();
  const workspaceId = await insertTestWorkspace(db);
  const scanId = await createScansDb({ db: async () => db }).createImportScan({ workspaceId,
    subscriptionIds: f.context.scan.subscriptionIds, inventory: f.context.inventory,
    summary: f.context.scan.summary!, collectedAt: f.context.scan.collectedAt! });
  parents = createExtensionsDb({ db: async () => db });
  const input = { ...f.result.input, workspaceId, sourceScanId: scanId };
  const reservation = (await parents.reserveExtension(input))!;
  const saved = (await parents.getExtensionSourceScan(scanId))!;
  const parent = (await parents.getExtension(reservation.id))!;
  const context = createExtensionRequestContext(input, saved.scan, saved.inventory, f.context.catalog, { support: f.context.support });
  const result = processExtensionOutput(f.raw, context, { id: parent.id, createdAt: parent.createdAt });
  if (!result.ok) throw Error(result.errors.join(","));
  await parents.completeExtension(parent.id, result.value);
  extensionId = parent.id;
  artifacts = createExtensionArtifactsDb({ db: async () => db, validateArtifact: validateTextArtifactSemantics });
  artifactId = (await artifacts.reserveExtensionArtifact({ schemaVersion: 1, extensionId, tier: "low", kind: "guide" }, { staleBefore: new Date(0) }))!.id;
  service = createExtensionArtifactContextService({ ...parents, ...artifacts });
});
afterEach(async () => { await db.close(); });
it("loads actual stored parent/source/pinned catalog and completes real text semantics with attempt proof", async () => {
  const prepared = (await service.prepareExtensionArtifactTextRequest(artifactId))!;
  const { context, attemptId, request } = prepared;
  expect(request.schemaName).toBe("extension_guide_plan_v1");
  expect(request.user).not.toContain("/subscriptions/");
  expect(context.payload.sourceScan.completeness).toEqual({ state: "unknown", reasons: ["import-scope-unverified"] });
  const text = { en: "Verify integration before proceeding.", ko: "진행 전에 연결 결과를 확인합니다." };
  const raw = { overview: text, prerequisites: [text], cautions: [text], steps: [{ title: text, goal: text, instructions: [text],
    componentIds: context.payload.components.map(c => c.id), reusedResourceIds: context.payload.reusedResources.map(r => r.alias), verification: text }] };
  const output = validateArtifactTextOutput(raw, context);
  expect(output.ok).toBe(true);
  if (!output.ok) throw Error();
  expect(await artifacts.completeExtensionArtifact(artifactId, attemptId, output.value)).toBe(true);
  expect((await artifacts.getExtensionArtifact(artifactId))?.content).toEqual(output.value);
  expect((await db.query("select * from extension_artifact_evidence where artifact_id=$1", [artifactId])).rows).toHaveLength(1);
  expect((await db.query("select * from llm_calls")).rows).toHaveLength(0);
  // Reopen never needs a generation context, key or provider/semantic/compiler call.
  expect(await service.prepareExtensionArtifactTextRequest(artifactId)).toBeNull();
});
it("uses historical pinned prices/support despite later valid catalog changes", async () => {
  const before = (await service.prepareExtensionArtifactTextRequest(artifactId))!.request;
  const changed = structuredClone({ catalog: f.context.catalog, support: f.context.support });
  changed.catalog.prices.asOf = "2026-11-10";
  changed.support.version = "later-policy";
  const laterParents = createExtensionsDb({ db: async () => db, coreData: changed });
  const later = createExtensionArtifactContextService({ ...laterParents, ...artifacts });
  expect((await later.prepareExtensionArtifactTextRequest(artifactId))!.request).toEqual(before);
});
it("rejects stale source/header/option and sanitizes loader failures", async () => {
  const parent = (await parents.getExtension(extensionId))!;
  const wrong = createExtensionArtifactContextService({ ...parents, ...artifacts,
    getExtension: async () => ({ ...parent, sourceScanId: "00000000-0000-4000-8000-000000000000" }) });
  await expect(wrong.prepareExtensionArtifactTextRequest(artifactId)).rejects.toThrow("validation-failed");
  const failure = createExtensionArtifactContextService({ ...parents, ...artifacts,
    getExtensionCoreData: async () => { throw Error("database credential secret"); } });
  await expect(failure.prepareExtensionArtifactTextRequest(artifactId)).rejects.toThrow(/^internal$/);
  const pending = createExtensionArtifactContextService({ ...parents, ...artifacts, getExtension: async () => ({ ...parent, status: "pending", result: null }) });
  await expect(pending.prepareExtensionArtifactTextRequest(artifactId)).rejects.toThrow("validation-failed");
  expect(await service.prepareExtensionArtifactTextRequest("bad-id")).toBeNull();
});
it("refuses Bicep text preparation without substituting a guide validator", async () => {
  const bicep = (await artifacts.reserveExtensionArtifact({ schemaVersion: 1, extensionId, tier: "low", kind: "bicep" }, { staleBefore: new Date(0) }))!;
  const source = vi.spyOn(parents, "getExtensionSourceScan");
  const loader = createExtensionArtifactContextService({ ...parents, ...artifacts });
  await expect(loader.prepareExtensionArtifactTextRequest(bicep.id)).rejects.toThrow("validation-failed");
  expect(source).not.toHaveBeenCalled();
});

it("persists exactly five AI advice axes through actual storage and immutable attempt proof", async () => {
  const row = (await artifacts.reserveExtensionArtifact({ schemaVersion: 1, extensionId, tier: "balanced", kind: "evaluation" }, { staleBefore: new Date(0) }))!;
  const prepared = (await service.prepareExtensionArtifactTextRequest(row.id))!;
  const text = { en: "Verify integration before proceeding.", ko: "진행 전에 연결 결과를 확인합니다." };
  const output = validateArtifactTextOutput({ summary: text,
    axes: ["reliability", "security", "cost", "operations", "performance"].map(axis => ({ axis, grade: "high", rationale: text, improvement: text })),
  }, prepared.context);
  expect(output.ok).toBe(true);
  if (!output.ok) throw Error();
  expect(await artifacts.completeExtensionArtifact(row.id, row.attemptId, output.value)).toBe(true);
  expect((await artifacts.getExtensionArtifact(row.id))?.content).toEqual(output.value);
  expect((await parents.getExtension(extensionId))?.result?.plans[1].checks.some(c => c.verdict === "unknown")).toBe(true);
});
it('prepares the injected job validator from stored text only and rejects forged output', async () => {
  const prepared = (await service.prepareExtensionArtifactRequest(artifactId))!;
  expect(prepared.attemptId).toBe((await artifacts.getExtensionArtifact(artifactId))!.attemptId);
  expect(prepared.validate({price:0})).toMatchObject({ok:false});
  expect(prepared.request.user).not.toContain('sample-plan');
});
it('generates via reviewed phrase IDs, then persists ordinary bilingual content and immutable proof',async()=>{
 const prepared=(await service.prepareExtensionArtifactRequest(artifactId))!;
 const ctx=(await service.prepareExtensionArtifactTextRequest(artifactId))!.context;
 const output=prepared.validate({overview:'review-saved',prerequisites:['check-access'],cautions:['capacity-unknown'],steps:[{
  title:'review-configuration',goal:'review-saved',instructions:['preserve-settings'],verification:'verify-isolated',
  componentIds:ctx.payload.components.map(c=>c.id),reusedResourceIds:ctx.payload.reusedResources.map(r=>r.alias)}]});
 expect(output.ok).toBe(true);if(!output.ok)throw Error();
 expect(await artifacts.completeExtensionArtifact(artifactId,prepared.attemptId,output.value)).toBe(true);
 const stored=await artifacts.getExtensionArtifact(artifactId);
 expect(stored?.content).toMatchObject({kind:'guide',content:{overview:{en:expect.any(String),ko:expect.any(String)}}});
 expect(await service.prepareExtensionArtifactRequest(artifactId)).toBeNull();
});
