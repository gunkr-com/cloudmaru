"use client";

import type { JSX, ReactNode } from "react";
import { PlanCard } from "@/components/analysis/plan-card";
import type { PlanResult } from "@/types/analysis";
import type { Tier } from "@/types/catalog";
import { TIER_LABELS } from "@/lib/analysis/input-schema";
import { useI18n } from "@/i18n/provider";
import { formatMonthlyMoney, formatPercent } from "@/i18n/format";
import { cn } from "@/lib/utils";

export type PlanComparisonProps = {
  plans: PlanResult[];
  selectedTier: Tier;
  onSelect: (tier: Tier) => void;
  renderDiagram?: (plan: PlanResult) => ReactNode;
  selectionHint?: string;
  showCompactSummary?: boolean;
};

const tierOrder: Tier[] = ["low", "balanced", "ha"];
const tierStyle = { low: "bg-tier-low", balanced: "bg-tier-balanced", ha: "bg-tier-ha" } satisfies Record<Tier, string>;

export function PlanComparison({ plans, selectedTier, onSelect, renderDiagram, selectionHint, showCompactSummary = true }: PlanComparisonProps): JSX.Element {
  const { locale, t } = useI18n();
  const orderedPlans = tierOrder.flatMap((tier) => {
    const plan = plans.find((candidate) => candidate.tier === tier);
    return plan ? [plan] : [];
  });
  return (
    <div className="space-y-4">
      {selectionHint && <p className="text-[13px] text-subtle">{selectionHint}</p>}
      {showCompactSummary && <div className="relative overflow-x-auto xl:hidden">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">{t("analysis.result.summary")}</caption>
          <thead><tr className="border-b border-border-strong text-left text-xs font-semibold tracking-[0.6px] text-subtle"><th className="py-2 pr-3">{t("analysis.result.option")}</th><th className="py-2 text-right">{t("analysis.result.monthlyCost")}</th><th className="py-2 pl-3 text-right">{t("analysis.result.budgetColumn")}</th></tr></thead>
          <tbody>{orderedPlans.map((plan) => <tr key={plan.tier} className="border-b border-hairline">
            <th scope="row" className="py-3 pr-3 text-left font-medium text-body"><span className={cn("mr-2 inline-block size-2 rounded-full", tierStyle[plan.tier])} />{TIER_LABELS[plan.tier][locale]}{plan.recommended && <span className="ml-2 text-xs text-ink">{t("analysis.result.recommended")}</span>}</th>
            <td className="py-3 text-right text-ink tabular-nums">{formatMonthlyMoney(plan.cost.total, "CAD", locale)}</td>
            <td className="py-3 pl-3 text-right text-muted tabular-nums">{plan.cost.budgetRatio === null ? "—" : formatPercent(plan.cost.budgetRatio, locale)}</td>
          </tr>)}</tbody>
        </table>
      </div>}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
      {orderedPlans.map((plan) => (
        <PlanCard
          key={plan.tier}
          plan={plan}
          selected={plan.tier === selectedTier}
          onSelect={onSelect}
          diagram={renderDiagram?.(plan)}
          alignRows
        />
      ))}
      </div>
    </div>
  );
}
