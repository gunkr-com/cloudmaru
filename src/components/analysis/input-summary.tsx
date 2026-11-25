"use client";
import type { JSX } from "react";
import { AVAILABILITY_OPTIONS, EXPECTED_USERS_OPTIONS } from "@/lib/analysis/input-schema";
import { useI18n } from "@/i18n/provider";
import { SUPPORTED_REGIONS } from "@/lib/workspace/regions";
import { formatMonthlyMoney } from "@/i18n/format";
import type { AnalysisInput } from "@/types/analysis";

export type InputSummaryProps = { input: AnalysisInput };

export function InputSummary({ input }: InputSummaryProps): JSX.Element {
  const { locale, t } = useI18n();
  const expectedUsersLabel = EXPECTED_USERS_OPTIONS.find((option) => option.value === input.expectedUsers)?.labelKey;
  const availabilityLabel = AVAILABILITY_OPTIONS.find((option) => option.value === input.availability)?.labelKey;

  return (
    <section aria-labelledby="input-summary-title" className="space-y-3">
      <h2 id="input-summary-title" className="text-xs font-semibold tracking-[0.6px] text-subtle">{t("analysis.submittedRequirements")}</h2>
      <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
        <div className="space-y-1 sm:col-span-2">
          <dt className="text-[13px] text-subtle">{t("analysis.requirementsLabel")}</dt>
          <dd className="whitespace-pre-wrap break-words text-body">{input.description}</dd>
        </div>
        <div className="space-y-1">
          <dt className="text-[13px] text-subtle">{t("analysis.usersLabel")}</dt>
          <dd className="text-body">{expectedUsersLabel ? t(expectedUsersLabel) : input.expectedUsers}</dd>
        </div>
        <div className="space-y-1">
          <dt className="text-[13px] text-subtle">{t("analysis.budgetLabel")}</dt>
          <dd className="tabular-nums text-body">{formatMonthlyMoney(input.monthlyBudget, "CAD", locale)}</dd>
        </div>
        <div className="space-y-1">
          <dt className="text-[13px] text-subtle">{t("analysis.availabilityLabel")}</dt>
          <dd className="text-body">{availabilityLabel ? t(availabilityLabel) : input.availability}</dd>
        </div>
        <div className="space-y-1">
          <dt className="text-[13px] text-subtle">{t("analysis.regionLabel")}</dt>
          <dd className="text-body">{SUPPORTED_REGIONS.find(region => region.id === input.region)?.label ?? input.region}</dd>
        </div>
      </dl>
    </section>
  );
}
