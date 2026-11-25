import { readStoredText } from "@/lib/llm/localized-text";
import { localizedTextSchema } from "@/lib/catalog/schema";
import type { AnalysisResult } from "@/types/analysis";
import type { Tier } from "@/types/catalog";

const TIERS: readonly Tier[] = ["low", "balanced", "ha"];

export type EvalResultFile = { runId: string; scenarioId: string; record: unknown };
export type EvalResultEntry = { scenarioId: string; runId: string; result: AnalysisResult };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasThreeTiers(result: Record<string, unknown>): boolean {
  const { plans, recommendedTier } = result;
  if (!Array.isArray(plans) || plans.length !== TIERS.length) return false;
  const tiers = new Set(plans.map((plan) => (isObject(plan) ? plan.tier : undefined)));
  return TIERS.every((tier) => tiers.has(tier)) && TIERS.includes(recommendedTier as Tier);
}

// M2 이전의 카탈로그·다이어그램 단일 문자열 결과는 미리보기에서 건너뛴다.
function hasLocalizedCatalog(result: Record<string, unknown>): boolean {
  const localized = (value: unknown) => localizedTextSchema.safeParse(value).success;
  return Array.isArray(result.plans) && result.plans.every(plan => {
    if (!isObject(plan) || !localized(plan.mermaid) || !isObject(plan.referenceArchitecture)
      || !localized(plan.referenceArchitecture.name) || !Array.isArray(plan.services)
      || !isObject(plan.cost) || !Array.isArray(plan.cost.lines)) return false;
    return plan.services.every(service => isObject(service) && localized(service.name) && localized(service.unitLabel))
      && plan.cost.lines.every(line => isObject(line) && localized(line.name) && localized(line.unitLabel)
        && (line.assumptionLabel === null || localized(line.assumptionLabel)) && typeof line.hourly === "boolean");
  });
}

/**
 * `npm run evals`가 저장한 기록(evals/results/<실행 시각>/<id>.json)에서 화면에 보여 줄 분석 결과를 꺼낸다.
 * 결과는 저장 전에 buildAnalysisResult로 검증된 것이므로 여기서는 실제 모델 실행·성공·시나리오 일치·세 안 구성만 확인한다.
 */
export function extractEvalResult(record: unknown, scenarioId: string): AnalysisResult | null {
  if (!isObject(record) || record.dryRun !== false) return null;
  if (!isObject(record.scenario) || record.scenario.id !== scenarioId) return null;
  if (!isObject(record.outcome) || record.outcome.ok !== true) return null;
  const { result } = record.outcome;
  if (!isObject(result) || !hasThreeTiers(result) || !hasLocalizedCatalog(result)) return null;
  const requestTitle = readStoredText(result.requestTitle);
  const recommendationReason = readStoredText(result.recommendationReason);
  if (!requestTitle || !recommendationReason || !Array.isArray(result.plans)) return null;
  const plans = [];
  for (const plan of result.plans) {
    if (!isObject(plan) || !Array.isArray(plan.pros)) return null;
    const title = readStoredText(plan.title);
    const pros = plan.pros.map(readStoredText);
    if (!title || pros.some(pro => pro === null)) return null;
    plans.push({ ...plan, title, pros });
  }
  return { ...result, requestTitle, recommendationReason, plans } as AnalysisResult;
}

/** 시나리오마다 가장 최근 실행의 유효한 결과를 고른다. 실행 ID는 시각 문자열이라 사전순이 곧 시간순이다. */
export function latestEvalResults(files: EvalResultFile[]): EvalResultEntry[] {
  const latest = new Map<string, EvalResultEntry>();
  const newestFirst = [...files].sort((a, b) => b.runId.localeCompare(a.runId));
  for (const { runId, scenarioId, record } of newestFirst) {
    if (latest.has(scenarioId)) continue;
    const result = extractEvalResult(record, scenarioId);
    if (result) latest.set(scenarioId, { scenarioId, runId, result });
  }
  return [...latest.values()].sort((a, b) => a.scenarioId.localeCompare(b.scenarioId));
}
