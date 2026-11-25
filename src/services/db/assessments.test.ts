// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDatabase, insertTestWorkspace } from "@/lib/db/test-db.test-data";
import { completeSnapshot, ids, resourceIds } from "@/lib/completion/fixtures.test-data";
import * as rulesEngine from "@/lib/assessment/rules/engine";
import { evaluateAssessmentRules } from "@/lib/assessment/rules/engine";
import { compareScans } from "@/lib/inventory/diff";
import { toCompletionSourceScan } from "@/lib/completion/source-scan";
import { advisorCatalog } from "@/lib/assessment/advisor-catalog";
import type { AssessmentResult } from "@/types/assessment";
import { createScansDb } from "./scans";
import { createAssessmentsDb } from "./assessments";

let db: PGlite;
let store: ReturnType<typeof createAssessmentsDb>;
let input: { schemaVersion: 1; workspaceId: string; sourceScanId: string; previousScanId: string | null };
let scans: ReturnType<typeof createScansDb>;
beforeEach(async () => {
  db = await createTestDatabase(); scans = createScansDb({ db: async () => db });
  const workspaceId = await insertTestWorkspace(db);
  const sourceScanId = await scans.createImportScan({ workspaceId, subscriptionIds: completeSnapshot.record.subscriptionIds,
    inventory: completeSnapshot.inventory, summary: completeSnapshot.record.summary!, collectedAt: completeSnapshot.record.collectedAt! });
  input = { schemaVersion: 1, workspaceId, sourceScanId, previousScanId: null };
  store = createAssessmentsDb({ db: async () => db });
});
afterEach(async () => { await db.close(); vi.restoreAllMocks(); });
async function resultFor(id: string): Promise<AssessmentResult> {
  const row = (await store.getAssessment(id))!;
  const scan = (await scans.getScan(row.sourceScanId))!;
  const inventory = (await scans.getScanInventory(row.sourceScanId))!;
  const now = new Date().toISOString();
  const result: AssessmentResult = { schemaVersion: 1, id, workspaceId: row.workspaceId, sourceScanId: row.sourceScanId,
    sourceScan: toCompletionSourceScan(scan, inventory), createdAt: row.createdAt,
    local: evaluateAssessmentRules(inventory.resources, now), advisor: { state: "unavailable", reason: "not-supported" },
    actualCost: { schemaVersion: 1, monthToDate: { state: "unavailable", reason: "not-supported" }, trailing30Days: { state: "unavailable", reason: "not-supported" } },
    diff: { state: "not-requested" }, roadmap: { state: "not-requested" } };
  if (row.previousScanId) result.diff = { state: "available", data: compareScans({ scan: (await scans.getScan(row.previousScanId))!,
    inventory: (await scans.getScanInventory(row.previousScanId))! }, { scan, inventory }, now) };
  return result;
}

it("reserves, completes, reopens and lists against the saved owner and fixed scan without a Claude key", async () => {
  const a = (await store.reserveAssessment(input))!;
  const b = (await store.reserveAssessment(input))!;
  expect(a).toMatchObject({ created: true, status: "pending" }); expect(a.id).not.toBe(b.id);
  expect((await store.getAssessment(a.id))?.input).toEqual(input);
  expect((await db.query<{ input: unknown }>("select input from assessments where id=$1", [a.id])).rows[0].input).toEqual(input);
  const result = await resultFor(a.id);
  expect(await store.completeAssessment(a.id, result)).toBe(true);
  const saved = (await store.getAssessment(a.id))!;
  expect(saved).toMatchObject({ status: "succeeded", result, roadmap: { status: "not-requested", content: null, attemptId: null } });
  await scans.createImportScan({ workspaceId: input.workspaceId, subscriptionIds: completeSnapshot.record.subscriptionIds,
    inventory: completeSnapshot.inventory, summary: completeSnapshot.record.summary!, collectedAt: new Date().toISOString() });
  const otherOwner = await insertTestWorkspace(db);
  expect(await store.listAssessments(otherOwner)).toEqual([]);
  expect(await store.getAssessment(a.id)).toEqual(saved);
  const list = await store.listAssessments(input.workspaceId);
  expect(list).toHaveLength(2); expect(list.find(r => r.id === a.id)).toEqual(saved);
  expect(await store.listAssessments(input.workspaceId, { sourceScanId: ids.scan })).toEqual([]);
  expect(await store.listAssessments(input.workspaceId, { sourceScanId: input.sourceScanId, limit: 1 })).toHaveLength(1);
  expect(await store.failAssessment(a.id, "timeout")).toBe(false);
  expect(await store.completeAssessment(a.id, result)).toBe(false);
  expect(await store.getAssessment(a.id)).toEqual(saved);
});

