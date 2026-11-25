import "server-only";
import { z } from "zod";
import { toCompletionSourceScan } from "@/lib/completion/source-scan";
import type { AdvisorResult, ActualCostWindows } from "@/types/assessment";
import type { ComponentResult } from "@/types/completion";
import type { ScanInventory, ScanRecord } from "@/types/scan";
import { collectAdvisorRecommendations, type AdvisorCollection } from "./advisor";
import { collectActualCosts, type ActualCostCollection } from "./cost-management";
import { AzureRequestError, type AzureRequestDeps } from "./request";

export type AssessmentInsightsInput = {
  scan: ScanRecord;
  inventory: ScanInventory;
  requested: { advisor: boolean; actualCost: boolean };
  retrievedAt?: string;
};
// 저장된 소유 회사의 연결로 서버가 만든 transport만 받는다. null은 연결 미설정이다.
export type AssessmentInsightsDeps = AzureRequestDeps & { maxPages?: number; maxRows?: number };
export type AssessmentInsights = {
  advisor: ComponentResult<AdvisorResult>;
  actualCost: ActualCostWindows;
  collection: {
    retrievedAt: string;
    advisorScope: AdvisorCollection["scope"] | null;
    costScopes: ActualCostCollection["scopes"] | null;
  };
};

/** phase16은 저장 스캔/회사 소속을 먼저 확인한다. 로컬 판정에는 접근하지 않는다. */
export async function collectAssessmentInsights(
  input: AssessmentInsightsInput,
  deps: AssessmentInsightsDeps | null,
): Promise<AssessmentInsights> {
  const retrievedAt = input.retrievedAt ?? new Date().toISOString();
  let source;
  try {
    source = toCompletionSourceScan(input.scan, input.inventory);
    if (source.completeness.reasons.some(reason => reason === "invalid-data")
      || !z.iso.datetime({ offset: true }).safeParse(retrievedAt).success
      || Date.parse(retrievedAt) < Date.parse(source.collectedAt)
      || typeof input.requested.advisor !== "boolean" || typeof input.requested.actualCost !== "boolean"
      || (deps && [deps.maxPages, deps.maxRows].some(limit => limit !== undefined && (!Number.isSafeInteger(limit) || limit <= 0)))) {
      throw new Error();
    }
  } catch {
    throw new AzureRequestError("disallowed");
  }
  const unavailable = source.source === "import" ? "not-supported" : deps === null ? "not-configured" : null;
  const skipped = (requested: boolean): ComponentResult<never> => !requested
    ? { state: "not-requested" } : unavailable
      ? { state: "unavailable", reason: unavailable } : { state: "failed", reason: "internal" };
  const args = { subscriptionIds: source.subscriptionIds, resourceIds: input.inventory.resources.map(resource => resource.id), retrievedAt };
  // 서로의 거절/실패가 성공 자료를 버리지 않게 수집한다. 원본 오류는 반환/로그에 넣지 않는다.
  const [advisor, cost] = await Promise.allSettled([
    input.requested.advisor && !unavailable && deps ? collectAdvisorRecommendations(args, deps) : Promise.resolve(null),
    input.requested.actualCost && !unavailable && deps ? collectActualCosts(args, deps) : Promise.resolve(null),
  ]);
  const failure = { state: "failed", reason: "internal" } as const;
  const advisorData = advisor.status === "fulfilled" ? advisor.value : null;
  const costData = cost.status === "fulfilled" ? cost.value : null;
  const costState = cost.status === "rejected" ? failure : skipped(input.requested.actualCost);
  return {
    advisor: advisor.status === "rejected" ? failure : advisorData?.advisor ?? skipped(input.requested.advisor),
    actualCost: costData?.actualCost ?? { schemaVersion: 1, monthToDate: costState, trailing30Days: costState },
    collection: { retrievedAt, advisorScope: advisorData?.scope ?? null, costScopes: costData?.scopes ?? null },
  };
}
