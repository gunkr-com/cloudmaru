import "server-only";
import type { StructuredLlm } from "@/types/analysis";
import type { CompletionClaudeSource } from "./workspace-claude";
import type { PGlite } from "@electric-sql/pglite";
import { createRoadmapJobs } from "@/lib/assessment/roadmap/job";
import { createAssessmentRoadmapsDb } from "./db/assessment-roadmaps";
import { getDb } from "./db/client";
import { hasCompletionClaudeKey, requestCompletionStructuredOutput } from "./workspace-claude";

export function createAssessmentRoadmapServices(deps: {
  db: () => Promise<PGlite>;
  hasCompletionClaudeKey?: typeof hasCompletionClaudeKey;
  requestCompletionStructuredOutput?: (source: CompletionClaudeSource, request: Parameters<StructuredLlm>[0]) => ReturnType<StructuredLlm>;
  now?: () => Date;
}) {
  return createRoadmapJobs({
    ...createAssessmentRoadmapsDb({ db: deps.db }), now: deps.now ?? (() => new Date()),
    hasKey: id => (deps.hasCompletionClaudeKey ?? hasCompletionClaudeKey)({ source: "assessment-roadmap", sourceId: id }),
    // 실제 호출과 검증 재시도마다 저장 소유 회사 키를 다시 읽는 공통 래퍼만 사용한다.
    request: (id, request) => (deps.requestCompletionStructuredOutput ?? requestCompletionStructuredOutput)(
      { source: "assessment-roadmap", sourceId: id }, request),
  });
}
// import/build 시 DB를 열지 않는다. after()는 라우트에서 주입한다.
export const roadmapJobs = createAssessmentRoadmapServices({ db: getDb });
