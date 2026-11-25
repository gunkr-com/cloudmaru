// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDatabase, insertTestWorkspace } from "@/lib/db/test-db.test-data";
import { createExtensionRequestContext } from "@/lib/extend/validate-proposal";
import * as processing from "@/lib/extend/process";
import { processExtensionOutput, getExtensionCoreVersions } from "@/lib/extend/process";
import { buildExtensionPrompt } from "@/lib/extend/prompt";
import { fixture, proposalInput, proposalInventory, proposalScan, proposalCatalog, proposalSupport } from "@/lib/extend/proposal.test-data";
import { createExtensionsDb } from "./extensions";
import { createScansDb } from "./scans";
import { sealExtensionEvidence } from "@/lib/extend/saved-evidence";
import * as operational from "@/lib/llm/operational-prose";
import oldCounted from "@/lib/extend/pre-intent-counted.test-data.json";
import { extensionResultSchema } from "@/lib/completion/schema";
import { unsafeClaimsAndLiterals } from "@/lib/extend/prose-policy.test-data";

let db: PGlite;
let store: ReturnType<typeof createExtensionsDb>;
let input: typeof proposalInput;
const usage = { promptTokens: 321, completionTokens: 123, costUsd: 0.04 };
async function importScan(workspaceId = input.workspaceId, skippedRows = 0) {
  return createScansDb({ db: async () => db }).createImportScan({ workspaceId,
    subscriptionIds: proposalScan.subscriptionIds, summary: proposalScan.summary!,
    collectedAt: proposalScan.collectedAt!, inventory: { ...proposalInventory, skippedRows } });
}
async function prepare() {
  const reservation = (await store.reserveExtension(input))!;
  const row = (await store.getExtension(reservation.id))!;
  const saved = (await store.getExtensionSourceScan(row.sourceScanId))!;
  const context = createExtensionRequestContext(row.input, saved.scan, saved.inventory, proposalCatalog, { support: proposalSupport });
  const { raw } = fixture();
  const processed = processExtensionOutput(raw, context, { id: row.id, createdAt: row.createdAt });
  if (!processed.ok) throw Error(JSON.stringify(processed.errors));
  return { row, context, raw, result: processed.value };
}
beforeEach(async () => {
  db = await createTestDatabase();
  const workspaceId = await insertTestWorkspace(db);
  input = { ...proposalInput, workspaceId };
  input.sourceScanId = await importScan();
  store = createExtensionsDb({ db: async () => db });
});
afterEach(async () => { vi.restoreAllMocks(); await db.close(); });

it.each([
  ...unsafeClaimsAndLiterals,
  {en: "Use snowflake for monitoring.", ko: "데이터독을 사용합니다."},
  {en: "Cost is ＄１２.", ko: "비용은 ＄１２입니다."},
  {en: "Cost is ＄\u200b１２.", ko: "비용은 ＄\u200b１２입니다."},
  {en: "Cost is €12.", ko: "비용은 €12입니다."},
])("refuses to seal a result accepted by the prior prose policy, even with a supplemental no-op validator: %j", async text => {
  const f = await prepare();
  f.result.recommendationReason = text;
  const strict = createExtensionsDb({db: async () => db, validateResult: () => {}});
  await expect(strict.completeExtension(f.row.id, f.result, usage)).rejects.toThrow("validation-failed");
  expect((await db.query("select status,result,saved_evidence from extensions where id=$1", [f.row.id])).rows)
    .toEqual([{status: "pending", result: null, saved_evidence: null}]);
  expect((await store.getExtension(f.row.id))!.usage).toEqual(usage);
  expect((await db.query("select * from llm_calls where source_id=$1", [f.row.id])).rows).toHaveLength(1);
});

it.each(["old-version", "client-read-mode", "partial-count"])("cannot downgrade the new-write prose policy using %s", async mode => {
  const f = await prepare();
  f.result.recommendationReason.en = "Use snowflake for monitoring.";
  if (mode === "old-version") f.result.catalogVersion = oldCounted["pre-deployment"].result.catalogVersion;
  if (mode === "client-read-mode") Object.assign(f.result, {historicalRead: true, textPolicy: "historical-read"});
  if (mode === "partial-count") delete f.result.plans[0].newItems[0].instanceCount;
  await expect(store.completeExtension(f.row.id, f.result)).rejects.toThrow("validation-failed");
  expect((await db.query("select status,result,saved_evidence from extensions where id=$1", [f.row.id])).rows)
    .toEqual([{status: "pending", result: null, saved_evidence: null}]);
});

