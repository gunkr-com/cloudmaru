// @vitest-environment node
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, expect, it } from "vitest";
import { applyMigrations } from "@/services/db/migrate";
import { createTestDatabase } from "./test-db.test-data";
import { assessment, extension, extensionArtifacts, ids, legacySnapshot, networkDiagnostic } from "@/lib/completion/fixtures.test-data";
import { createCompletionOwnershipDb } from "@/services/db/completion-ownership";

let db: PGlite;
const otherScan = "00000000-0000-4000-8000-00000000b003";
const missing = "00000000-0000-4000-8000-00000000ffff";
const error = { schemaVersion: 1, code: "internal" };
const localResult = { ...assessment, roadmap: { state: "not-requested" } };
const assessmentInput = { schemaVersion: 1, workspaceId: ids.workspace, sourceScanId: ids.scan, previousScanId: null };
const networkInput = { schemaVersion: 1, workspaceId: ids.workspace, sourceScanId: ids.scan, query: networkDiagnostic.query };
type ReusableReservation = { id: string; status: string; created: boolean; attempt_id: string };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
beforeEach(async () => {
  db = await createTestDatabase();
  await db.query("insert into workspaces(id,name) values ($1,'Synthetic'),($2,'Other synthetic')", [ids.workspace, ids.otherWorkspace]);
  for (const [id, owner] of [[ids.scan, ids.workspace], [ids.oldScan, ids.workspace], [otherScan, ids.otherWorkspace]]) {
    await db.query("insert into scans(id,workspace_id,source,status,inventory,summary,collected_at) values ($1,$2,'import','succeeded',$3,$4,$5)",
      [id, owner, legacySnapshot.inventory, legacySnapshot.record.summary, legacySnapshot.record.collectedAt]);
  }
});
afterEach(async () => { await db.close(); });

const reserveAssessment = (previous: string | null = null, scan = ids.scan as string, owner = ids.workspace as string) =>
  db.query<{ id: string; status: string; created: boolean }>("select * from reserve_assessment($1,$2,$3)", [owner, scan, previous]);
const reserveExtension = (source: string | null = null) => db.query<{ id: string }>(
  "select * from reserve_extension($1,$2,$3,$4)", [ids.workspace, ids.scan, extension.input, source]);

it("preserves an explicit import scope uncertainty code in stored completion errors", async () => {
  const { id } = (await reserveAssessment()).rows[0];
  const coded = { schemaVersion: 1, code: "import-scope-unverified" };
  await db.query("update assessments set status='failed',error=$2,completed_at=now() where id=$1", [id, coded]);
  expect((await db.query("select error from assessments where id=$1", [id])).rows[0]).toEqual({ error: coded });
});