it("fails once with coded errors and cannot be completed by late workers", async () => {
  const reserved = (await store.reserveAssessment(input))!; const result = await resultFor(reserved.id);
  expect(await store.failAssessment(reserved.id, "timeout")).toBe(true);
  const saved = await store.getAssessment(reserved.id);
  expect(saved).toMatchObject({ status: "failed", result: null, error: { schemaVersion: 1, code: "timeout" } });
  expect(await store.failAssessment(reserved.id, "internal")).toBe(false);
  expect(await store.completeAssessment(reserved.id, result)).toBe(false);
  expect(await store.getAssessment(reserved.id)).toEqual(saved);
});

it("can close a pending reservation whose source inventory became unreadable", async () => {
  const reserved = (await store.reserveAssessment(input))!;
  await db.query("update scans set inventory=$2 where id=$1", [input.sourceScanId, { resources: [] }]);
  expect(await store.failAssessment(reserved.id, "validation-failed")).toBe(true);
  expect((await db.query("select status,error from assessments where id=$1", [reserved.id])).rows[0]).toEqual({
    status: "failed", error: { schemaVersion: 1, code: "validation-failed" },
  });
  expect(await store.failAssessment(reserved.id, "internal")).toBe(false);
});

it("rejects nonexistent/wrong-owner/non-success scans and same/newer/equal-time comparisons before inserting", async () => {
  expect(await store.reserveAssessment({ ...input, workspaceId: await insertTestWorkspace(db) })).toBeNull();
  expect(await store.reserveAssessment({ ...input, sourceScanId: ids.scan })).toBeNull();
  expect(await store.reserveAssessment({ ...input, previousScanId: ids.oldScan })).toBeNull();
  expect(await store.reserveAssessment({ ...input, previousScanId: input.sourceScanId })).toBeNull();
  const otherOwner = await insertTestWorkspace(db);
  const comparison = await scans.createImportScan({ workspaceId: otherOwner, subscriptionIds: completeSnapshot.record.subscriptionIds,
    inventory: completeSnapshot.inventory, summary: completeSnapshot.record.summary!, collectedAt: "2026-11-09T12:00:00Z" });
  expect(await store.reserveAssessment({ ...input, previousScanId: comparison })).toBeNull();
  await db.query("update scans set workspace_id=$2, collected_at=$3 where id=$1", [comparison, input.workspaceId, completeSnapshot.record.collectedAt]);
  expect(await store.reserveAssessment({ ...input, previousScanId: comparison })).toBeNull();
  await db.query("update scans set collected_at=$2 where id=$1", [comparison, "2026-11-11T12:00:00Z"]);
  expect(await store.reserveAssessment({ ...input, previousScanId: comparison })).toBeNull();
  for (const status of ["pending", "failed"]) {
    await db.query("update scans set status=$2,error_code=$3 where id=$1", [input.sourceScanId, status, status === "failed" ? "internal" : null]);
    expect(await store.reserveAssessment(input)).toBeNull();
  }
  expect((await db.query("select id from assessments")).rows).toEqual([]);
});

it("accepts a strictly earlier comparison, retains its ID and baseline-only references", async () => {
  const inventory = structuredClone(completeSnapshot.inventory);
  const removed = structuredClone(inventory.resources[0]); removed.id += "-old"; removed.name += "-old";
  inventory.resources.push(removed);
  const comparison = await scans.createImportScan({ workspaceId: input.workspaceId, subscriptionIds: completeSnapshot.record.subscriptionIds,
    inventory, summary: { ...completeSnapshot.record.summary!, resourceCount: inventory.resources.length }, collectedAt: "2026-11-09T12:00:00Z" });
  input.previousScanId = comparison;
  const a = (await store.reserveAssessment(input))!; const result = await resultFor(a.id);
  expect(result.diff.state).toBe("available");
  expect("data" in result.diff && result.diff.data.changes.some(c => c.resourceId === removed.id && c.kind === "unknown")).toBe(true);
  expect(await store.completeAssessment(a.id, result)).toBe(true);
  expect(await store.getAssessment(a.id)).toMatchObject({ previousScanId: comparison, result });
});

