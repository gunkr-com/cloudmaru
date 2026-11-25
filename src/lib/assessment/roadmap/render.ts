import "server-only";
import { isDeepStrictEqual } from "node:util";
import type { AssessmentRoadmap, CodeFinding } from "@/types/assessment";
import type { LocalizedText } from "@/types/i18n";
import { validateStoredRoadmap, type RoadmapStorageBinding } from "./storage-validation";

/** 보고서/화면용 결정론적 DTO. 원본 inventory·비밀 근거·private 별칭 맵은 포함하지 않는다. */
export type RoadmapRenderData = {
  assessmentId: string; workspaceId: string; sourceScanId: string;
  generatedAt: string; summary: LocalizedText;
  phases: { id: string; title: LocalizedText;
    findings: { id: string; resourceId: string; ruleId: string; title: LocalizedText;
      verdict: CodeFinding["verdict"]; severity: CodeFinding["severity"]; pillar: CodeFinding["pillar"] }[];
    actions: { ruleId: string; text: LocalizedText; sources: string[] }[];
  }[];
};
/** 호출자는 proof를 검증한 저장 reader와 당시 카탈로그를 사용한다.
 * 현재 모델 정책/판정 엔진/링크 조회를 실행하거나 원본 판정을 재계산하지 않는다.
 */
export function buildRoadmapRenderData(raw: AssessmentRoadmap, binding: RoadmapStorageBinding): RoadmapRenderData {
  const roadmap = validateStoredRoadmap(raw, binding);
  const findings = new Map(binding.assessment.local.findings.map(f => [f.id, f]));
  const rules = new Map(binding.catalogData.rules.rules.map(r => [r.id as string, r]));
  return structuredClone({ assessmentId: binding.assessment.id, workspaceId: binding.assessment.workspaceId,
    sourceScanId: binding.assessment.sourceScanId, generatedAt: roadmap.generatedAt, summary: roadmap.summary,
    phases: roadmap.phases.map(phase => {
      const selected = [...phase.findingIds].sort().map(id => findings.get(id)!);
      const ruleIds = [...new Set(selected.map(f => f.ruleId))].sort();
      return { id: phase.id, title: phase.title,
        findings: selected.map(f => ({ id: f.id, resourceId: f.resourceId, ruleId: f.ruleId, title: rules.get(f.ruleId)!.title,
          verdict: f.verdict, severity: f.severity, pillar: f.pillar })),
        actions: ruleIds.filter(id => phase.actions.some(a => isDeepStrictEqual(a, rules.get(id)!.remediation)))
          .map(id => ({ ruleId: id, text: rules.get(id)!.remediation, sources: rules.get(id)!.sources })),
      };
    }),
  });
}
