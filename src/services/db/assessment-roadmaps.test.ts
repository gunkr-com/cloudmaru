import { roadmapModelFixture } from "@/lib/assessment/roadmap/fixtures.test-data";
import { composeExplanation } from "@/lib/assessment/roadmap/explanation";
// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDatabase, insertTestWorkspace } from "@/lib/db/test-db.test-data";
import { completeSnapshot } from "@/lib/completion/fixtures.test-data";
import { toCompletionSourceScan } from "@/lib/completion/source-scan";
import { evaluateAssessmentRules } from "@/lib/assessment/rules/engine";
import * as savedEvidence from "@/lib/assessment/app/saved-evidence";
import * as engine from "@/lib/assessment/rules/engine";
import type { AssessmentResult, AssessmentRoadmap } from "@/types/assessment";
import { createScansDb } from "./scans";
import { createAssessmentsDb } from "./assessments";
import { createAssessmentRoadmapsDb } from "./assessment-roadmaps";
import { buildRoadmapContext } from "@/lib/assessment/roadmap/context";
import { validateRoadmapOutput } from "@/lib/assessment/roadmap/model";

let db: PGlite, id: string, result: AssessmentResult;
let parents: ReturnType<typeof createAssessmentsDb>, store: ReturnType<typeof createAssessmentRoadmapsDb>;
const staleBefore = () => new Date(Date.now() - 300_000);
const usage = { promptTokens: 10, completionTokens: 20, costUsd: 0.2 };
beforeEach(async () => {
  db = await createTestDatabase();
  const workspaceId = await insertTestWorkspace(db);
  const scans = createScansDb({ db: async () => db });
  const sourceScanId = await scans.createImportScan({ workspaceId, subscriptionIds: completeSnapshot.record.subscriptionIds,
    inventory: completeSnapshot.inventory, summary: completeSnapshot.record.summary!, collectedAt: completeSnapshot.record.collectedAt! });
  parents = createAssessmentsDb({ db: async () => db });
  id = (await parents.reserveAssessment({ schemaVersion: 1, workspaceId, sourceScanId, previousScanId: null }))!.id;
  const row = (await parents.getAssessment(id))!;
  result = { schemaVersion: 1, id, workspaceId, sourceScanId,
    sourceScan: toCompletionSourceScan((await scans.getScan(sourceScanId))!, completeSnapshot.inventory), createdAt: row.createdAt,
    local: evaluateAssessmentRules(completeSnapshot.inventory.resources, new Date().toISOString()),
    advisor: { state: "unavailable", reason: "not-supported" },
    actualCost: { schemaVersion: 1, monthToDate: { state: "unavailable", reason: "not-supported" }, trailing30Days: { state: "unavailable", reason: "not-supported" } },
    diff: { state: "not-requested" }, roadmap: { state: "not-requested" } };
  await parents.completeAssessment(id, result);
  store = createAssessmentRoadmapsDb({ db: async () => db });
});
afterEach(async () => { vi.restoreAllMocks(); await db.close(); });
async function content(): Promise<AssessmentRoadmap> {
  const catalog = (await parents.getAssessmentCatalogData(id))!;
  const context = buildRoadmapContext(result, catalog);
  const parsed = validateRoadmapOutput(roadmapModelFixture(context.payload), context, new Date().toISOString());
  if (!parsed.ok) throw new Error("invalid test roadmap");
  return parsed.value;
}
async function charges() { return (await db.query("select source_id,prompt_tokens,completion_tokens,cost_usd from llm_calls where source='assessment-roadmap'")).rows; }
async function proofs() { return (await db.query("select attempt_id,evidence from assessment_roadmap_evidence")).rows; }