it("incrementally migrates legacy 99-resource scans, workspace settings, Build and usage without rewriting them", async () => {
  await db.close();
  db = new PGlite();
  await db.exec("create table schema_migrations(version text primary key)");
  for (const file of ["0001_init.sql", "0002_scans.sql", "0003_llm_calls.sql", "0004_workspace_claude.sql"]) {
    await db.exec(await readFile(`db/migrations/${file}`, "utf8"));
    await db.query("insert into schema_migrations values ($1)", [file]);
  }
  await db.query("insert into workspaces(id,name,claude_api_key_env) values ($1,'Synthetic legacy','CLOUDSIGHT_CLAUDE_KEY_SYNTHETIC')", [ids.workspace]);
  const oldInventory = { ...legacySnapshot.inventory, resources: Array.from({ length: 99 }, (_, i) => ({ ...legacySnapshot.inventory.resources[i % 32], id: `${legacySnapshot.inventory.resources[i % 32].id}-${i}` })) };
  await db.query("insert into scans(id,workspace_id,source,status,inventory,summary,collected_at) values ($1,$2,'import','succeeded',$3,$4,$5)",
    [ids.scan, ids.workspace, oldInventory, { ...legacySnapshot.record.summary, resourceCount: 99 }, legacySnapshot.record.collectedAt]);
  await db.query("insert into analyses(id,workspace_id,input,status,result,usage) values ($1,$2,'{}','succeeded','{}',$3)",
    [ids.extension, ids.workspace, { promptTokens: 1, completionTokens: 2, costUsd: 0.2 }]);
  await db.query("select * from reserve_artifact($1,'low','guide',now())", [ids.extension]);
  await db.query("insert into llm_calls(source,source_id,prompt_tokens,completion_tokens,cost_usd) values ('analysis',$1,1,2,0.2)", [ids.extension]);
  const tables = ["workspaces", "scans", "analyses", "artifacts", "llm_calls"];
  const before = await Promise.all(tables.map(t => db.query(`select * from ${t} order by id`)));
  expect(await applyMigrations(db)).toEqual(["0005_completion.sql", "0006_extension_saved_evidence.sql", "0007_assessment_saved_evidence.sql", "0008_completion_attempt_evidence.sql", "0009_completion_attempt_ledger.sql", "0010_compiler_error.sql"]);
  expect(await applyMigrations(db)).toEqual([]);
  const after = await Promise.all(tables.map(t => db.query(`select * from ${t} order by id`)));
  expect(after.map(r => r.rows)).toEqual(before.map(r => r.rows));
  expect((await db.query<{ inventory: typeof oldInventory }>("select inventory from scans")).rows[0].inventory.resources).toHaveLength(99);
});

it("enforces composite scan/comparison/rerun ownership and dangling references, including direct inserts", async () => {
  for (const table of ["assessments", "network_diagnostics", "extensions"]) {
    const input = table === "extensions" ? extension.input : table === "assessments" ? assessmentInput : networkInput;
    for (const scan of [otherScan, missing]) {
      await expect(db.query(`insert into ${table}(workspace_id,source_scan_id,input) values ($1,$2,$3)`,
        [ids.workspace, scan, { ...input, sourceScanId: scan, ...(table === "network_diagnostics" ? { query: { ...networkDiagnostic.query, sourceScanId: scan } } : {}) }])).rejects.toThrow();
    }
  }
  for (const previous of [otherScan, missing, ids.scan]) {
    expect((await reserveAssessment(previous)).rows).toEqual([]);
    await expect(db.query("insert into assessments(workspace_id,source_scan_id,previous_scan_id,input) values ($1,$2,$3,$4)",
      [ids.workspace, ids.scan, previous, { ...assessmentInput, previousScanId: previous }])).rejects.toThrow();
  }
  const first = (await reserveExtension()).rows[0].id;
  expect((await reserveExtension(first)).rows).toHaveLength(1);
  await expect(db.query("insert into extensions(workspace_id,source_scan_id,input,source_extension_id) values ($1,$2,$3,$4)",
    [ids.otherWorkspace, otherScan, { ...extension.input, workspaceId: ids.otherWorkspace, sourceScanId: otherScan }, first])).rejects.toThrow();
  await expect(db.query("delete from scans where id=$1", [ids.scan])).rejects.toThrow();
});

it("reserves only saved successful scans and comparisons without any model key", async () => {
  expect((await reserveAssessment(ids.oldScan)).rows[0]).toMatchObject({ status: "pending", created: true });
  expect((await db.query("select * from reserve_network_diagnostic($1,$2,$3)", [ids.workspace, ids.scan, networkInput])).rows).toHaveLength(1);
  for (const status of ["pending", "failed"]) {
    await db.query("update scans set status=$2,error_code='internal' where id=$1", [ids.oldScan, status]);
    expect((await reserveAssessment(null, ids.oldScan)).rows).toEqual([]);
    expect((await reserveAssessment(ids.oldScan)).rows).toEqual([]);
    expect((await db.query("select * from reserve_network_diagnostic($1,$2,$3)", [ids.workspace, ids.oldScan, { ...networkInput, sourceScanId: ids.oldScan }])).rows).toEqual([]);
    expect((await db.query("select * from reserve_extension($1,$2,$3,null)", [ids.workspace, ids.oldScan, { ...extension.input, sourceScanId: ids.oldScan }])).rows).toEqual([]);
  }
  expect((await reserveAssessment(null, otherScan)).rows).toEqual([]);
  expect((await reserveAssessment(null, missing)).rows).toEqual([]);
});

