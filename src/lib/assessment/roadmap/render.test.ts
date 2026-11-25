import { expect, it } from "vitest";
import { roadmapFixture, roadmapModelFixture } from "./fixtures.test-data";
import { buildRoadmapContext } from "./context";
import { validateRoadmapOutput } from "./model";
import { buildRoadmapRenderData } from "./render";

function fixture() {
  const { parent, catalogData } = roadmapFixture();
  const context = buildRoadmapContext(parent, catalogData);
  const completedAt = "2026-11-12T10:01:00Z";
  const parsed = validateRoadmapOutput(roadmapModelFixture(context.payload), context, completedAt);
  if (!parsed.ok) throw new Error("fixture-invalid");
  return { content: parsed.value, binding: { assessment: parent, catalogData, createdAt: parent.local.evaluatedAt, completedAt } };
}
it("exports deterministic report data with saved provenance, original code verdicts and only pinned catalog prose/sources", () => {
  const { content, binding } = fixture();
  const before = structuredClone({ content, binding });
  const dto = buildRoadmapRenderData(content, binding);
  expect(dto).toEqual(buildRoadmapRenderData(structuredClone(content), structuredClone(binding)));
  expect(dto).toMatchObject({ assessmentId: binding.assessment.id, workspaceId: binding.assessment.workspaceId,
    sourceScanId: binding.assessment.sourceScanId, generatedAt: content.generatedAt, summary: content.summary });
  expect(dto.phases.flatMap(p => p.findings)).toHaveLength(80);
  for (const phase of dto.phases) {
    for (const finding of phase.findings) {
      const source = binding.assessment.local.findings.find(f => f.id === finding.id)!;
      const rule = binding.catalogData.rules.rules.find(r => r.id === source.ruleId)!;
      expect(finding).toEqual({ id: source.id, resourceId: source.resourceId, ruleId: source.ruleId,
        verdict: source.verdict, severity: source.severity, pillar: source.pillar, title: rule.title });
      expect(phase.actions).toContainEqual({ ruleId: rule.id, text: rule.remediation, sources: rule.sources });
    }
  }
  expect(JSON.stringify(dto)).not.toMatch(/propertyPath|evidence|observation|actualCost|advisor|findingAliases|actionAliases/);
  expect({ content, binding }).toEqual(before);
});
it("uses the saved catalog argument even if catalog prose differs from current files", () => {
  const { content, binding } = fixture();
  const rule = binding.catalogData.rules.rules.find(r => r.id === binding.assessment.local.findings.find(f => f.id === content.phases[0].findingIds[0])!.ruleId)!;
  const previous = rule.remediation;
  rule.title = { en: "Saved rule title", ko: "저장된 규칙 제목" };
  rule.remediation = { en: "Saved remediation", ko: "저장된 조치" };
  content.phases[0].actions = content.phases[0].actions.map(a => a.en === previous.en ? rule.remediation : a);
  const data = buildRoadmapRenderData(content, binding);
  expect(data.phases[0].findings[0].title).toEqual(rule.title);
  expect(data.phases[0].actions[0].text).toEqual(rule.remediation);
});
it.each(["foreign-finding", "arbitrary-action", "changed-catalog", "url"])("rejects %s instead of rendering unvalidated data", kind => {
  const { content, binding } = fixture();
  if (kind === "foreign-finding") content.phases[0].findingIds[0] = "00000000-0000-4000-8000-000000000999";
  if (kind === "arbitrary-action") content.phases[0].actions[0] = { en: "SECRET", ko: "비밀" };
  if (kind === "changed-catalog") binding.catalogData.rules.rules.length = 0;
  if (kind === "url") content.summary.en = "https://evil.example";
  expect(() => buildRoadmapRenderData(content, binding)).toThrow("assessment-roadmap-invalid");
});