it("sanitizes invalid source metadata and request shapes without creating pending rows", async () => {
  await expect(db.query("update scans set inventory=null where id=$1", [input.sourceScanId])).rejects.toThrow();
  for (const patch of [{ subscription_ids: [] }, { inventory: { resources: [] } },
    { summary: { ...completeSnapshot.record.summary, resourceCount: 999 } }]) {
    const id = await scans.createImportScan({ workspaceId: input.workspaceId, subscriptionIds: completeSnapshot.record.subscriptionIds,
      inventory: completeSnapshot.inventory, summary: completeSnapshot.record.summary!, collectedAt: completeSnapshot.record.collectedAt! });
    const [key, value] = Object.entries(patch)[0];
    await db.query(`update scans set ${key}=$2 where id=$1`, [id, value]);
    await expect(store.reserveAssessment({ ...input, sourceScanId: id })).rejects.toThrow("저장소 요청에 실패했습니다.");
  }
  await expect(store.reserveAssessment({ ...input, requested: { advisor: false } } as typeof input)).rejects.toThrow("저장소 요청에 실패했습니다.");
  expect((await db.query("select id from assessments")).rows).toEqual([]);
});

it("validates complete/write and get/list/read against real rules and inventory", async () => {
  const a = (await store.reserveAssessment(input))!; const valid = await resultFor(a.id);
  for (const kind of ["workspace", "source", "version", "evidence", "id"]) {
    const result = structuredClone(valid);
    if (kind === "workspace") result.workspaceId = ids.otherWorkspace;
    if (kind === "source") result.sourceScan.collectedAt = "2026-11-01T00:00:00Z";
    if (kind === "version") result.local.rulesVersion = "fake";
    if (kind === "evidence") result.local.findings[0].evidence[0].propertyPath = "/properties/password";
    if (kind === "id") result.id = ids.assessment;
    await expect(store.completeAssessment(a.id, result)).rejects.toThrow("저장소 요청에 실패했습니다.");
  }
  expect((await store.getAssessment(a.id))?.status).toBe("pending");
  await store.completeAssessment(a.id, valid);
  await db.query("update assessments set result=jsonb_set(result,'{local,findings,0,ruleId}', '\"fake-rule\"') where id=$1", [a.id]);
  await expect(store.getAssessment(a.id)).rejects.toThrow("저장소 요청에 실패했습니다.");
  await expect(store.listAssessments(input.workspaceId)).rejects.toThrow("저장소 요청에 실패했습니다.");
});

it("validates Advisor catalog mapping and signed actual-cost attribution on write and read", async () => {
  await db.query("update scans set source='live' where id=$1", [input.sourceScanId]);
  const a = (await store.reserveAssessment(input))!; const result = await resultFor(a.id);
  const entry = advisorCatalog.entries.find(e => e.resourceTypes.includes("microsoft.web/sites"))!;
  const resourceId = completeSnapshot.inventory.resources.find(r => r.type === "microsoft.web/sites")!.id;
  result.advisor = { state: "available", data: { schemaVersion: 1, retrievedAt: result.local.evaluatedAt,
    mappingVersion: advisorCatalog.version, coverage: { total: 1, included: 1, excluded: 0, reasons: [] },
    recommendations: [{ recommendationId: `/subscriptions/${ids.subscription}/providers/microsoft.advisor/recommendations/sample`,
      recommendationTypeId: entry.recommendationTypeId, ruleId: entry.ruleId, actionId: entry.actionId, resourceId }] } };
  result.actualCost.monthToDate = { state: "available", data: { schemaVersion: 1, retrievedAt: result.local.evaluatedAt,
    period: { from: "2026-11-01T00:00:00Z", to: result.local.evaluatedAt, preset: "month-to-date" },
    scope: { kind: "subscriptions", requestedSubscriptionIds: [ids.subscription], availableSubscriptionIds: [ids.subscription], paginationComplete: true },
    rows: [{ subscriptionId: ids.subscription, currency: "USD", amount: -10, attribution: { kind: "resource", resourceId } },
      { subscriptionId: ids.subscription, currency: "CAD", amount: 0, attribution: { kind: "unattributed", resourceId: null, reason: "missing-resource-id" } }],
    totals: [{ currency: "USD", amount: -10, subscriptionIds: [ids.subscription] }, { currency: "CAD", amount: 0, subscriptionIds: [ids.subscription] }] } };
  const badAdvisor = structuredClone(result); if ("data" in badAdvisor.advisor) badAdvisor.advisor.data.recommendations[0].actionId = "advisor-action-fake";
  await expect(store.completeAssessment(a.id, badAdvisor)).rejects.toThrow();
  const badCost = structuredClone(result); if ("data" in badCost.actualCost.monthToDate) badCost.actualCost.monthToDate.data.rows[0].attribution.resourceId = resourceId + "-missing";
  await expect(store.completeAssessment(a.id, badCost)).rejects.toThrow();
  const badScope = structuredClone(result); if ("data" in badScope.actualCost.monthToDate) badScope.actualCost.monthToDate.data.scope.requestedSubscriptionIds.push(ids.otherSubscription);
  await expect(store.completeAssessment(a.id, badScope)).rejects.toThrow();
  expect(await store.completeAssessment(a.id, result)).toBe(true);
  expect((await store.getAssessment(a.id))?.result).toEqual(result);
  await db.query("update assessments set result=jsonb_set(result,'{advisor,data,recommendations,0,resourceId}',to_jsonb($2::text)) where id=$1", [a.id, resourceIds.storage]);
  await expect(store.getAssessment(a.id)).rejects.toThrow();
});