it("rejects malformed job states, missing/wrong version payloads, uncoded errors and inconsistent result owners", async () => {
  for (const [table, input, result] of [["assessments", assessmentInput, localResult], ["network_diagnostics", networkInput, networkDiagnostic], ["extensions", extension.input, extension]] as const) {
    for (const patch of [null, {}, [], { ...input, schemaVersion: 2 }, { ...input, workspaceId: ids.otherWorkspace }]) {
      await expect(db.query(`insert into ${table}(workspace_id,source_scan_id,input) values ($1,$2,$3)`, [ids.workspace, ids.scan, patch])).rejects.toThrow();
    }
    const id = (await db.query<{ id: string }>(`insert into ${table}(workspace_id,source_scan_id,input) values ($1,$2,$3) returning id`, [ids.workspace, ids.scan, input])).rows[0].id;
    for (const [status, payload, coded] of [["bad", null, null], ["succeeded", null, null], ["succeeded", {}, null], ["succeeded", { ...result, id, workspaceId: ids.otherWorkspace }, null],
      ["succeeded", { ...result, id, schemaVersion: 2 }, null], ["succeeded", { ...result, id, sourceScanId: ids.oldScan }, null],
      ["failed", null, null], ["failed", null, { schemaVersion: 1, code: "raw provider error" }],
      ["failed", null, { schemaVersion: 1, code: "nsg-rule-decisive-allow" }],
      ["failed", null, { ...error, message: "secret" }], ["pending", null, error]]) {
      await expect(db.query(`update ${table} set status=$2,result=$3,error=$4,completed_at=now() where id=$1`, [id, status, payload, coded])).rejects.toThrow();
    }
    await db.query(`update ${table} set status='succeeded',result=$2,completed_at=now() where id=$1`, [id, { ...result, id }]);
    await db.query(`update ${table} set status='failed',result=null,error=$2 where id=$1`, [id, error]);
  }
});

it("keeps local assessment success independent of roadmap reservation, failure and content", async () => {
  const id = (await reserveAssessment()).rows[0].id;
  expect((await db.query("select * from reserve_assessment_roadmap($1,now())", [id])).rows).toEqual([]);
  await db.query("update assessments set status='succeeded',result=$2,completed_at=now() where id=$1", [id, { ...localResult, id }]);
  const call = () => db.query<ReusableReservation>("select * from reserve_assessment_roadmap($1,now()-interval '1 hour')", [id]);
  expect((await db.query("select roadmap_attempt_id from assessments where id=$1", [id])).rows[0]).toEqual({ roadmap_attempt_id: null });
  const first = (await call()).rows[0];
  expect(first).toEqual({ id, status: "pending", created: true, attempt_id: expect.stringMatching(uuid) });
  expect((await call()).rows[0]).toEqual({ ...first, created: false });
  await expect(db.query("update assessments set roadmap_attempt_id=null where id=$1", [id])).rejects.toThrow();
  await db.query("update assessments set roadmap_status='failed',roadmap_error=$2,roadmap_completed_at=now() where id=$1", [id, error]);
  expect((await db.query("select status,result,roadmap_status from assessments where id=$1", [id])).rows[0]).toEqual({ status: "succeeded", result: { ...localResult, id }, roadmap_status: "failed" });
  const revived = (await call()).rows[0];
  expect(revived).toEqual({ ...first, attempt_id: expect.stringMatching(uuid) });
  expect(revived.attempt_id).not.toBe(first.attempt_id);
  await expect(db.query("update assessments set roadmap_status='succeeded',roadmap_completed_at=now() where id=$1", [id])).rejects.toThrow();
  await expect(db.query("update assessments set roadmap_status='failed',roadmap_error='{}',roadmap_completed_at=now() where id=$1", [id])).rejects.toThrow();
  await db.query("update assessments set roadmap_created_at=now()-interval '2 hours',roadmap_usage=$2 where id=$1", [id, { promptTokens: 1, completionTokens: 2, costUsd: 0.1 }]);
  const stale = (await call()).rows[0];
  expect(stale).toEqual({ ...first, attempt_id: expect.stringMatching(uuid) });
  expect(stale.attempt_id).not.toBe(revived.attempt_id);
  const content = { schemaVersion: 1, generatedAt: assessment.createdAt, summary: { en: "Synthetic", ko: "합성" },
    phases: [{ id: "first", title: { en: "Review", ko: "확인" }, findingIds: [assessment.local.findings[0].id], actions: [{ en: "Review", ko: "확인" }] }] };
  await db.query("update assessments set roadmap_status='succeeded',roadmap_content=$2,roadmap_completed_at=now() where id=$1", [id, content]);
  expect((await call()).rows[0]).toEqual({ ...stale, status: "succeeded", created: false });
  expect((await db.query("select result,roadmap_usage from assessments where id=$1", [id])).rows[0]).toEqual({ result: { ...localResult, id }, roadmap_usage: { promptTokens: 1, completionTokens: 2, costUsd: 0.1 } });
});

