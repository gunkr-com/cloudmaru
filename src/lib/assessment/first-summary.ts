import type { AssessmentResult } from "@/types/assessment";
import type { CompletionReasonCode, ComponentState, SourceScan } from "@/types/completion";

export type FirstIssuesSummary = {
  collectedAt: string;
  source: SourceScan["source"];
  evaluatedAt: string;
  /** 저장된 코드 판정 수(자원 × 적용 규칙). */
  automaticChecks: number;
  resources: { total: number; checked: number; noApplicableRule: number; invalid: number };
  verdicts: { violation: number; unknown: number; pass: number };
  /** 실제 청구는 Cost Management 저장 결과의 상태만 옮긴다. 금액을 만들거나 0으로 채우지 않는다. */
  actualCost: { state: ComponentState; reason: CompletionReasonCode | null };
};

/** 저장된 점검 결과에서 첫 요약에 필요한 값만 센다. 판정은 다시 하지 않는다. */
export function firstIssuesSummary(result: AssessmentResult): FirstIssuesSummary {
  const { coverage, findings } = result.local;
  const reason = (code: CompletionReasonCode) => coverage.reasons.find(item => item.code === code)?.count ?? 0;
  const verdicts = { violation: 0, unknown: 0, pass: 0 };
  for (const finding of findings) verdicts[finding.verdict] += 1;
  const cost = result.actualCost.monthToDate;
  return {
    collectedAt: result.sourceScan.collectedAt,
    source: result.sourceScan.source,
    evaluatedAt: result.local.evaluatedAt,
    automaticChecks: findings.length,
    resources: { total: coverage.total, checked: coverage.included, noApplicableRule: reason("no-applicable-rule"), invalid: reason("invalid-data") },
    verdicts,
    actualCost: { state: cost.state, reason: "reason" in cost ? cost.reason : null },
  };
}