it("uses actual successful Assess parents, reuses inflight/success and atomically seals the current attempt without a key", async () => {
  const first = (await store.reserveAssessmentRoadmap(id, staleBefore()))!;
  expect(first).toMatchObject({ id, created: true, status: "pending" });
  expect(await store.reserveAssessmentRoadmap(id, staleBefore())).toEqual({ ...first, created: false });
  const raw = await content();
  expect(await store.completeAssessmentRoadmap(id, first.attemptId, raw, usage)).toBe(true);
  expect(await store.getAssessmentRoadmap(id)).toMatchObject({ id, workspaceId: result.workspaceId, sourceScanId: result.sourceScanId,
    roadmap: { status: "succeeded", attemptId: first.attemptId, content: raw, usage } });
  expect(await store.reserveAssessmentRoadmap(id, staleBefore())).toEqual({ ...first, created: false, status: "succeeded" });
  expect((await parents.getAssessment(id))!.result).toEqual(result);
  expect((await proofs())).toHaveLength(1);
  expect((await charges())).toEqual([{ source_id: first.attemptId, prompt_tokens: 10, completion_tokens: 20, cost_usd: 0.2 }]);
});

it("retries failed/stale attempts with fresh UUIDs; both old callbacks write zero while late billing contributes exactly once", async () => {
  const old = (await store.reserveAssessmentRoadmap(id, staleBefore()))!;
  expect(await store.failAssessmentRoadmap(id, old.attemptId, "timeout", null)).toBe(true);
  const fresh = (await store.reserveAssessmentRoadmap(id, staleBefore()))!;
  expect(fresh.attemptId).not.toBe(old.attemptId);
  const raw = await content();
  expect(await store.completeAssessmentRoadmap(id, old.attemptId, raw, usage)).toBe(false);
  expect(await store.failAssessmentRoadmap(id, old.attemptId, "internal", usage)).toBe(false);
  expect(await store.getAssessmentRoadmap(id)).toMatchObject({ roadmap: { status: "pending", attemptId: fresh.attemptId, usage } });
  expect(await proofs()).toHaveLength(0);
  expect(await store.completeAssessmentRoadmap(id, fresh.attemptId, raw, { ...usage, costUsd: null })).toBe(true);
  const saved = await store.getAssessmentRoadmap(id);
  expect(saved!.roadmap.usage).toEqual({ promptTokens: 20, completionTokens: 40, costUsd: null });
  expect(await store.completeAssessmentRoadmap(id, old.attemptId, raw, usage)).toBe(false);
  expect(await store.failAssessmentRoadmap(id, old.attemptId, "timeout", usage)).toBe(false);
  expect(await store.getAssessmentRoadmap(id)).toEqual(saved);
  expect(await charges()).toHaveLength(2); expect(await proofs()).toHaveLength(1);
  const nextParent = (await parents.reserveAssessment({ ...saved!.input }))!;
  expect(await store.reserveAssessmentRoadmap(nextParent.id, staleBefore())).toBeNull();
  // A stale pending attempt is renewed independently of failed retry.
  const another = (await parents.reserveAssessment(saved!.input))!;
  const nextResult = { ...result, id: another.id, createdAt: (await parents.getAssessment(another.id))!.createdAt,
    local: evaluateAssessmentRules(completeSnapshot.inventory.resources, new Date().toISOString()) };
  await parents.completeAssessment(another.id, nextResult);
  const a = (await store.reserveAssessmentRoadmap(another.id, staleBefore()))!;
  const b = (await store.reserveAssessmentRoadmap(another.id, new Date(Date.now() + 1000)))!;
  expect(b.created).toBe(true); expect(b.attemptId).not.toBe(a.attemptId);
  expect(await store.failAssessmentRoadmap(another.id, a.attemptId, "timeout", usage)).toBe(false);
});

it("deduplicates concurrent callbacks and rejects different known combined usage, including after success", async () => {
  const a = (await store.reserveAssessmentRoadmap(id, staleBefore()))!, raw = await content();
  const updates = await Promise.all([store.completeAssessmentRoadmap(id, a.attemptId, raw, usage), store.completeAssessmentRoadmap(id, a.attemptId, raw, usage)]);
  expect(updates.sort()).toEqual([false, true]);
  await expect(store.failAssessmentRoadmap(id, a.attemptId, "timeout", { ...usage, promptTokens: 11 })).rejects.toThrow("저장소 요청에 실패했습니다.");
  expect(await charges()).toHaveLength(1); expect((await store.getAssessmentRoadmap(id))!.roadmap.usage).toEqual(usage);
});

