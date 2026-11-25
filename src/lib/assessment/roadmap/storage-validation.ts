import { isDeepStrictEqual } from "node:util";
import { roadmapSchema } from "@/lib/completion/schema";
import type { AssessmentCatalogData, AssessmentResult, AssessmentRoadmap } from "@/types/assessment";

export const ROADMAP_STORAGE_POLICY_VERSION = "assessment-roadmap-v1";
export type RoadmapStorageBinding = {
  assessment: AssessmentResult;
  catalogData: AssessmentCatalogData;
  createdAt: string;
  completedAt: string;
};
export class AssessmentRoadmapValidationError extends Error {
  constructor() { super("assessment-roadmap-invalid"); this.name = "AssessmentRoadmapValidationError"; }
}
/** 호출자가 검증된 불변 저장 결과와 당시 카탈로그를 제공한다. 모델 메타데이터는 받지 않는다. */
export function validateStoredRoadmap(raw: unknown, binding: RoadmapStorageBinding): AssessmentRoadmap {
  try {
    const content = roadmapSchema.parse(raw);
    const start = Date.parse(binding.createdAt), end = Date.parse(binding.completedAt), generated = Date.parse(content.generatedAt);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || generated < start || generated > end
      || start < Date.parse(binding.assessment.local.evaluatedAt)) throw new Error();
    const findings = new Map(binding.assessment.local.findings.map(f => [f.id, f]));
    const rules = new Map(binding.catalogData.rules.rules.map(rule => [rule.id as string, rule]));
    for (const phase of content.phases) {
      const allowed = phase.findingIds.map(id => {
        const finding = findings.get(id), rule = finding && rules.get(finding.ruleId);
        if (!finding || !rule || rule.version !== finding.ruleVersion || rule.pillar !== finding.pillar
          || rule.severity !== finding.severity) throw new Error();
        return rule.remediation;
      });
      if (phase.actions.some((action, index) => !allowed.some(remediation => isDeepStrictEqual(remediation, action))
        || phase.actions.slice(0, index).some(other => isDeepStrictEqual(other, action)))) throw new Error();
    }
    return content;
  } catch { throw new AssessmentRoadmapValidationError(); }
}