it.each([false, true])("reopens prior success bytes with sealed=%s through get/list/core-data without invoking the new prose policy", async sealed => {
  const f = await prepare();
  f.result.recommendationReason = {en: "Use snowflake for monitoring.", ko: "데이터독을 사용합니다."};
  f.result.requestTitle = unsafeClaimsAndLiterals[0];
  f.result.plans[1].title = unsafeClaimsAndLiterals[16];
  f.result.plans[1].pros = [unsafeClaimsAndLiterals[17], unsafeClaimsAndLiterals[18], unsafeClaimsAndLiterals[19]];
  f.result.plans[0].pros = [unsafeClaimsAndLiterals[4], unsafeClaimsAndLiterals[6], unsafeClaimsAndLiterals[7], unsafeClaimsAndLiterals[10]];
  // Simulate a success written before the new policy. The digest is corruption
  // evidence, not authentication against a DB writer, and never authorizes writes.
  const evidence = sealed ? sealExtensionEvidence(f.result, {catalog: proposalCatalog, support: proposalSupport}, {scan: f.context.scan, inventory: f.context.inventory}) : null;
  await db.query("update extensions set status='succeeded',result=$2,saved_evidence=$3,completed_at=now() where id=$1", [f.row.id, f.result, evidence]);
  const policy = vi.spyOn(operational, "validateExtensionOperationalProse").mockImplementation(() => {throw Error("new text policy must not run");});
  const reopened = createExtensionsDb({db: async () => db});
  expect((await reopened.getExtension(f.row.id))!.result).toEqual(f.result);
  expect((await reopened.listExtensions(input.workspaceId))[0].result).toEqual(f.result);
  expect(await reopened.getExtensionCoreData(f.row.id)).toEqual({catalog: proposalCatalog, support: proposalSupport});
  expect(policy).not.toHaveBeenCalled();
});

for (const profile of ["postgres-mapping-v1", "pre-deployment"] as const) it.each([true, false])(`reopens prior counted ${profile} DB history with pinned=%s without today's prose policy`, async pinned => {
  const scans = createScansDb({db: async () => db});
  const live = await scans.reserveLiveScan({workspaceId: input.workspaceId, subscriptionIds: proposalScan.subscriptionIds, staleBefore: new Date(0)});
  await scans.completeScan(live.id, {subscriptionIds: proposalScan.subscriptionIds, summary: proposalScan.summary!,
    inventory: structuredClone(proposalInventory), collectedAt: proposalScan.collectedAt!});
  input.sourceScanId = live.id;
  const f = await prepare(), frozen = oldCounted[profile];
  // The frozen process fixture predates DB timestamp normalization. Bind a copy
  // to this real reservation/source, keeping all old policy/calculation fields.
  // No frozen fixture, catalog, prices or reuse policy is changed.
  const result = extensionResultSchema.parse({...structuredClone(frozen.result), id: f.result.id, createdAt: f.result.createdAt,
    workspaceId: f.result.workspaceId, sourceScanId: f.result.sourceScanId, input: f.result.input, sourceScan: f.result.sourceScan});
  result.recommendationReason = {en: "Use snowflake for monitoring.", ko: "데이터독을 사용합니다."};
  result.requestTitle = unsafeClaimsAndLiterals[0];
  result.plans[1].title = unsafeClaimsAndLiterals[16];
  result.plans[1].pros = [unsafeClaimsAndLiterals[17], unsafeClaimsAndLiterals[18], unsafeClaimsAndLiterals[19]];
  result.plans[0].pros = [unsafeClaimsAndLiterals[4], unsafeClaimsAndLiterals[6], unsafeClaimsAndLiterals[7], unsafeClaimsAndLiterals[10]];
  const evidence = pinned ? sealExtensionEvidence(result, {catalog: frozen.evidence.catalog as typeof proposalCatalog,
    support: proposalSupport}, {scan: f.context.scan, inventory: f.context.inventory}) : null;
  const before = JSON.stringify({result, evidence});
  await db.query("update extensions set status='succeeded',result=$2,saved_evidence=$3,completed_at=now() where id=$1", [f.row.id, result, evidence]);
  const policy = vi.spyOn(operational, "validateExtensionOperationalProse").mockImplementation(() => {throw Error("new policy must not run on history");});
  expect((await store.getExtension(result.id))!.result).toEqual(result);
  expect((await store.listExtensions(result.workspaceId))[0].result).toEqual(result);
  expect(await store.getExtensionCoreData(result.id)).toBeTruthy();
  expect(policy).not.toHaveBeenCalled();
  expect(JSON.stringify({result, evidence})).toBe(before);
  expect((await db.query("select result,saved_evidence from extensions where id=$1", [result.id])).rows)
    .toEqual([{result, saved_evidence: evidence}]);
});