it("keeps billing through content validation failure and independently records unknown as null", async () => {
  const a = (await store.reserveAssessmentRoadmap(id, staleBefore()))!;
  await expect(store.completeAssessmentRoadmap(id, a.attemptId, {}, usage)).rejects.toThrow("저장소 요청에 실패했습니다.");
  expect(await charges()).toHaveLength(1); expect(await proofs()).toHaveLength(0);
  expect(await store.failAssessmentRoadmap(id, a.attemptId, "validation-failed", usage)).toBe(true);
  expect((await parents.getAssessment(id))!.result).toEqual(result);
  const b = (await store.reserveAssessmentRoadmap(id, staleBefore()))!;
  expect((await store.getAssessmentRoadmap(id))!.roadmap.usage).toEqual(usage);
  await store.failAssessmentRoadmap(id, b.attemptId, "timeout", null);
  expect(await charges()).toHaveLength(1);
});

it.each(["terminal-update", "terminal-fail", "proof-insert"])("preserves billing and rolls back terminal state on %s SQL failure", async mode => {
  const a = (await store.reserveAssessmentRoadmap(id, staleBefore()))!;
  if (mode !== "proof-insert") await db.exec(`create function reject_terminal() returns trigger language plpgsql as $$ begin
    if new.roadmap_status='${mode === "terminal-fail" ? "failed" : "succeeded"}' then raise exception 'private-sql-error'; end if; return new; end $$;
    create trigger reject_terminal before update on assessments for each row execute function reject_terminal();`);
  else await db.exec(`create function reject_proof() returns trigger language plpgsql as $$ begin raise exception 'private-sql-error'; end $$;
    create trigger reject_proof before insert on assessment_roadmap_evidence for each row execute function reject_proof();`);
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  await expect(mode === "terminal-fail" ? store.failAssessmentRoadmap(id, a.attemptId, "timeout", usage)
    : store.completeAssessmentRoadmap(id, a.attemptId, await content(), usage)).rejects.toThrow("저장소 요청에 실패했습니다.");
  expect(JSON.stringify(log.mock.calls)).not.toContain("private-sql-error");
  expect(await charges()).toHaveLength(1); expect(await proofs()).toHaveLength(0);
  expect((await store.getAssessmentRoadmap(id))!.roadmap).toMatchObject({ status: "pending", content: null, usage });
});

it.each(["finding", "action", "time", "extra"])("rejects write %s tampering without erasing local success", async kind => {
  const a = (await store.reserveAssessmentRoadmap(id, staleBefore()))!, raw = await content();
  if (kind === "finding") raw.phases[0].findingIds = [randomUUID()];
  if (kind === "action") raw.phases[0].actions = [{ en: "Resize everything", ko: "모두 크기를 바꿉니다." }];
  if (kind === "time") raw.generatedAt = "2000-01-01T00:00:00Z";
  if (kind === "extra") Object.assign(raw, { verdict: "pass" });
  await expect(store.completeAssessmentRoadmap(id, a.attemptId, raw, null)).rejects.toThrow();
  expect((await parents.getAssessment(id))!.result).toEqual(result); expect(await proofs()).toHaveLength(0);
});

