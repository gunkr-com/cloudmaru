import { expect, it } from "vitest";
import { evaluateAssessmentRules } from "@/lib/assessment/rules/engine";
import { roadmapFixture } from "@/lib/assessment/roadmap/fixtures.test-data";
import { firstIssuesSummary } from "./first-summary";

it("reads scan time, automatic check count, verdict states and resources with no applicable rule from the saved result", () => {
  const { parent, resources } = roadmapFixture();
  const extra = { ...structuredClone(resources[0]), id: resources[0].id.replace(/microsoft\.web\/sites\/[^/]+$/i, "microsoft.web/serverfarms/plan"), name: "plan", type: "microsoft.web/serverfarms" };
  const local = evaluateAssessmentRules([...resources, extra], "2026-11-12T10:00:00Z");
  const summary = firstIssuesSummary({ ...parent, local });
  expect(summary).toMatchObject({
    collectedAt: parent.sourceScan.collectedAt, source: parent.sourceScan.source, evaluatedAt: "2026-11-12T10:00:00Z",
    automaticChecks: local.findings.length,
    resources: { total: 41, checked: 40, noApplicableRule: 1, invalid: 0 },
  });
  const count = (verdict: string) => local.findings.filter(finding => finding.verdict === verdict).length;
  expect(summary.verdicts).toEqual({ violation: count("violation"), unknown: count("unknown"), pass: count("pass") });
  expect(summary.verdicts.violation).toBeGreaterThan(0);
  expect(summary.verdicts.unknown).toBeGreaterThan(0);
  expect(summary.actualCost).toEqual({ state: "not-requested", reason: null });
});

it("keeps unavailable actual billing distinct from a zero amount", () => {
  const { parent } = roadmapFixture();
  expect(firstIssuesSummary({ ...parent, actualCost: { schemaVersion: 1,
    monthToDate: { state: "unavailable", reason: "not-supported" }, trailing30Days: { state: "unavailable", reason: "not-supported" } } }).actualCost)
    .toEqual({ state: "unavailable", reason: "not-supported" });
});
