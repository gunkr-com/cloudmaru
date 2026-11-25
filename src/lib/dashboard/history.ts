import { resolveAnalysisStatus } from "@/lib/analysis/analysis-job";
import { AVAILABILITY_OPTIONS, EXPECTED_USERS_OPTIONS } from "@/lib/analysis/input-schema";
import type { Locale } from "@/types/i18n";
import { SUPPORTED_REGIONS } from "@/lib/workspace/regions";
import { createTranslator, pickText } from "@/i18n/translate";
import { formatMonthlyMoney } from "@/i18n/format";
import { buildResultHref, buildRerunHref } from "@/lib/dashboard/result-links";
import type { AnalysisListItem } from "@/types/db";
import type { Tier } from "@/types/catalog";

export type HistoryRow = {
  id: string;
  href: string;
  rerunHref: string;
  title: string;
  createdAt: string;
  status: "pending" | "succeeded" | "failed";
  statusLabel: string | null;
  recommended: { tier: Tier; tierLabel: string; monthlyLabel: string } | null;
  conditionSummary: string;
};

export function toHistoryRow(item: AnalysisListItem, now: Date, locale: Locale): HistoryRow {
  const t = createTranslator(locale);
  const resolved = resolveAnalysisStatus({ status: item.status, createdAt: item.createdAt, errorStage: null }, now);
  const status = resolved.status;
  const expectedUsersLabel = EXPECTED_USERS_OPTIONS.find(({ value }) => value === item.input.expectedUsers)?.labelKey;
  const availabilityLabel = AVAILABILITY_OPTIONS.find(({ value }) => value === item.input.availability)?.labelKey;
  const recommended = status === "succeeded" && item.recommendedTier && item.recommendedMonthly !== null
    ? { tier: item.recommendedTier, tierLabel: t(`common.tiers.${item.recommendedTier}`), monthlyLabel: formatMonthlyMoney(item.recommendedMonthly, "CAD", locale) }
    : null;

  return {
    id: item.id,
    href: buildResultHref(item.id),
    rerunHref: buildRerunHref(item.id),
    title: status === "pending" ? t("analysis.pendingRequest") : status === "failed" ? t("analysis.failedRequest") : (item.requestTitle && pickText(item.requestTitle, locale).trim()) || t("analysis.resultTitle"),
    createdAt: item.createdAt,
    status,
    statusLabel: status === "pending" ? t("analysis.pendingTitle") : status === "failed" ? t("analysis.failedStatus") : null,
    recommended,
    conditionSummary: t("analysis.conditionSummary", { users: expectedUsersLabel ? t(expectedUsersLabel) : "", budget: formatMonthlyMoney(item.input.monthlyBudget, "CAD", locale), availability: availabilityLabel ? t(availabilityLabel) : "", region: SUPPORTED_REGIONS.find(region => region.id === item.input.region)?.label ?? item.input.region }),
  };
}