it.each(["action", "finding", "proof", "attempt", "owner", "source", "time", "basis"])("rejects saved %s corruption on read and reservation", async kind => {
  const a = (await store.reserveAssessmentRoadmap(id, staleBefore()))!;
  await store.completeAssessmentRoadmap(id, a.attemptId, await content(), null);
  if (kind === "proof") await db.query("delete from assessment_roadmap_evidence where assessment_id=$1", [id]);
  if (kind === "attempt") await db.query("update assessments set roadmap_attempt_id=$2 where id=$1", [id, randomUUID()]);
  if (kind === "owner") {
    await expect(db.query("update assessments set input=jsonb_set(input,'{workspaceId}',to_jsonb($2::text)) where id=$1", [id, randomUUID()])).rejects.toThrow();
    expect((await store.getAssessmentRoadmap(id))!.workspaceId).toBe(result.workspaceId);
    return;
  }
  if (kind === "source") await db.query("update scans set inventory=jsonb_set(inventory,'{resources,0,properties}', '{\"changed\":true}') where id=$1", [result.sourceScanId]);
  if (kind === "basis") await db.query("update assessments set result=jsonb_set(result,'{local,rulesVersion}', '\"9.9.9\"') where id=$1", [id]);
  if (["action", "finding", "time"].includes(kind)) {
    const raw = (await parents.getAssessment(id))!.roadmap.content!;
    if (kind === "action") raw.phases[0].actions[0] = { en: "Unsafe", ko: "위험" };
    if (kind === "finding") raw.phases[0].findingIds = [randomUUID()];
    if (kind === "time") raw.generatedAt = "2000-01-01T00:00:00Z";
    await db.query("update assessments set roadmap_content=$2 where id=$1", [id, raw]);
  }
  await expect(store.getAssessmentRoadmap(id)).rejects.toThrow("저장소 요청에 실패했습니다.");
  await expect(store.reserveAssessmentRoadmap(id, staleBefore())).rejects.toThrow();
});

it("reopens proof with immutable basis after late usage, without replaying current engines", async () => {
  const a = (await store.reserveAssessmentRoadmap(id, staleBefore()))!;
  await store.completeAssessmentRoadmap(id, a.attemptId, await content(), null);
  const proof = await proofs();
  vi.spyOn(engine, "evaluateAssessmentRules").mockImplementation(() => { throw Error("must not replay"); });
  expect(await store.failAssessmentRoadmap(id, a.attemptId, "timeout", usage)).toBe(false);
  expect((await store.getAssessmentRoadmap(id))!.roadmap.status).toBe("succeeded");
  expect(await proofs()).toEqual(proof);
});

it("rejects invalid IDs cheaply, missing/non-success parents and invalid usage without exposing provider errors", async () => {
  const dependency = vi.fn(), empty = createAssessmentRoadmapsDb({ db: dependency });
  expect(await empty.getAssessmentRoadmap("bad")).toBeNull();
  expect(await empty.reserveAssessmentRoadmap("bad", staleBefore())).toBeNull();
  expect(await empty.completeAssessmentRoadmap(id, "bad", {}, usage)).toBe(false);
  expect(await empty.failAssessmentRoadmap("bad", randomUUID(), "internal", null)).toBe(false);
  expect(dependency).not.toHaveBeenCalled();
  expect(await store.reserveAssessmentRoadmap(randomUUID(), staleBefore())).toBeNull();
  expect(await store.completeAssessmentRoadmap(randomUUID(), randomUUID(), {}, usage)).toBe(false);
  const pending = (await parents.reserveAssessment((await parents.getAssessment(id))!.input))!;
  expect(await store.reserveAssessmentRoadmap(pending.id, staleBefore())).toBeNull();
  await parents.failAssessment(pending.id, "timeout");
  expect(await store.reserveAssessmentRoadmap(pending.id, staleBefore())).toBeNull();
  const a = (await store.reserveAssessmentRoadmap(id, staleBefore()))!;
  await expect(store.failAssessmentRoadmap(id, a.attemptId, "internal", { ...usage, promptTokens: -1 })).rejects.toThrow();
  expect(await charges()).toHaveLength(0);
  dependency.mockRejectedValue(Error("private-provider-error"));
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  await expect(empty.getAssessmentRoadmap(id)).rejects.toThrow("저장소 요청에 실패했습니다.");
  expect(JSON.stringify(log.mock.calls)).not.toContain("private-provider-error");
});