it("derives artifact owner from successful saved extension, reserves once and revives failures/stale rows", async () => {
  const id = (await reserveExtension()).rows[0].id;
  const call = () => db.query<ReusableReservation>("select * from reserve_extension_artifact($1,'balanced','guide',now()-interval '1 hour')", [id]);
  expect((await call()).rows).toEqual([]);
  await db.query("update extensions set status='succeeded',result=$2,completed_at=now() where id=$1", [id, { ...extension, id }]);
  const [first, again] = await Promise.all([call(), call()]);
  const artifact = first.rows[0];
  expect(artifact).toEqual({ id: expect.any(String), created: true, status: "pending", attempt_id: expect.stringMatching(uuid) });
  expect(again.rows[0]).toEqual({ ...artifact, created: false });
  expect((await db.query("select workspace_id,source_scan_id from extension_artifacts where id=$1", [artifact.id])).rows[0]).toEqual({ workspace_id: ids.workspace, source_scan_id: ids.scan });
  await expect(db.query("update extension_artifacts set attempt_id=null where id=$1", [artifact.id])).rejects.toThrow();
  await expect(db.query("insert into extension_artifacts(extension_id,workspace_id,source_scan_id,tier,kind,input) values ($1,$2,$3,'balanced','guide',$4)",
    [id, ids.workspace, ids.scan, { schemaVersion: 1, extensionId: id, tier: "balanced", kind: "guide" }])).rejects.toThrow();
  await expect(db.query("update extension_artifacts set workspace_id=$2,source_scan_id=$3 where id=$1", [artifact.id, ids.otherWorkspace, otherScan])).rejects.toThrow();
  await expect(db.query("update extension_artifacts set status='succeeded',completed_at=now() where id=$1", [artifact.id])).rejects.toThrow();
  const content = { ...extensionArtifacts[0], id: artifact.id, extensionId: id };
  for (const invalid of [{}, { ...content, schemaVersion: 2 }, { ...content, extensionId: missing },
    { ...content, tier: "ha" }, { ...content, kind: "bicep" }, { ...content, sourceScanId: ids.oldScan }]) {
    await expect(db.query("update extension_artifacts set status='succeeded',content=$2,completed_at=now() where id=$1", [artifact.id, invalid])).rejects.toThrow();
  }
  for (const invalid of [null, {}, { ...error, code: "private provider text" }]) {
    await expect(db.query("update extension_artifacts set status='failed',error=$2,completed_at=now() where id=$1", [artifact.id, invalid])).rejects.toThrow();
  }
  await db.query("update extension_artifacts set status='succeeded',content=$2,completed_at=now() where id=$1", [artifact.id, content]);
  expect((await call()).rows[0]).toEqual({ ...artifact, status: "succeeded", created: false });
  await db.query("update extension_artifacts set status='failed',content=null,error=$2,usage=$3 where id=$1", [artifact.id, error, { promptTokens: 3, completionTokens: 4, costUsd: 0.1 }]);
  const revived = (await call()).rows[0];
  expect(revived).toEqual({ ...artifact, attempt_id: expect.stringMatching(uuid) });
  expect(revived.attempt_id).not.toBe(artifact.attempt_id);
  await db.query("update extension_artifacts set created_at=now()-interval '2 hours' where id=$1", [artifact.id]);
  const stale = (await call()).rows[0];
  expect(stale).toEqual({ ...artifact, attempt_id: expect.stringMatching(uuid) });
  expect(stale.attempt_id).not.toBe(revived.attempt_id);
  expect((await db.query("select error,content,completed_at,usage from extension_artifacts where id=$1", [artifact.id])).rows[0]).toEqual({ error: null, content: null, completed_at: null, usage: { promptTokens: 3, completionTokens: 4, costUsd: 0.1 } });
});