it("runs actual phase18 loaders and predecessor engines through reservation, prompt, complete, get and reopen", async () => {
  const f = await prepare();
  const prompt = JSON.stringify(buildExtensionPrompt(f.context));
  expect(prompt).not.toMatch(/sample-vnet|sample-plan|sample-vault|sample-logs|\/subscriptions\/|10\.1\.0\.0|P1v3|aliasToResourceId/);
  expect(await store.completeExtension(f.row.id, f.result, usage)).toBe(true);
  const first = (await store.getExtension(f.row.id))!;
  expect(first.result).toEqual(f.result);
  expect(first.result).toMatchObject({ ...getExtensionCoreVersions(proposalCatalog, proposalSupport),
    contextCoverage: { total: 4, included: 4, excluded: 0 },
    sourceScan: { source: "import", completeness: { state: "unknown", reasons: ["import-scope-unverified"] } } });
  expect(JSON.stringify(first)).not.toMatch(/aliasToResourceId|r00000\d|"model"|"candidates"/);
  await db.query("update workspaces set default_region='westus2',claude_api_key_env='CLOUDSIGHT_CLAUDE_KEY_CHANGED' where id=$1", [input.workspaceId]);
  await insertTestWorkspace(db, "Other cookie selection");
  await importScan();
  const reopened = createExtensionsDb({ db: async () => db });
  expect(await reopened.getExtension(f.row.id)).toEqual(first);
  expect(await reopened.listExtensions(input.workspaceId, { sourceScanId: input.sourceScanId })).toEqual([first]);
  expect((await db.query("select source,source_id,prompt_tokens from llm_calls")).rows)
    .toEqual([{ source: "extension", source_id: f.row.id, prompt_tokens: usage.promptTokens }]);
});

it("rejects model failures and preserves aggregated billing on failure and late completion", async () => {
  const f = await prepare();
  for (const change of ["alias", "component", "cidr"]) {
    const raw = structuredClone(f.raw);
    if (change === "alias") raw.plans[0].reusedResources[0].resourceId = "r999999";
    if (change === "component") raw.plans[0].newItems[0].componentId = "invented-component";
    if (change === "cidr") raw.plans[0].subnetProposals[0].addressPrefixes = ["10.1.1.7/24"];
    expect(processExtensionOutput(raw, f.context, { id: f.row.id, createdAt: f.row.createdAt }).ok).toBe(false);
  }
  await expect(store.completeExtension(f.row.id, { ...f.result, catalogVersion: "invented" }, usage)).rejects.toThrow("validation-failed");
  expect(await store.failExtension(f.row.id, "validation-failed", usage)).toBe(true);
  expect(await store.completeExtension(f.row.id, f.result, usage)).toBe(false);
  const late = await prepare();
  await store.failExtension(late.row.id, "interrupted");
  expect(await store.completeExtension(late.row.id, late.result, usage)).toBe(false);
  expect((await store.getExtension(late.row.id))!.usage).toEqual(usage);
  expect((await db.query("select source_id from llm_calls")).rows).toHaveLength(2);
});

it.each(["cost", "check", "coverage", "policy", "reuse"])("rejects semantic %s tampering on write and stored read/list even with supplemental validator", async kind => {
  const f = await prepare();
  const wrong = structuredClone(f.result);
  if (kind === "cost" && "data" in wrong.plans[0].incrementalCost) {
    wrong.plans[0].incrementalCost.data.total += 1;
    wrong.plans[0].incrementalCost.data.lines[0].amount += 1;
  }
  if (kind === "check") wrong.plans[0].checks[3].reasonCodes = ["missing-data"];
  if (kind === "coverage") wrong.contextCoverage = { total: 0, included: 0, excluded: 0, reasons: [] };
  if (kind === "policy") wrong.reusePolicyVersion = "invented";
  if (kind === "reuse") wrong.plans[0].reusedResources[1].componentId = "app-service-linux-b1";
  const strict = createExtensionsDb({ db: async () => db, validateResult: () => {} });
  await expect(strict.completeExtension(f.row.id, wrong)).rejects.toThrow("validation-failed");
  await strict.completeExtension(f.row.id, f.result);
  await db.query("update extensions set result=$2 where id=$1", [f.row.id, wrong]);
  await expect(strict.getExtension(f.row.id)).rejects.toThrow("validation-failed");
  await expect(strict.listExtensions(input.workspaceId)).rejects.toThrow("validation-failed");
});