it("bills a previously unknown old attempt after a new success without changing its proof or content", async () => {
  const a = (await store.reserveAssessmentRoadmap(id, staleBefore()))!;
  await store.failAssessmentRoadmap(id, a.attemptId, "timeout", null);
  expect((await store.getAssessmentRoadmap(id))!.roadmap.usage).toBeNull();
  expect(await charges()).toEqual([]);
  const b = (await store.reserveAssessmentRoadmap(id, staleBefore()))!;
  await store.completeAssessmentRoadmap(id, b.attemptId, await content(), usage);
  const saved = (await store.getAssessmentRoadmap(id))!, proof = await proofs();
  expect(await store.completeAssessmentRoadmap(id, a.attemptId, {}, { ...usage, costUsd: null })).toBe(false);
  expect(await store.failAssessmentRoadmap(id, a.attemptId, "timeout", { ...usage, costUsd: null })).toBe(false);
  expect(await store.getAssessmentRoadmap(id)).toEqual({ ...saved, roadmap: { ...saved.roadmap,
    usage: { promptTokens: 20, completionTokens: 40, costUsd: null } } });
  expect(await proofs()).toEqual(proof); expect(await charges()).toHaveLength(2);
});

it.each([null, usage])("requires durable parent+attempt membership even for %j usage", async known => {
  const a = (await store.reserveAssessmentRoadmap(id, staleBefore()))!;
  const forged = randomUUID();
  expect(await store.completeAssessmentRoadmap(id, forged, {}, known)).toBe(false);
  expect(await store.failAssessmentRoadmap(id, forged, "internal", known)).toBe(false);
  const second = (await parents.reserveAssessment((await parents.getAssessment(id))!.input))!;
  const pending = (await parents.getAssessment(second.id))!;
  await parents.completeAssessment(second.id, { ...result, id: second.id, createdAt: pending.createdAt,
    local: evaluateAssessmentRules(completeSnapshot.inventory.resources, new Date().toISOString()) });
  const b = (await store.reserveAssessmentRoadmap(second.id, staleBefore()))!;
  expect(await store.failAssessmentRoadmap(id, b.attemptId, "internal", known)).toBe(false);
  expect(await store.completeAssessmentRoadmap(second.id, a.attemptId, {}, known)).toBe(false);
  expect(await charges()).toEqual([]); expect(await proofs()).toEqual([]);
  expect((await store.getAssessmentRoadmap(id))!.roadmap).toMatchObject({ status: "pending", attemptId: a.attemptId, usage: null });
});
it("persists first known ledger usage and reopens old attempt accounting across service restarts", async () => {
  const a = (await store.reserveAssessmentRoadmap(id, staleBefore()))!;
  await store.failAssessmentRoadmap(id, a.attemptId, "timeout", null);
  const b = (await store.reserveAssessmentRoadmap(id, staleBefore()))!;
  store = createAssessmentRoadmapsDb({ db: async () => db });
  expect(await store.failAssessmentRoadmap(id, a.attemptId, "timeout", usage)).toBe(false);
  expect((await db.query("select usage from assessment_roadmap_attempts where assessment_id=$1 and attempt_id=$2", [id, a.attemptId])).rows).toEqual([{ usage }]);
  expect(await store.completeAssessmentRoadmap(id, b.attemptId, await content(), usage)).toBe(true);
  store = createAssessmentRoadmapsDb({ db: async () => db });
  expect(await store.failAssessmentRoadmap(id, a.attemptId, "timeout", usage)).toBe(false);
  await expect(store.failAssessmentRoadmap(id, a.attemptId, "timeout", { ...usage, completionTokens: 21 })).rejects.toThrow();
  expect(await charges()).toHaveLength(2);
  expect((await store.getAssessmentRoadmap(id))!.roadmap.usage).toEqual({ promptTokens: 20, completionTokens: 40, costUsd: 0.4 });
});
it("rejects attempts missing from the ledger without adding known charges", async () => {
  const a = (await store.reserveAssessmentRoadmap(id, staleBefore()))!;
  await db.query("delete from assessment_roadmap_attempts where attempt_id=$1", [a.attemptId]);
  expect(await store.failAssessmentRoadmap(id, a.attemptId, "timeout", usage)).toBe(false);
  expect(await store.completeAssessmentRoadmap(id, a.attemptId, {}, null)).toBe(false);
  expect(await charges()).toEqual([]); expect(await proofs()).toEqual([]);
});
it.each(["ledger", "call", "parent"])("rolls back the entire charge transaction on %s write failure", async target => {
  const a = (await store.reserveAssessmentRoadmap(id, staleBefore()))!;
  const table = target === "ledger" ? "assessment_roadmap_attempts" : target === "call" ? "llm_calls" : "assessments";
  await db.exec(`create function reject_charge() returns trigger language plpgsql as $$ begin raise exception 'SECRET charge'; end $$;
    create trigger reject_charge before ${target === "call" ? "insert" : "update"} on ${table} for each row execute function reject_charge();`);
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  await expect(store.failAssessmentRoadmap(id, a.attemptId, "timeout", usage)).rejects.toThrow("저장소 요청에 실패했습니다.");
  expect(JSON.stringify(log.mock.calls)).not.toContain("SECRET");
  expect((await db.query("select usage from assessment_roadmap_attempts where attempt_id=$1", [a.attemptId])).rows).toEqual([{ usage: null }]);
  expect(await charges()).toEqual([]); expect(await proofs()).toEqual([]);
  expect((await store.getAssessmentRoadmap(id))!.roadmap).toMatchObject({ status: "pending", usage: null });
});
it("rejects missing or mismatched call evidence for known ledger aggregates", async () => {
  const a = (await store.reserveAssessmentRoadmap(id, staleBefore()))!;
  await store.failAssessmentRoadmap(id, a.attemptId, "timeout", usage);
  await db.query("update llm_calls set completion_tokens=99 where source='assessment-roadmap' and source_id=$1", [a.attemptId]);
  await expect(store.failAssessmentRoadmap(id, a.attemptId, "timeout", usage)).rejects.toThrow();
  await db.query("delete from llm_calls where source='assessment-roadmap' and source_id=$1", [a.attemptId]);
  await expect(store.failAssessmentRoadmap(id, a.attemptId, "timeout", null)).rejects.toThrow();
  expect((await store.getAssessmentRoadmap(id))!.roadmap.usage).toEqual(usage);
});

