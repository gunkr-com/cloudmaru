import { expect, it } from "vitest";
import { assessment } from "@/lib/completion/fixtures.test-data";
import { currentAssessmentCatalogData } from "@/lib/assessment/app/saved-evidence";
import { validateStoredRoadmap } from "./storage-validation";

const catalogData = currentAssessmentCatalogData();
const rule = catalogData.rules.rules[0];
const parent = structuredClone(assessment);
parent.local.findings[0] = { ...parent.local.findings[0], ruleId: rule.id, ruleVersion: rule.version,
  pillar: rule.pillar, severity: rule.severity };
const createdAt = "2026-11-12T10:00:00Z", completedAt = "2026-11-12T10:01:00Z";
const binding = { assessment: parent, catalogData, createdAt, completedAt };
const content = { schemaVersion: 1, generatedAt: completedAt, summary: { en: "Review the saved findings.", ko: "저장된 점검을 검토합니다." },
  phases: [{ id: "first", title: { en: "First actions", ko: "우선 조치" }, findingIds: [parent.local.findings[0].id], actions: [rule.remediation] }] };
it("accepts only saved finding references and pinned rule remediation without mutating the local result", () => {
  const before = structuredClone(parent);
  expect(validateStoredRoadmap(content, binding)).toEqual(content);
  expect(parent).toEqual(before);
});
it.each(["finding", "action", "language-pair", "time-before", "time-after", "rule-version", "extra", "url"])("rejects %s tampering", kind => {
  const raw = structuredClone(content), bound = structuredClone(binding);
  if (kind === "finding") raw.phases[0].findingIds[0] = "00000000-0000-4000-8000-000000000000";
  if (kind === "action") raw.phases[0].actions[0] = { en: "Delete everything", ko: "모두 삭제합니다." };
  if (kind === "language-pair") raw.phases[0].actions[0].ko = "다른 조치입니다.";
  if (kind === "time-before") raw.generatedAt = "2026-11-12T09:59:00Z";
  if (kind === "time-after") raw.generatedAt = "2026-11-12T10:02:00Z";
  if (kind === "rule-version") bound.assessment.local.findings[0].ruleVersion = "9.9.9";
  if (kind === "extra") Object.assign(raw, { cost: 0 });
  if (kind === "url") raw.summary.en = "https://example.com";
  expect(() => validateStoredRoadmap(raw, bound)).toThrow("assessment-roadmap-invalid");
});