it("retains partial/import source, independent context coverage and original failed parent without rebinding", async () => {
  input.sourceScanId = await importScan(input.workspaceId, 2);
  const f = await prepare();
  expect(f.result.sourceScan.completeness).toEqual({ state: "partial", reasons: ["collection-partial", "import-scope-unverified"] });
  expect(f.result.contextCoverage).toMatchObject({ total: 4, included: 4 });
  await store.failExtension(f.row.id, "timeout", usage);
  const child = (await store.reserveExtension(input, { sourceExtensionId: f.row.id }))!;
  expect(await store.getExtension(child.id)).toMatchObject({ sourceExtensionId: f.row.id, sourceScanId: input.sourceScanId, input });
  const other = await insertTestWorkspace(db);
  expect(await store.reserveExtension({ ...input, workspaceId: other })).toBeNull();
  const otherScan = await importScan(other);
  expect(await store.reserveExtension({ ...input, workspaceId: other, sourceScanId: otherScan }, { sourceExtensionId: f.row.id })).toBeNull();
  expect((await store.getExtension(f.row.id))!.status).toBe("failed");
});

it("rejects a changed saved reuse fact, not just matching source header", async () => {
  const f = await prepare();
  await store.completeExtension(f.row.id, f.result);
  // 스캔은 제품에서 불변이다. 저장 데이터 변조도 재사용 조건 검사로 차단한다.
  await db.query("update scans set inventory=jsonb_set(inventory,'{resources,1,properties,reserved}','false') where id=$1", [input.sourceScanId]);
  await expect(store.getExtension(f.row.id)).rejects.toThrow("validation-failed");
});

it("reanalyses a succeeded parent into a separately validated child fixed to the same owner", async () => {
  const f = await prepare();
  await store.completeExtension(f.row.id, f.result, usage);
  const child = (await store.reserveExtension({ ...input, monthlyBudget: 500 }, { sourceExtensionId: f.row.id }))!;
  const row = (await store.getExtension(child.id))!;
  const saved = (await store.getExtensionSourceScan(row.sourceScanId))!;
  const context = createExtensionRequestContext(row.input, saved.scan, saved.inventory, proposalCatalog);
  const result = processExtensionOutput(f.raw, context, { id: row.id, createdAt: row.createdAt });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  await store.completeExtension(child.id, result.value, usage);
  expect(await store.getExtension(child.id)).toMatchObject({ status: "succeeded", sourceExtensionId: f.row.id,
    workspaceId: input.workspaceId, sourceScanId: input.sourceScanId, input: { monthlyBudget: 500 } });
  expect((await store.getExtension(f.row.id))!.result).toEqual(f.result);
});

it("keeps supplemental validator mutations outside validated storage DTOs", async () => {
  const f = await prepare();
  const isolated = createExtensionsDb({ db: async () => db, validateResult: value => {
    value.catalogVersion = "mutated-by-supplement";
  } });
  expect(await isolated.completeExtension(f.row.id, f.result)).toBe(true);
  expect((await store.getExtension(f.row.id))!.result).toEqual(f.result);
});


it("reopens saved evidence under later price and policy snapshots without repricing", async () => {
  const f = await prepare();
  await store.completeExtension(f.row.id, f.result, usage);
  const first = await store.getExtension(f.row.id);
  const catalog = structuredClone(proposalCatalog), support = structuredClone(proposalSupport);
  catalog.prices.asOf = "2026-11-12";
  support.version = "later-policy";
  support.reusePolicies[0].notes.en += " Updated later.";
  const later = createExtensionsDb({ db: async () => db, coreData: {catalog, support} });
  expect(await later.getExtension(f.row.id)).toEqual(first);
  expect(await later.listExtensions(input.workspaceId)).toEqual([first]);
  expect(await later.getExtensionCoreData(f.row.id)).toEqual({catalog: proposalCatalog, support: proposalSupport});
});

it("does not rerun current proposal/check engines when reopening sealed history", async () => {
  const f = await prepare();
  await store.completeExtension(f.row.id, f.result);
  const replay = vi.spyOn(processing, "validateStoredExtensionResult").mockImplementation(() => { throw Error("new engine"); });
  expect((await store.getExtension(f.row.id))!.result).toEqual(f.result);
  expect(replay).not.toHaveBeenCalled();
});