it("fences stale workers by row and attempt together while preserving owner, source scan and billable usage", async () => {
  const assessmentId = (await reserveAssessment()).rows[0].id;
  const extensionId = (await reserveExtension()).rows[0].id;
  await db.query("update assessments set status='succeeded',result=$2,completed_at=now() where id=$1", [assessmentId, { ...localResult, id: assessmentId }]);
  await db.query("update extensions set status='succeeded',result=$2,completed_at=now() where id=$1", [extensionId, { ...extension, id: extensionId }]);
  const owner = createCompletionOwnershipDb({ db: async () => db });
  for (const lane of ["roadmap", "artifact"] as const) {
    const roadmap = lane === "roadmap";
    const reserve = () => roadmap
      ? db.query<ReusableReservation>("select * from reserve_assessment_roadmap($1,now()-interval '1 hour')", [assessmentId])
      : db.query<ReusableReservation>("select * from reserve_extension_artifact($1,'balanced','guide',now()-interval '1 hour')", [extensionId]);
    const table = roadmap ? "assessments" : "extension_artifacts";
    const attempt = roadmap ? "roadmap_attempt_id" : "attempt_id";
    const started = roadmap ? "roadmap_created_at" : "created_at";
    const status = roadmap ? "roadmap_status" : "status";
    const payload = roadmap ? "roadmap_content" : "content";
    const coded = roadmap ? "roadmap_error" : "error";
    const completed = roadmap ? "roadmap_completed_at" : "completed_at";
    const usageColumn = roadmap ? "roadmap_usage" : "usage";
    const source = roadmap ? "assessment-roadmap" : "extension-artifact";
    const old = (await reserve()).rows[0];
    const usage = { promptTokens: 2, completionTokens: 3, costUsd: 0.2 };
    await db.query(`update ${table} set ${started}=now()-interval '2 hours',${usageColumn}=$2 where id=$1`, [old.id, usage]);
    await db.query("insert into llm_calls(source,source_id,prompt_tokens,completion_tokens,cost_usd) values ($1,$2,2,3,0.2)", [source, old.id]);
    const current = (await reserve()).rows[0];
    expect(current.id).toBe(old.id);
    expect(current.attempt_id).toMatch(uuid);
    expect(current.attempt_id).not.toBe(old.attempt_id);
    expect(await owner.getCompletionOwner(source, current.id)).toBe(ids.workspace);
    expect((await db.query(`select workspace_id,source_scan_id,${attempt} as attempt_id,${usageColumn} as usage from ${table} where id=$1`, [current.id])).rows[0])
      .toEqual({ workspace_id: ids.workspace, source_scan_id: ids.scan, attempt_id: current.attempt_id, usage });
    const content = roadmap ? { schemaVersion: 1, generatedAt: assessment.createdAt,
      summary: { en: "Synthetic", ko: "합성" }, phases: [{ id: "first", title: { en: "Review", ko: "확인" },
        findingIds: [assessment.local.findings[0].id], actions: [{ en: "Review", ko: "확인" }] }] }
      : { ...extensionArtifacts[0], id: current.id, extensionId };
    // 후속 어댑터가 사용할 조건을 실제 SQL로 검증한다. 작업 어댑터 자체는 W0에 두지 않는다.
    const succeed = (id: string, token: string) => db.query(`update ${table} set ${status}='succeeded',${payload}=$3,${completed}=now()
      where id=$1 and ${attempt}=$2 and ${status}='pending' returning id`, [id, token, content]);
    const fail = (id: string, token: string) => db.query(`update ${table} set ${status}='failed',${coded}=$3,${completed}=now()
      where id=$1 and ${attempt}=$2 and ${status}='pending' returning id`, [id, token, error]);
    expect((await succeed(current.id, old.attempt_id)).rows).toEqual([]);
    expect((await fail(current.id, old.attempt_id)).rows).toEqual([]);
    expect((await succeed(missing, current.attempt_id)).rows).toEqual([]);
    expect((await fail(missing, current.attempt_id)).rows).toEqual([]);
    expect((await succeed(current.id, current.attempt_id)).rows).toEqual([{ id: current.id }]);
    expect((await fail(current.id, old.attempt_id)).rows).toEqual([]);
    expect((await reserve()).rows[0]).toEqual({ ...current, status: "succeeded", created: false });
    expect((await db.query("select source_id,cost_usd from llm_calls where source=$1", [source])).rows)
      .toEqual([{ source_id: current.id, cost_usd: 0.2 }]);
  }
});