it("refuses an unregistered current attempt with null usage before any terminal write", async () => {
  const a = (await store.reserveAssessmentRoadmap(id, staleBefore()))!;
  await db.query("delete from assessment_roadmap_attempts where attempt_id=$1", [a.attemptId]);
  expect(await store.failAssessmentRoadmap(id, a.attemptId, "timeout", null)).toBe(false);
  expect(await store.completeAssessmentRoadmap(id, a.attemptId, await content(), null)).toBe(false);
  expect((await store.getAssessmentRoadmap(id))!.roadmap.status).toBe("pending");
  expect(await proofs()).toEqual([]);
});

it.each([null, { schemaVersion: 1 }])("rejects unpinned/corrupt parents before current loaders or engines for all roadmap operations (%j)", async evidence => {
  const reservation = (await store.reserveAssessmentRoadmap(id, staleBefore()))!;
  await db.query("update assessments set saved_evidence=$2 where id=$1", [id, evidence]);
  const replay = vi.spyOn(engine, "evaluateAssessmentRules").mockImplementation(() => { throw new Error("CURRENT ENGINE MUST NOT RUN"); });
  const current = vi.spyOn(savedEvidence, "currentAssessmentCatalogData").mockImplementation(() => { throw new Error("CURRENT CATALOG MUST NOT RUN"); });
  for (const operation of [
    () => store.getAssessmentRoadmap(id),
    () => store.reserveAssessmentRoadmap(id, staleBefore()),
    () => store.completeAssessmentRoadmap(id, reservation.attemptId, {}, null),
    () => store.failAssessmentRoadmap(id, reservation.attemptId, "internal", null),
  ]) await expect(operation()).rejects.toThrow("저장소 요청에 실패했습니다.");
  expect(replay).not.toHaveBeenCalled();
  expect(current).not.toHaveBeenCalled();
  expect((await db.query("select * from llm_calls")).rows).toHaveLength(0);
  expect((await db.query("select * from assessment_roadmap_evidence")).rows).toHaveLength(0);
});