it("preserves local success with independently pending, failed and retried roadmap metadata", async () => {
  const a = (await store.reserveAssessment(input))!; await store.completeAssessment(a.id, await resultFor(a.id));
  const local = (await store.getAssessment(a.id))!.result;
  const { rows } = await db.query<{ attempt_id: string }>("select * from reserve_assessment_roadmap($1, now()-interval '10 minutes')", [a.id]);
  expect(await store.getAssessment(a.id)).toMatchObject({ result: local, roadmap: { status: "pending", attemptId: rows[0].attempt_id, content: null } });
  const usage = { promptTokens: 1, completionTokens: 2, costUsd: null };
  await db.query("update assessments set roadmap_status='failed',roadmap_error=$2,roadmap_completed_at=now(),roadmap_usage=$3 where id=$1",
    [a.id, { schemaVersion: 1, code: "timeout" }, usage]);
  expect(await store.getAssessment(a.id)).toMatchObject({ status: "succeeded", result: local, roadmap: { status: "failed", usage, content: null } });
  await db.query("select * from reserve_assessment_roadmap($1, now()-interval '10 minutes')", [a.id]);
  const reopened = (await store.getAssessment(a.id))!;
  expect(reopened.roadmap.attemptId).not.toBe(rows[0].attempt_id);
  expect(reopened).toMatchObject({ result: local, roadmap: { status: "pending", usage, content: null } });
});

it("rejects invalid IDs cheaply, constrains limits and hides provider errors from exceptions and logs", async () => {
  const dependency = vi.fn(); const empty = createAssessmentsDb({ db: dependency });
  expect(await empty.getAssessment("bad")).toBeNull(); expect(await empty.listAssessments("bad")).toEqual([]);
  expect(await empty.completeAssessment("bad", {})).toBe(false); expect(await empty.failAssessment("bad", "internal")).toBe(false);
  expect(dependency).not.toHaveBeenCalled();
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  dependency.mockRejectedValue(Error("private-provider-error"));
  await expect(empty.getAssessment(ids.assessment)).rejects.toThrow("저장소 요청에 실패했습니다.");
  expect(JSON.stringify(spy.mock.calls)).not.toContain("private-provider-error");
  await expect(store.listAssessments(input.workspaceId, { limit: -1 })).rejects.toThrow("저장소 요청에 실패했습니다.");
});

it("provides the one saved snapshot reader for reservation and jobs", async () => {
  const snapshot=await store.loadSnapshot(input.sourceScanId);
  expect(snapshot).toEqual({scan:await scans.getScan(input.sourceScanId),inventory:await scans.getScanInventory(input.sourceScanId)});
  expect(await store.loadSnapshot("bad")).toBeNull();
  expect(await store.loadSnapshot(ids.oldScan)).toBeNull();
});

it("reopens sealed Assess history without rerunning today's rules and preserves its catalog", async () => {
  const id=(await store.reserveAssessment(input))!.id;
  const result=await resultFor(id);
  await store.completeAssessment(id,result);
  const replay=vi.spyOn(rulesEngine,"evaluateAssessmentRules").mockImplementation(()=>{throw Error("new rule engine");});
  expect((await store.getAssessment(id))!.result).toEqual(result);
  expect(replay).not.toHaveBeenCalled();
  expect((await store.getAssessmentCatalogData(id))!.rules.version).toBe(result.local.rulesVersion);
});