it("cascades workspace removal while retaining all billable history", async () => {
  const id = (await reserveExtension()).rows[0].id;
  await reserveExtension(id);
  await reserveAssessment(ids.oldScan);
  await db.query("update extensions set status='succeeded',result=$2,completed_at=now() where id=$1", [id, { ...extension, id }]);
  await db.query("select * from reserve_extension_artifact($1,'balanced','guide',now())", [id]);
  await db.query("insert into llm_calls(source,source_id,prompt_tokens,completion_tokens,cost_usd) values ('extension',$1,1,2,0.1)", [id]);
  await db.query("delete from workspaces where id=$1", [ids.workspace]);
  for (const table of ["scans", "assessments", "extensions", "extension_artifacts"]) {
    expect((await db.query(`select id from ${table} where workspace_id=$1`, [ids.workspace])).rows).toEqual([]);
  }
  expect((await db.query("select source_id from llm_calls")).rows).toEqual([{ source_id: id }]);
});

it("keeps attempt evidence parent-bound, versioned and independently keyed by attempt",async()=>{
 const assessmentId=(await reserveAssessment()).rows[0].id;
 const extensionId=(await reserveExtension()).rows[0].id;
 await db.query("update extensions set status='succeeded',result=$2,completed_at=now() where id=$1",[extensionId,{...extension,id:extensionId}]);
 const artifact=(await db.query<ReusableReservation>("select * from reserve_extension_artifact($1,'low','guide',now())",[extensionId])).rows[0];
 const evidence={schemaVersion:1,basisDigest:"a".repeat(64),contentDigest:"b".repeat(64),validation:{policyVersion:"v1"}};
 for(const [table,column,id] of [["assessment_roadmap_evidence","assessment_id",assessmentId],["extension_artifact_evidence","artifact_id",artifact.id]]) {
  await db.query(`insert into ${table}(${column},attempt_id,evidence) values ($1,$2,$3)`,[id,ids.extension,evidence]);
  await expect(db.query(`insert into ${table}(${column},attempt_id,evidence) values ($1,$2,$3)`,[id,ids.extension,evidence])).rejects.toThrow();
  await db.query(`insert into ${table}(${column},attempt_id,evidence) values ($1,$2,$3)`,[id,ids.scan,evidence]);
  await expect(db.query(`insert into ${table}(${column},attempt_id,evidence) values ($1,$2,$3)`,[missing,ids.scan,evidence])).rejects.toThrow();
  await expect(db.query(`update ${table} set evidence=$2 where ${column}=$1`,[id,{...evidence,schemaVersion:2}])).rejects.toThrow();
  await expect(db.query(`update ${table} set evidence=$2 where ${column}=$1`,[id,{...evidence,contentDigest:"bad"}])).rejects.toThrow();
 }
 await db.query("delete from assessments where id=$1",[assessmentId]);
 await db.query("delete from extension_artifacts where id=$1",[artifact.id]);
 expect((await db.query("select * from assessment_roadmap_evidence")).rows).toEqual([]);
 expect((await db.query("select * from extension_artifact_evidence")).rows).toEqual([]);
});


