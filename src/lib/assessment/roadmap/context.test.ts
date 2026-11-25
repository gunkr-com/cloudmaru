import { expect, it } from "vitest";
import { buildRoadmapContext, readRoadmapBinding, RoadmapContextError } from "./context";
import { roadmapFixture } from "./fixtures.test-data";
import { completeSnapshot } from "@/lib/completion/fixtures.test-data";
import { evaluateAssessmentRules } from "@/lib/assessment/rules/engine";

it("includes every actual actionable finding beyond 35 and never projects raw inventory/evidence or private maps", () => {
  const { parent, catalogData } = roadmapFixture();
  parent.local.findings[0].evidence[0].observation = { state: "present", value: "SECRET-credential 10.40.1.0/24 private-name" };
  const before = structuredClone(parent), context = buildRoadmapContext(parent, catalogData);
  expect(context.state).toBe("ready");
  expect(context.payload.findings).toHaveLength(80);
  expect(context.payload.coverage).toEqual({ unit: "findings", total: 80, included: 80, excluded: 0, reasons: [] });
  expect(context.payload.actions).toHaveLength(2);
  const json = JSON.stringify(context);
  for (const value of ["SECRET", "private-name", "10.40", "/subscriptions/", "resourcegroups", parent.id, parent.sourceScanId,
    parent.workspaceId, parent.local.findings[0].id, "evidence", "propertyPath", "https://"]) expect(json).not.toContain(value);
  expect(Object.keys(context)).toEqual(["state", "payload"]);
  expect(Object.keys(context.payload.findings[0]).sort()).toEqual(["actionAlias", "alias", "ruleId", "severity", "type", "verdict"]);
  expect(parent).toEqual(before);
});
it("keeps finding/action aliases and payload stable when input and catalog arrays are reordered", () => {
  const { parent, catalogData } = roadmapFixture();
  const first = buildRoadmapContext(parent, catalogData);
  parent.local.findings.reverse(); catalogData.rules.rules.reverse();
  expect(buildRoadmapContext(parent, catalogData).payload).toEqual(first.payload);
});
it("accounts for pass findings separately and returns no-data with no fake Advisor action", () => {
  const { parent, catalogData } = roadmapFixture();
  parent.local.findings = parent.local.findings.map(f => ({ ...f, verdict: "pass", reasonCode: null,
    evidence: [{ resourceId: f.resourceId, propertyPath: "/properties/httpsOnly", observation: { state: "present", value: true } }] }));
  const mapping = catalogData.advisor.entries[0];
  parent.advisor = { state: "available", data: { schemaVersion: 1, retrievedAt: parent.local.evaluatedAt,
    mappingVersion: catalogData.advisor.version, coverage: { total: 1, included: 1, excluded: 0, reasons: [] },
    recommendations: [{ recommendationId: "advisor-observation", recommendationTypeId: mapping.recommendationTypeId,
      resourceId: parent.local.findings[0].resourceId, ruleId: mapping.ruleId, actionId: mapping.actionId }] } };
  const context = buildRoadmapContext(parent, catalogData);
  expect(context.state).toBe("no-data");
  expect(context.state === "no-data" && context.reason).toBe("no-data");
  expect(context.payload.coverage).toEqual({ unit: "findings", total: 80, included: 0, excluded: 80,
    reasons: [{ code: "pass-finding", count: 80 }] });
  expect(context.payload.findings).toEqual([]); expect(context.payload.actions).toEqual([]);
});
it("handles an empty local result without a paid request or inventory dump", () => {
  const { parent, catalogData } = roadmapFixture();
  parent.local = { ...parent.local, findings: [], coverage: { total: 40, included: 0, excluded: 40,
    reasons: [{ code: "no-applicable-rule", count: 40 }] } };
  expect(buildRoadmapContext(parent, catalogData)).toMatchObject({ state: "no-data", reason: "no-data",
    payload: { findings: [], coverage: { total: 0, included: 0, excluded: 0, reasons: [] } } });
});
it.each(["malformed", "unknown-rule", "duplicate", "metadata", "version", "type", "foreign-subscription", "catalog-extra"])("rejects %s input without bilingual data in errors", kind => {
  const { parent, catalogData } = roadmapFixture();
  if (kind === "malformed") parent.local.findings[0].id = "SECRET 비밀";
  if (kind === "unknown-rule") parent.local.findings[0].ruleId = "foreign-rule";
  if (kind === "duplicate") parent.local.findings.push(parent.local.findings[0]);
  if (kind === "metadata") parent.local.findings[0].severity = "critical";
  if (kind === "version") parent.local.rulesVersion = "other";
  if (kind === "type") parent.local.findings[0].resourceId = parent.local.findings[0].resourceId.replace("microsoft.web/sites", "microsoft.compute/virtualmachines");
  if (kind === "foreign-subscription") parent.sourceScan.subscriptionIds = ["00000000-0000-4000-8000-000000000999"];
  if (kind === "catalog-extra") Object.assign(catalogData.rules.rules[0], { credential: "SECRET 비밀" });
  expect(() => buildRoadmapContext(parent, catalogData)).toThrow(RoadmapContextError);
  expect(() => buildRoadmapContext(parent, catalogData)).toThrow(/^assessment-roadmap-context-invalid$/);
});
it("keeps a private immutable copy and rejects invented context handles", () => {
  const { parent, catalogData } = roadmapFixture();
  const context = buildRoadmapContext(parent, catalogData);
  const saved = readRoadmapBinding(context);
  parent.local.findings.reverse(); catalogData.rules.rules[0].remediation.en = "SECRET";
  expect(readRoadmapBinding(context)).toEqual(saved);
  saved.assessment.local.findings.length = 0;
  expect(readRoadmapBinding(context).assessment.local.findings).toHaveLength(80);
  expect(() => readRoadmapBinding(structuredClone(context))).toThrow(RoadmapContextError);
  expect(Object.isFrozen(context.payload.findings)).toBe(true);
});

it("projects the real mixed-type rule pack with pass exclusions without changing verdicts", () => {
  const { parent, catalogData } = roadmapFixture();
  parent.local = evaluateAssessmentRules(completeSnapshot.inventory.resources, parent.local.evaluatedAt);
  const context = buildRoadmapContext(parent, catalogData);
  expect(new Set(context.payload.findings.map(f => f.type)).size).toBeGreaterThan(2);
  expect(context.payload.coverage.total).toBe(parent.local.findings.length);
  expect(context.payload.coverage.included).toBe(parent.local.findings.filter(f => f.verdict !== "pass").length);
  expect(context.payload.coverage.excluded).toBe(parent.local.findings.filter(f => f.verdict === "pass").length);
});
