"use client";
import type { JSX } from "react";
import { formatCostNote } from "@/lib/cost/format";
import { TIER_LABELS } from "@/lib/analysis/input-schema";
import { formatMoney, formatDate } from "@/i18n/format";
import { useI18n } from "@/i18n/provider";
import { pickText } from "@/i18n/translate";
import type { PlanResult } from "@/types/analysis";

export type CostBreakdownProps = {
  plan: PlanResult;
  priceAsOf: string;
};

export function CostBreakdown({ plan, priceAsOf }: CostBreakdownProps): JSX.Element {
  const { locale, t } = useI18n();
  const tierLabel = TIER_LABELS[plan.tier][locale];

  return (
    <section aria-label={t("analysis.result.costBreakdown")} className="min-w-0 space-y-5 rounded-lg border border-hairline bg-surface-1 p-6 text-sm text-body sm:p-7">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="space-y-1.5">
          <h2 className="text-xs font-semibold tracking-[0.6px] text-subtle">{t("analysis.result.costBreakdown")}</h2>
          <p className="text-xl leading-[1.2] font-semibold tracking-[-0.3px] text-ink">{t("analysis.result.optionName", { option: tierLabel })}</p>
        </div>
        <p className="text-[13px] text-subtle">{t("analysis.result.priceAsOf", { date: formatDate(priceAsOf + "T00:00:00", locale) })}</p>
      </div>

      <table className="w-full border-collapse text-left">
        <caption className="sr-only">{t("analysis.result.costCaption", { option: tierLabel })}</caption>
        <thead className="border-b border-border-strong text-xs font-semibold tracking-[0.6px] text-subtle">
          <tr>
            <th scope="col" className="pb-3 font-semibold">{t("analysis.result.item")}</th>
            <th scope="col" className="pb-3 text-right font-semibold">{t("analysis.result.monthlyCost")}</th>
          </tr>
        </thead>
        <tbody>
          {plan.cost.lines.map((line) => (
            <tr key={line.componentId} className="border-b border-border-row leading-[1.5] last:border-b-0">
              <th scope="row" className="py-3 pr-4 align-top font-medium">
                <span className="block text-ink">{pickText(line.name, locale)}</span>
                <span className="mt-0.5 block text-[13px] text-subtle">{formatCostNote(line, locale)}</span>
              </th>
              <td className="py-3 text-right align-top whitespace-nowrap text-ink tabular-nums">{formatMoney(line.amount, "CAD", locale, { maximumFractionDigits: 2 })}</td>
            </tr>
          ))}
        </tbody>
        <tfoot className="border-t border-border-strong text-lg font-bold text-ink">
          <tr>
            <th scope="row" className="pt-3.5">{t("analysis.result.total")}</th>
            <td className="pt-3.5 text-right whitespace-nowrap tabular-nums">{formatMoney(plan.cost.total, "CAD", locale)}</td>
          </tr>
        </tfoot>
      </table>

      <p className="text-[13px] leading-[1.6] text-warning">
        {t("analysis.result.estimateNotice")}
      </p>
    </section>
  );
}
