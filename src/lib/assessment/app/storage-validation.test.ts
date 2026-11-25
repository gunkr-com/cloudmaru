// @vitest-environment node
import { describe, expect, it } from "vitest";
import { completeSnapshot, ids, resourceIds } from "@/lib/completion/fixtures.test-data";
import { toCompletionSourceScan } from "@/lib/completion/source-scan";
import { evaluateAssessmentRules } from "@/lib/assessment/rules/engine";
import { compareScans } from "@/lib/inventory/diff";
import { summarizeInventory } from "@/lib/inventory/summarize";
import { advisorCatalog } from "@/lib/assessment/advisor-catalog";
import { parseAssessmentRow, validateAssessmentSources } from "./storage-validation";
import type { AssessmentInput, AssessmentSnapshot } from "./storage-validation";

function fixture() {
  const inventory = structuredClone(completeSnapshot.inventory);
  for (const row of inventory.resources) row.observedFields = ["tags", "zones", "managedBy", "sku", "properties", "location", "kind"];
  const source: AssessmentSnapshot = { scan: structuredClone(completeSnapshot.record), inventory };
  const previous = structuredClone(source);
  previous.scan.id = ids.oldScan;
  previous.scan.collectedAt = "2026-11-09T12:00:00.000Z";
  previous.inventory.resources = previous.inventory.resources.filter(r => r.id !== resourceIds.storage);
  const removed = structuredClone(previous.inventory.resources.find(r => r.id === resourceIds.vm)!);
  removed.id += "-old"; removed.name += "-old";
  previous.inventory.resources.push(removed);
  previous.scan.summary = summarizeInventory(previous.inventory.resources, previous.inventory.containers);
  const createdAt = "2026-11-11T12:00:00.000Z";
  const input: AssessmentInput = { schemaVersion: 1, workspaceId: ids.workspace, sourceScanId: ids.scan, previousScanId: ids.oldScan };
  const result = {
    schemaVersion: 1, id: ids.assessment, workspaceId: ids.workspace, sourceScanId: ids.scan,
    sourceScan: toCompletionSourceScan(source.scan, inventory), createdAt,
    local: evaluateAssessmentRules(inventory.resources, createdAt),
    advisor: { state: "unavailable", reason: "not-configured" },
    actualCost: { schemaVersion: 1, monthToDate: { state: "unavailable", reason: "not-configured" }, trailing30Days: { state: "unavailable", reason: "not-configured" } },
    diff: { state: "available", data: compareScans(previous, source, createdAt) }, roadmap: { state: "not-requested" },
  };
  const row = { id: ids.assessment, workspace_id: ids.workspace, source_scan_id: ids.scan, previous_scan_id: ids.oldScan,
    status: "succeeded", input, result, error: null, created_at: new Date(createdAt), completed_at: createdAt,
    roadmap_status: "not-requested", roadmap_attempt_id: null, roadmap_content: null, roadmap_error: null,
    roadmap_usage: null, roadmap_created_at: null, roadmap_completed_at: null };
  return { source, previous, row };
}

it("validates actual rule/diff output including baseline-only removed resources", () => {
  const f = fixture();
  expect(f.row.result.diff.data.changes.some(c => c.kind === "removed")).toBe(true);
  expect(parseAssessmentRow(f.row, f.source, f.previous)).toMatchObject({ status: "succeeded", result: f.row.result,
    previousScanId: ids.oldScan, roadmap: { status: "not-requested", content: null } });
});

it("rejects same, newer, equal-time, non-success and wrong-owner comparisons", () => {
  for (const mutate of [
    (f: ReturnType<typeof fixture>) => { f.previous.scan.id = ids.scan; },
    (f: ReturnType<typeof fixture>) => { f.previous.scan.collectedAt = "2026-11-12T12:00:00Z"; },
    (f: ReturnType<typeof fixture>) => { f.previous.scan.collectedAt = f.source.scan.collectedAt; },
    (f: ReturnType<typeof fixture>) => { f.previous.scan.status = "failed"; },
    (f: ReturnType<typeof fixture>) => { f.previous.scan.workspaceId = ids.otherWorkspace; },
  ]) {
    const f = fixture(); mutate(f);
    expect(() => validateAssessmentSources(f.row.input, f.source, f.previous)).toThrow("assessment-storage-invalid");
  }
});

describe("tampered stored results", () => {
  it.each(["rule", "version", "finding-id", "evidence", "verdict", "coverage", "source-header", "diff-header", "diff-resource", "diff-value", "input", "roadmap-base"])("rejects %s", kind => {
    const f = fixture(); const result = f.row.result;
    switch (kind) {
      case "rule": result.local.findings[0].ruleId = "invented-rule"; break;
      case "version": result.local.findings[0].ruleVersion = "999"; break;
      case "finding-id": result.local.findings[0].id = ids.network; break;
      case "evidence": result.local.findings[0].evidence[0].resourceId = resourceIds.vm + "-missing"; break;
      case "verdict": result.local.findings[0].verdict = result.local.findings[0].verdict === "pass" ? "violation" : "pass"; break;
      case "coverage": result.local.coverage.total++; result.local.coverage.excluded++; result.local.coverage.reasons[0].count++; break;
      case "source-header": result.sourceScan.collectedAt = "2026-11-10T11:00:00Z"; break;
      case "diff-header": result.diff.data.baselineScan.id = ids.network; break;
      case "diff-resource": result.diff.data.changes[0].resourceId += "-missing"; break;
      case "diff-value": result.diff.data.counts.changed++; break;
      case "input": f.row.input.previousScanId = ids.network; break;
      case "roadmap-base": result.roadmap.state = "pending"; break;
    }
    expect(() => parseAssessmentRow(f.row, f.source, f.previous)).toThrow("assessment-storage-invalid");
  });
});

