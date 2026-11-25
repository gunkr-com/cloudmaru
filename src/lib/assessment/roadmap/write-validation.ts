import "server-only";
import { isDeepStrictEqual } from "node:util";
import { buildRoadmapContext, readRoadmapBinding } from "./context";
import { validateRoadmapOutput } from "./model";
import { AssessmentRoadmapValidationError, validateStoredRoadmap, type RoadmapStorageBinding } from "./storage-validation";
import type { AssessmentRoadmap } from "@/types/assessment";

export const ROADMAP_WRITE_POLICY_VERSION = "assessment-roadmap-v3";

/** 새 성공 쓰기 전용이다. 저장 부모/당시 카탈로그만으로 전체 의미를 확인한다.
 * 별칭 변환은 로컬 검증 입력일 뿐 모델 호출이 아니다. 재열기에는 적용하지 않는다.
 */
export function validateRoadmapForWrite(raw: unknown, binding: RoadmapStorageBinding): AssessmentRoadmap {
  try {
    const content = validateStoredRoadmap(raw, binding);
    const context = buildRoadmapContext(binding.assessment, binding.catalogData);
    const privateBinding = readRoadmapBinding(context);
    const aliases = new Map(Object.entries(privateBinding.findingIds).map(([alias, id]) => [id, alias]));
    const output = { summary: content.summary, phases: content.phases.map(phase => {
      const findingAliases = phase.findingIds.map(id => {
        const alias = aliases.get(id);
        if (!alias) throw new Error(); // pass/해당 부모 밖 finding은 eligible alias가 없다.
        return alias;
      });
      const actions = context.payload.actions.filter(action => action.findingAliases.some(alias => findingAliases.includes(alias)));
      if (actions.length !== phase.actions.length || actions.some(action =>
        !phase.actions.some(value => isDeepStrictEqual(value, action.meaning.remediation)))) throw new Error();
      return { title: phase.title, findingAliases, actionAliases: actions.map(action => action.alias) };
    }) };
    // 모델 입구와 같은 strict prose·전체 포함·그룹/조치 결합·중복 정책을 사용한다.
    if (!validateRoadmapOutput(output, context, content.generatedAt).ok) throw new Error();
    // 저장된 phase ID/배열 순서 등 호출자의 유효한 표현은 그대로 보존한다.
    return content;
  } catch { throw new AssessmentRoadmapValidationError(); }
}