it.each(["pass-only", "omitted-group", "duplicate-finding", "split-group", "missing-action", "mismatched-action", "unsafe-summary", "unsafe-title", "arbitrary-prose"])(
  "rejects semantic seal bypass %s through the real adapter while billing independently once", async kind => {
    const reservation = (await store.reserveAssessmentRoadmap(id, staleBefore()))!;
    const raw = await content(), catalog = (await parents.getAssessmentCatalogData(id))!;
    expect(raw.phases.length).toBeGreaterThan(1);
    if (kind === "pass-only") {
      const pass = result.local.findings.find(f => f.verdict === "pass")!;
      expect(pass).toBeDefined();
      raw.phases = [{ ...raw.phases[0], findingIds: [pass.id],
        actions: [catalog.rules.rules.find(r => r.id === pass.ruleId)!.remediation] }];
    }
    if (kind === "omitted-group") raw.phases.pop();
    if (kind === "duplicate-finding") raw.phases.push({ ...structuredClone(raw.phases[0]), id: "duplicate" });
    if (kind === "split-group") {
      const group = raw.phases.find(p => p.findingIds.length > 1)!;
      expect(group).toBeDefined();
      raw.phases.push({ ...structuredClone(group), id: "split", findingIds: group.findingIds.splice(1) });
    }
    if (kind === "missing-action" || kind === "mismatched-action") {
      const first = raw.phases.shift()!, second = raw.phases.shift()!;
      raw.phases.unshift({ ...first, findingIds: [...first.findingIds, ...second.findingIds],
        actions: kind === "missing-action" ? first.actions : second.actions });
    }
    if (kind === "unsafe-summary") raw.summary = { en: "Deploy Azure OpenAI for CAD 500 savings.", ko: "Azure OpenAI를 배포하여 500달러 절감합니다." };
    if (kind === "unsafe-title") raw.phases[0].title = { en: "Install redis", ko: "레디스를 설치합니다." };
    if (kind === "arbitrary-prose") raw.summary = { en: "Bananas taste wonderful.", ko: "바나나는 맛있습니다." };
    for (let repeat = 0; repeat < 2; repeat++)
      await expect(store.completeAssessmentRoadmap(id, reservation.attemptId, raw, usage)).rejects.toThrow("저장소 요청에 실패했습니다.");
    expect(await proofs()).toEqual([]);
    expect(await charges()).toHaveLength(1);
    expect((await store.getAssessmentRoadmap(id))!.roadmap).toMatchObject({ status: "pending", content: null, usage });
    expect((await parents.getAssessment(id))!.result).toEqual(result);
    expect(await store.failAssessmentRoadmap(id, reservation.attemptId, "validation-failed", usage)).toBe(true);
    expect(await charges()).toHaveLength(1);
  });

it.each(["assessment-roadmap-v1", "assessment-roadmap-v2"])("reopens historical %s successes without replaying current prose or write semantics", async policyVersion => {
  const { sealAttemptEvidence } = await import("@/lib/completion/attempt-evidence");
  const currentPolicy = await import("@/lib/assessment/roadmap/write-validation");
  const a = (await store.reserveAssessmentRoadmap(id, staleBefore()))!;
  await store.completeAssessmentRoadmap(id, a.attemptId, await content(), null);
  const saved = (await store.getAssessmentRoadmap(id))!, historical = structuredClone(saved.roadmap.content!);
  historical.summary = { en: "Historical editorial wording.", ko: "과거 정책으로 저장된 설명입니다." };
  // 새 생성 정책 이전에 정상 저장된 성공/증거를 재현한다. 새 쓰기는 이 문장을 거절한다.
  const catalogData = (await store.getAssessmentRoadmapCatalogData(id))!;
  expect(() => currentPolicy.validateRoadmapForWrite(historical, { assessment: result, catalogData,
    createdAt: saved.roadmap.createdAt!, completedAt: saved.roadmap.completedAt! })).toThrow();
  const proof = sealAttemptEvidence({ source: "assessment-roadmap", rowId: id, attemptId: a.attemptId, kind: "roadmap" },
    historical, { assessment: result, catalogData }, { policyVersion });
  await db.query("update assessments set roadmap_content=$2 where id=$1", [id, historical]);
  await db.query("update assessment_roadmap_evidence set evidence=$2 where assessment_id=$1", [id, proof]);
  const policy = vi.spyOn(currentPolicy, "validateRoadmapForWrite").mockImplementation(() => { throw Error("NO GENERATION POLICY REPLAY"); });
  store = createAssessmentRoadmapsDb({ db: async () => db });
  expect((await store.getAssessmentRoadmap(id))!.roadmap.content).toEqual(historical);
  expect(await store.failAssessmentRoadmap(id, a.attemptId, "timeout", usage)).toBe(false);
  const { createAssessmentReportService } = await import("@/services/assessment-roadmap-report");
  const report = await createAssessmentReportService({ db: async () => db }).get(id, "en");
  expect(JSON.stringify(report)).toContain(historical.summary.en);
  expect(policy).not.toHaveBeenCalled(); expect(await charges()).toHaveLength(1);
});