it("checks exact Advisor GUID/rule/action/type/resource and mapping version", () => {
  for (const kind of ["valid", "guid", "rule", "action", "type", "resource", "version", "recommendation-id"]) {
    const f = fixture(); const entry = advisorCatalog.entries.find(e => e.resourceTypes.includes("microsoft.web/sites"))!;
    const rec = { recommendationId: `/subscriptions/${ids.subscription}/providers/microsoft.advisor/recommendations/sample`,
      recommendationTypeId: entry.recommendationTypeId, ruleId: entry.ruleId, actionId: entry.actionId,
      resourceId: f.source.inventory.resources.find(r => r.type === "microsoft.web/sites")!.id };
    const data = { schemaVersion: 1, retrievedAt: f.row.result.createdAt, mappingVersion: advisorCatalog.version,
      coverage: { total: 1, included: 1, excluded: 0, reasons: [] }, recommendations: [rec] };
    if (kind === "guid") rec.recommendationTypeId = ids.subscription;
    if (kind === "rule") rec.ruleId = "advisor-fake";
    if (kind === "action") rec.actionId = "advisor-action-fake";
    if (kind === "type") rec.resourceId = resourceIds.storage;
    if (kind === "resource") rec.resourceId += "-missing";
    if (kind === "version") data.mappingVersion = "invalid";
    if (kind === "recommendation-id") rec.recommendationId = "provider-private-error";
    const row = { ...f.row, result: { ...f.row.result, advisor: { state: "available", data } } };
    if (kind === "valid") expect(parseAssessmentRow(row, f.source, f.previous).result?.advisor.state).toBe("available");
    else expect(() => parseAssessmentRow(row, f.source, f.previous)).toThrow("assessment-storage-invalid");
  }
});

it("rejects malformed source metadata, empty inventory and mismatched saved headers", () => {
  for (const kind of ["empty-scope", "empty-inventory", "count", "identity", "missing-inventory", "owner"]) {
    const f = fixture();
    if (kind === "empty-scope") f.source.scan.subscriptionIds = [];
    if (kind === "empty-inventory") f.source.inventory.resources = [];
    if (kind === "count") f.source.scan.summary!.resourceCount++;
    if (kind === "identity") f.source.inventory.resources[0].type = "microsoft.fake/things";
    if (kind === "missing-inventory") Object.assign(f.source, { inventory: null });
    if (kind === "owner") f.source.scan.workspaceId = ids.otherWorkspace;
    expect(() => parseAssessmentRow(f.row, f.source, f.previous)).toThrow("assessment-storage-invalid");
  }
});

it("exposes separate pending/failed/stale roadmap metadata without altering local findings", () => {
  const f = fixture(); const usage = { promptTokens: 10, completionTokens: 20, costUsd: 0.1 };
  for (const status of ["pending", "failed", "succeeded"]) {
    const content = { schemaVersion: 1, generatedAt: f.row.result.createdAt, summary: { en: "Saved summary", ko: "저장 요약" },
      phases: [{ id: "first", title: { en: "First", ko: "먼저" }, findingIds: [f.row.result.local.findings[0].id], actions: [{ en: "Review", ko: "검토" }] }] };
    const row = { ...f.row, roadmap_status: status, roadmap_attempt_id: ids.network, roadmap_usage: usage,
      roadmap_created_at: f.row.result.createdAt, roadmap_completed_at: status === "pending" ? null : f.row.result.createdAt,
      roadmap_error: status === "failed" ? { schemaVersion: 1, code: "timeout" } : null,
      roadmap_content: status === "succeeded" ? content : null };
    const parsed = parseAssessmentRow(row, f.source, f.previous);
    expect(parsed.result).toEqual(f.row.result);
    expect(parsed.roadmap).toMatchObject({ status, attemptId: ids.network, usage, content: row.roadmap_content });
    if (status === "succeeded") {
      content.phases[0].findingIds = [ids.network];
      expect(() => parseAssessmentRow(row, f.source, f.previous)).toThrow("assessment-storage-invalid");
    }
  }
});

it("rejects malformed row states, usage, timestamps and unknown input flags", () => {
  const f = fixture();
  for (const patch of [{ id: "bad" }, { error: { schemaVersion: 1, code: "internal" } }, { completed_at: null },
    { created_at: "yesterday" }, { input: { ...f.row.input, advisor: false } },
    { roadmap_usage: { promptTokens: -1, completionTokens: 1, costUsd: null } },
    { roadmap_status: "pending", roadmap_attempt_id: ids.network, roadmap_created_at: f.row.result.createdAt, roadmap_content: {} },
  ]) expect(() => parseAssessmentRow({ ...f.row, ...patch }, f.source, f.previous)).toThrow("assessment-storage-invalid");
});