it("durably binds every roadmap/artifact attempt through retries without attributing aggregate usage to a new attempt", async () => {
 const aid=(await reserveAssessment()).rows[0].id, eid=(await reserveExtension()).rows[0].id;
 await db.query("update assessments set status='succeeded',result=$2,completed_at=now() where id=$1",[aid,{...localResult,id:aid}]);
 await db.query("update extensions set status='succeeded',result=$2,completed_at=now() where id=$1",[eid,{...extension,id:eid}]);
 for(const roadmap of [true,false]) {
  const ledger=roadmap?"assessment_roadmap_attempts":"extension_artifact_attempts", key=roadmap?"assessment_id":"artifact_id";
  const parent=roadmap?"assessments":"extension_artifacts", started=roadmap?"roadmap_created_at":"created_at";
  const reserve=()=>db.query<ReusableReservation>(roadmap?"select * from reserve_assessment_roadmap($1,now()-interval '1 hour')":"select * from reserve_extension_artifact($1,'low','guide',now()-interval '1 hour')",[roadmap?aid:eid]);
  const old=(await reserve()).rows[0];
  expect((await reserve()).rows[0]).toEqual({...old,created:false});
  expect((await db.query(`select ${key},attempt_id,usage from ${ledger}`)).rows).toEqual([{[key]:old.id,attempt_id:old.attempt_id,usage:null}]);
  await db.query(`update ${parent} set ${started}=now()-interval '2 hours' where id=$1`,[old.id]);
  const renewed=(await reserve()).rows[0];
  expect(renewed.attempt_id).not.toBe(old.attempt_id);
  expect((await db.query(`select attempt_id,usage from ${ledger} where ${key}=$1 order by created_at,attempt_id`,[old.id])).rows).toEqual(expect.arrayContaining([{attempt_id:old.attempt_id,usage:null},{attempt_id:renewed.attempt_id,usage:null}]));
  const known={promptTokens:3,completionTokens:4,costUsd:0.2};
  await db.query(`update ${ledger} set usage=$2 where attempt_id=$1 and ${key}=$3`,[old.attempt_id,known,old.id]);
  await db.query(`update ${ledger} set usage=$2 where attempt_id=$1`,[old.attempt_id,known]);
  for(const usage of [null,{...known,promptTokens:4}]) await expect(db.query(`update ${ledger} set usage=$2 where attempt_id=$1`,[old.attempt_id,usage])).rejects.toThrow();
  await expect(db.query(`update ${ledger} set attempt_id=$2 where attempt_id=$1`,[old.attempt_id,missing])).rejects.toThrow();
  await expect(db.query(`insert into ${ledger}(${key},attempt_id) values ($1,$2)`,[old.id,old.attempt_id])).rejects.toThrow();
  await expect(db.query(`insert into ${ledger}(${key},attempt_id) values ($1,$2)`,[missing,missing])).rejects.toThrow();
  for(const usage of [{},{...known,promptTokens:-1},{...known,completionTokens:0.5},{...known,costUsd:-1},{...known,extra:true},{...known,costUsd:"0.2"}]) await expect(db.query(`update ${ledger} set usage=$2 where attempt_id=$1`,[renewed.attempt_id,usage])).rejects.toThrow();
  await expect(db.query(`update ${ledger} set ${key}=$2 where attempt_id=$1`,[old.attempt_id,missing])).rejects.toThrow();
  expect((await db.query(`select attempt_id from ${ledger} where ${key}=$1 and attempt_id=$2`,[missing,old.attempt_id])).rows).toEqual([]);
  await db.query(`delete from ${parent} where id=$1`,[old.id]);
  expect((await db.query(`select * from ${ledger}`)).rows).toEqual([]);
 }
});


