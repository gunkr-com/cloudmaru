import { createTranslator, pickText } from "@/i18n/translate";
import type { Locale } from "@/types/i18n";
import { resolveAnalysisStatus } from "@/lib/analysis/analysis-job";
import type { AnalysisRecord } from "@/types/db";

// 문서 제목(<title>). Next의 경로 알림(route announcer)은 문서 제목이 바뀔 때만 화면 낭독기에 읽어 주므로
// 화면마다 다른 제목을 준다(WCAG 2.4.2).
export const SITE_NAME = createTranslator("en")("common.siteName");

export function withSiteName(title: string): string {
  return `${title} · ${SITE_NAME}`;
}

export const ANALYSIS_HISTORY_PAGE_TITLE = withSiteName(createTranslator("en")("shell.titles.history"));
export const NOT_FOUND_PAGE_TITLE = withSiteName(createTranslator("en")("shell.titles.notFound"));
export const ANALYSIS_NOT_FOUND_PAGE_TITLE = withSiteName(createTranslator("en")("shell.titles.analysisNotFound"));

// 화면 제목(h1)과 같은 조건으로 고른다: 원래 분석을 실제로 불러왔을 때만 다시 분석이다.
export function buildNewAnalysisPageTitle({ rerun }: { rerun: boolean }, locale: Locale = "en"): string {
  return withSiteName(createTranslator(locale)(rerun ? "shell.titles.rerun" : "shell.titles.newAnalysis"));
}

export type AnalysisTitleSource = Pick<AnalysisRecord, "status" | "createdAt" | "errorStage" | "result">;

// 결과 페이지와 같은 순서로 판정한다: 없음 → 분석 중 → 실패(제한 시간 초과·결과 없음 포함) → 결과.
// 요청 제목은 모델 출력 검증에서 언어별 한도 이하로 제한되므로 따로 자르지 않는다.
export function buildAnalysisPageTitle(record: AnalysisTitleSource | null, now: Date, locale: Locale = "en"): string {
  const t = createTranslator(locale);
  if (!record) return withSiteName(t("shell.titles.analysisNotFound"));
  const { status } = resolveAnalysisStatus(record, now);
  if (status === "pending") return withSiteName(t("shell.titles.pending"));
  if (status === "failed" || !record.result) return withSiteName(t("shell.titles.failed"));
  return withSiteName(pickText(record.result.requestTitle, locale).trim() || t("shell.titles.result"));
}
