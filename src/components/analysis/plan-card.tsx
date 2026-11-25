"use client";

import { useId, type JSX, type ReactNode } from "react";
import { TIER_LABELS } from "@/lib/analysis/input-schema";
import { formatQuantity } from "@/lib/cost/format";
import { formatMoney, formatPercent } from "@/i18n/format";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n/provider";
import { pickText } from "@/i18n/translate";
import type { PlanResult } from "@/types/analysis";
import type { Tier } from "@/types/catalog";

export type PlanCardProps = {
  plan: PlanResult;
  selected: boolean;
  onSelect?: (tier: Tier) => void;
  diagram?: ReactNode;
  alignRows?: boolean;
};

const tierClasses = {
  low: { label: "text-tier-low", dot: "bg-tier-low" },
  balanced: { label: "text-tier-balanced", dot: "bg-tier-balanced" },
  ha: { label: "text-tier-ha", dot: "bg-tier-ha" },
} as const satisfies Record<Tier, { label: string; dot: string }>;

export function PlanCard({ plan, selected, onSelect, diagram, alignRows = false }: PlanCardProps): JSX.Element {
  const { locale, t } = useI18n();
  const id = useId();
  const labels = TIER_LABELS[plan.tier];
  const colors = tierClasses[plan.tier];

  return (
    <article
      aria-labelledby={`${id}-title`}
      className={cn(
        "relative min-w-0 rounded-lg border bg-surface-1 p-6 text-sm text-body",
        alignRows ? "max-xl:flex max-xl:flex-col max-xl:gap-5 xl:row-span-7 xl:grid xl:grid-rows-subgrid" : "flex flex-col gap-5",
        plan.recommended ? "border-border-recommended" : "border-hairline",
        selected && "outline-2 outline-offset-4 outline-ink",
      )}
    >
      {/* 카드 선택 버튼 위에 출처와 전달된 다이어그램을 두어 각각 독립적으로 조작한다. */}
      <button
        type="button"
        aria-label={t("analysis.result.select", { title: pickText(plan.title, locale) })}
        aria-pressed={selected}
        onClick={() => onSelect?.(plan.tier)}
        className="absolute inset-0 z-10 cursor-pointer rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
      />

      <div className={cn("flex min-h-6.5 items-center justify-between gap-2", alignRows && "xl:row-start-1")}>
        <span className={cn("inline-flex items-center gap-1.5 text-xs font-semibold tracking-[0.6px] uppercase", colors.label)}>
          <span aria-hidden="true" className={cn("size-2 shrink-0 rounded-full", colors.dot)} />
          {labels[locale].toUpperCase()}
        </span>
        {plan.recommended && (
          <span className="shrink-0 rounded-full bg-ink px-2.5 py-0.75 text-xs font-semibold text-canvas">{t("analysis.result.recommended")}</span>
        )}
      </div>

      <div className={cn("space-y-1", alignRows && "xl:row-start-2")}>
        <h3 id={`${id}-title`} className="text-xl leading-[1.2] font-semibold tracking-[-0.3px] text-ink">{pickText(plan.title, locale)}</h3>
        <p className="text-[13px] text-subtle">{labels[locale]}</p>
      </div>

      <div className={cn("space-y-0.5", alignRows && "xl:row-start-3")}>
        <p className="text-[30px] font-bold tracking-[-0.8px] text-ink tabular-nums">
          <span>{formatMoney(plan.cost.total, "CAD", locale)}</span>
          <span className="ml-1 text-sm font-medium tracking-normal text-subtle">{t("analysis.result.monthlySuffix")}</span>
        </p>
        {plan.cost.budgetRatio !== null && (
          <p className="text-[13px] text-subtle">{t("analysis.result.budgetRatio", { ratio: formatPercent(plan.cost.budgetRatio, locale) })}</p>
        )}
      </div>

      {/* 선택 버튼(z-10) 위의 z-20 영역은 subgrid 행 높이로 늘어나면 빈 자리까지 덮으므로 내용 높이만 차지한다. */}
      {diagram == null ? (
        <div className={cn("diagram-placeholder flex h-[120px] items-center justify-center rounded-md border border-hairline font-mono text-[11px] text-subtle", alignRows && "xl:row-start-4")}>
          {t("analysis.result.diagram")}
        </div>
      ) : <div className={cn("relative z-20 min-w-0", alignRows && "xl:row-start-4 xl:self-start")}>{diagram}</div>}

      <div className={cn("space-y-2", alignRows && "xl:row-start-5")}>
        <h4 id={`${id}-services`} className="text-xs font-semibold tracking-[0.6px] text-subtle">{t("analysis.result.services")}</h4>
        <ul aria-labelledby={`${id}-services`} className="space-y-2">
          {plan.services.map((service) => (
            <li key={service.componentId} className="flex justify-between gap-3 leading-[1.5]">
              <span className="min-w-0 break-words">{pickText(service.name, locale)}</span>
              <span className="shrink-0 text-subtle tabular-nums">{formatQuantity(service.quantity, service.unitLabel, locale)}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className={cn("space-y-2", alignRows && "xl:row-start-6")}>
        <h4 id={`${id}-pros`} className="text-xs font-semibold tracking-[0.6px] text-subtle">{t("analysis.result.pros")}</h4>
        <ul aria-labelledby={`${id}-pros`} className="space-y-2 leading-[1.7]">
          {plan.pros.map((pro, index) => <li key={index}>{pickText(pro, locale)}</li>)}
        </ul>
      </div>

      <ul className={cn("relative z-20 space-y-2 text-[13px] leading-[1.5] text-subtle", !alignRows && "mt-auto", alignRows && "xl:row-start-7 xl:self-start")}>
        {plan.referenceArchitecture.sources.map((source) => (
          <li key={source.url}>
            {t("analysis.result.reference")} · <a href={source.url} aria-label={`${source.title} ${t("analysis.result.newTab")}`} target="_blank" rel="noopener noreferrer" className="text-ink underline underline-offset-[3px] hover:brightness-90">
              {source.title}
              <span className="sr-only"> {t("analysis.result.newTab")}</span>
            </a>
          </li>
        ))}
      </ul>
    </article>
  );
}