it("backfills only current attempt ownership without rewriting parent usage or saved results", async () => {
 await db.close(); db=new PGlite();
 await db.exec("create table schema_migrations(version text primary key)");
 for(const file of ["0001_init.sql","0002_scans.sql","0003_llm_calls.sql","0004_workspace_claude.sql","0005_completion.sql","0006_extension_saved_evidence.sql","0007_assessment_saved_evidence.sql","0008_completion_attempt_evidence.sql"]) {
  await db.exec(await readFile(`db/migrations/${file}`,"utf8"));
  await db.query("insert into schema_migrations(version) values ($1)",[file]);
 }
 await db.query("insert into workspaces(id,name) values ($1,'Synthetic')",[ids.workspace]);
 await db.query("insert into scans(id,workspace_id,source,status,inventory,summary,collected_at) values ($1,$2,'import','succeeded',$3,$4,$5)",[ids.scan,ids.workspace,legacySnapshot.inventory,legacySnapshot.record.summary,legacySnapshot.record.collectedAt]);
 const aid=(await reserveAssessment()).rows[0].id,eid=(await reserveExtension()).rows[0].id;
 await db.query("update assessments set status='succeeded',result=$2,completed_at=now() where id=$1",[aid,{...localResult,id:aid}]);
 await db.query("update extensions set status='succeeded',result=$2,completed_at=now() where id=$1",[eid,{...extension,id:eid}]);
 const roadmap=(await db.query<ReusableReservation>("select * from reserve_assessment_roadmap($1,now())",[aid])).rows[0];
 const artifact=(await db.query<ReusableReservation>("select * from reserve_extension_artifact($1,'low','guide',now())",[eid])).rows[0];
 const usage={promptTokens:10,completionTokens:20,costUsd:null};
 await db.query("update assessments set roadmap_usage=$2 where id=$1",[aid,usage]);
 await db.query("update extension_artifacts set usage=$2 where id=$1",[artifact.id,usage]);
 const before=await Promise.all([db.query("select * from assessments"),db.query("select * from extension_artifacts")]);
 expect(await applyMigrations(db)).toEqual(["0009_completion_attempt_ledger.sql", "0010_compiler_error.sql"]);
 expect(await applyMigrations(db)).toEqual([]);
 expect((await db.query("select assessment_id,attempt_id,usage from assessment_roadmap_attempts")).rows).toEqual([{assessment_id:aid,attempt_id:roadmap.attempt_id,usage:null}]);
 expect((await db.query("select artifact_id,attempt_id,usage from extension_artifact_attempts")).rows).toEqual([{artifact_id:artifact.id,attempt_id:artifact.attempt_id,usage:null}]);
 expect((await db.query("select * from assessments")).rows).toEqual(before[0].rows);
 expect((await db.query("select * from extension_artifacts")).rows).toEqual(before[1].rows);
 const second=(await reserveAssessment()).rows[0].id;
 await db.query("update assessments set status='succeeded',result=$2,completed_at=now() where id=$1",[second,{...localResult,id:second}]);
 await expect(db.query("update assessments set roadmap_status='pending',roadmap_attempt_id=$2,roadmap_created_at=now() where id=$1",[second,roadmap.attempt_id])).rejects.toThrow();
 expect((await db.query("select roadmap_attempt_id from assessments where id=$1",[second])).rows[0]).toEqual({roadmap_attempt_id:null});
 const otherArtifact=(await db.query<ReusableReservation>("select * from reserve_extension_artifact($1,'ha','guide',now())",[eid])).rows[0];
 await expect(db.query("update extension_artifacts set attempt_id=$2 where id=$1",[otherArtifact.id,artifact.attempt_id])).rejects.toThrow();
 expect((await db.query("select attempt_id from extension_artifacts where id=$1",[otherArtifact.id])).rows[0]).toEqual({attempt_id:otherArtifact.attempt_id});
});