it.each([
  { en: "disable HTTPS-only traffic.", ko: "HTTPS 전용 트래픽을 설정합니다." },
  { en: "Disable HTTPS-only traffic.", ko: "HTTPS 전용 트래픽을 설정합니다." },
  { en: "HTTPS is configured. TLS is enabled.", ko: "HTTPS 설정과 TLS 확인이 필요합니다." },
  { en: "Review HTTPS before TLS.", ko: "TLS 이후 HTTPS를 검토합니다." },
  { en: "Review HTTPS traffic protection.", ko: "가상데스크톱으로 전환 후 HTTPS 검토" },
])("never seals the reproduced semantic bypass through a direct adapter call: $en", async summary => {
  const a = (await store.reserveAssessmentRoadmap(id, staleBefore()))!, raw = await content(); raw.summary = summary;
  for (let repeat = 0; repeat < 2; repeat++)
    await expect(store.completeAssessmentRoadmap(id, a.attemptId, raw, usage)).rejects.toThrow();
  expect(await proofs()).toHaveLength(0); expect(await charges()).toHaveLength(1);
  expect((await store.getAssessmentRoadmap(id))!.roadmap.status).toBe("pending");
});

it.each(["wrong-order", "foreign-title", "language-order", "focus-mismatch"])("rejects compositional %s before proof, with known billing preserved", async mode => {
  const a = (await store.reserveAssessmentRoadmap(id, staleBefore()))!, raw = await content();
  const context = buildRoadmapContext(result, (await parents.getAssessmentCatalogData(id))!);
  const actions = context.payload.actions.slice(0, 2).map(item => item.alias);
  const forward = composeExplanation({ relation: "sequence", actions, focus: "review" }, context.payload);
  const reversed = composeExplanation({ relation: "sequence", actions: [...actions].reverse(), focus: "review" }, context.payload);
  if (mode === "wrong-order") raw.summary = reversed;
  if (mode === "language-order") raw.summary = { en: forward.en, ko: reversed.ko };
  if (mode === "foreign-title") raw.phases[0].title = raw.phases[1].title;
  if (mode === "focus-mismatch") raw.summary = { en: forward.en, ko: composeExplanation({ relation: "sequence", actions, focus: "unknowns" }, context.payload).ko };
  await expect(store.completeAssessmentRoadmap(id, a.attemptId, raw, usage)).rejects.toThrow();
  expect(await proofs()).toHaveLength(0); expect(await charges()).toHaveLength(1);
});

it.each(["before", "after"] as const)("seals a correctly aligned source-specific %s explanation", async surface => {
  const a = (await store.reserveAssessmentRoadmap(id, staleBefore()))!, raw = await content();
  const context = buildRoadmapContext(result, (await parents.getAssessmentCatalogData(id))!);
  raw.summary = composeExplanation({ relation: "sequence", actions: context.payload.actions.slice(0, 2).map(item => item.alias), focus: "review" }, context.payload, surface);
  expect(await store.completeAssessmentRoadmap(id, a.attemptId, raw, usage)).toBe(true);
  expect((await store.getAssessmentRoadmap(id))!.roadmap.content!.summary).toEqual(raw.summary);
  expect(await proofs()).toHaveLength(1);
});
