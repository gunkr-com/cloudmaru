"use client";
import { OptionMatrix } from "@/components/results-explorer/saved-explorers";
import { ResultsExplorer } from "@/components/results-explorer/results-explorer";
import { LocalTime } from "@/components/ui/local-time";

import { useEffect, useRef, useState, type JSX, type ReactNode } from "react";
import { ArchitectureDiagram } from "@/components/analysis/architecture-diagram";
import { getDiagramEdges } from "@/components/analysis/diagram-edges";
import { CostBreakdown } from "@/components/analysis/cost-breakdown";
import { PlanComparison } from "@/components/analysis/plan-comparison";
import { ArtifactsSection } from "@/components/artifacts/artifacts-section";
import { Button } from "@/components/ui/button";
import { AVAILABILITY_OPTIONS, EXPECTED_USERS_OPTIONS, TIER_LABELS } from "@/lib/analysis/input-schema";
import { pickText } from "@/i18n/translate";
import { useI18n } from "@/i18n/provider";
import { SUPPORTED_REGIONS } from "@/lib/workspace/regions";
import { formatPercent, formatMonthlyMoney } from "@/i18n/format";
import { buildPlanDiagrams } from "@/lib/diagram/plan-diagrams";
import { reportHref } from "@/lib/report/links";
import type { AnalysisResult, PlanResult } from "@/types/analysis";
import type { Tier } from "@/types/catalog";

export type AnalysisResultViewProps = {
  result: AnalysisResult;
  selectedTier?: Tier;
  onSelectTier?: (tier: Tier) => void;
  createdAt?: string;
  rerunHref?: string;
  /** Saved analysis ID. When present, links the saved report for the selected option. */
  reportId?: string;
  showBuildAction?: boolean;
  renderArtifacts?: (plan: PlanResult) => ReactNode;
  focusHeadingOnMount?: boolean;
};

const ARTIFACTS_ID = "analysis-artifacts";

export function AnalysisResultView({
  result, selectedTier: controlledTier, onSelectTier, createdAt, rerunHref, reportId, showBuildAction = false,
  renderArtifacts, focusHeadingOnMount = false,
}: AnalysisResultViewProps): JSX.Element {
  const { locale, t } = useI18n();
  const recommendedTier = result.plans.some((plan) => plan.tier === result.recommendedTier) ? result.recommendedTier : result.plans[0].tier;
  const [internalTier, setInternalTier] = useState<Tier>(recommendedTier);
  const [reasonExpanded, setReasonExpanded] = useState(false);
  const [reasonOverflows, setReasonOverflows] = useState(false);
  const reasonRef = useRef<HTMLParagraphElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const artifactsRef = useRef<HTMLDivElement>(null);
  const isControlled = controlledTier !== undefined;
  const selectedTier = isControlled && result.plans.some((plan) => plan.tier === controlledTier) ? controlledTier : isControlled ? recommendedTier : internalTier;
  const selectedPlan = result.plans.find((plan) => plan.tier === selectedTier) ?? result.plans[0];
  const expectedUsers = EXPECTED_USERS_OPTIONS.find((option) => option.value === result.input.expectedUsers)!.labelKey;
  const availability = AVAILABILITY_OPTIONS.find((option) => option.value === result.input.availability)!.labelKey;
  const overflowingPlans = result.plans.filter((plan) => plan.cost.budgetRatio !== null && plan.cost.budgetRatio > 1);
  const allOverBudget = overflowingPlans.length === result.plans.length;
  const lowestOverBudgetRatio = allOverBudget ? Math.min(...overflowingPlans.map((plan) => plan.cost.budgetRatio!)) : null;

  useEffect(() => {
    if (focusHeadingOnMount) headingRef.current?.focus();
  }, [focusHeadingOnMount]);

  // 접힌 상태에서 두 줄을 넘는지 재서 "더 보기"를 정한다. 펼치면 넘침이 사라지므로 접혀 있을 때만 잰다.
  useEffect(() => {
    const reason = reasonRef.current;
    if (!reason || reasonExpanded) return;
    const measure = () => setReasonOverflows(reason.scrollHeight > reason.clientHeight);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(reason);
    return () => observer.disconnect();
  }, [reasonExpanded, result.recommendationReason, locale]);

  function selectTier(tier: Tier): void {
    onSelectTier?.(tier);
    if (!isControlled) setInternalTier(tier);
  }

  function focusArtifacts(): void {
    const container = artifactsRef.current;
    if (!container) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    container.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
    // 기본 focus()는 Chromium에서 방금 시작한 부드러운 스크롤을 끊는다.
    (container.querySelector<HTMLElement>("[data-artifacts-heading]") ?? container).focus({ preventScroll: true });
  }

  return (
    <div className="flex min-w-0 flex-col gap-10">
      <header className="space-y-2.5">
        <p className="text-xs font-semibold tracking-[0.6px] text-subtle">{t("analysis.result.heading")}{createdAt ? <> · <LocalTime value={createdAt} format="date" /></> : null}</p>
        <h1 ref={headingRef} tabIndex={-1} className="text-[32px] leading-[1.18] font-bold tracking-[-0.8px] text-ink">{pickText(result.requestTitle, locale)}</h1>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <p className="text-sm leading-[1.7] text-muted">
            {t("analysis.conditionSummary", { users: t(expectedUsers), budget: formatMonthlyMoney(result.input.monthlyBudget, "CAD", locale), availability: t(availability), region: SUPPORTED_REGIONS.find(region => region.id === result.input.region)?.label ?? result.input.region })}
          </p>
          {rerunHref && <Button asChild variant="secondary"><a href={rerunHref}>{t("analysis.rerun")}</a></Button>}
          {reportId && <Button asChild variant="secondary"><a href={reportHref("build", reportId, { locale, tier: selectedTier })}>{t("reports.viewReport")}</a></Button>}
        </div>
        {showBuildAction && <Button onClick={focusArtifacts}>{t("analysis.result.startBuilding", { option: TIER_LABELS[selectedTier][locale] })}</Button>}
      </header>

      {(result.outOfScope || allOverBudget) && <div className="space-y-1">
        {result.outOfScope && <p className="text-[13px] leading-[1.6] text-warning">{t("analysis.result.outOfScope")}</p>}
        {lowestOverBudgetRatio !== null && <p className="text-[13px] leading-[1.6] text-warning">{t("analysis.result.overBudget", { ratio: formatPercent(lowestOverBudgetRatio, locale) })}</p>}
      </div>}

      <section aria-label={t("analysis.result.reason")} className="space-y-2.5">
        <h2 className="text-xs font-semibold tracking-[0.6px] text-subtle">{t("analysis.result.reason")}</h2>
        <p ref={reasonRef} id="recommendation-reason" className={`text-sm leading-[1.7] text-body ${reasonExpanded ? "" : "line-clamp-2"}`}>{pickText(result.recommendationReason, locale)}</p>
        {reasonOverflows && <button type="button" aria-expanded={reasonExpanded} aria-controls="recommendation-reason" onClick={() => setReasonExpanded((expanded) => !expanded)} className="text-sm font-medium text-ink underline underline-offset-[3px]">{reasonExpanded ? t("analysis.result.collapse") : t("analysis.result.expand")}</button>}
      </section>

      <OptionMatrix options={result.plans.map(plan => ({ id: plan.tier, title: TIER_LABELS[plan.tier][locale], cost: plan.cost.total, components: plan.services.length, reference: plan.referenceArchitecture.name[locale] }))}/>
      <section aria-label={t("analysis.result.compare")} className="space-y-4">
        <h2 className="text-xs font-semibold tracking-[0.6px] text-subtle">{t("analysis.result.compare")}</h2>
        <PlanComparison showCompactSummary={false} plans={result.plans} selectedTier={selectedTier} onSelect={selectTier} selectionHint={t("analysis.result.selectionHint")} renderDiagram={(plan) => { const { preview, full } = buildPlanDiagrams(plan, locale); return <ArchitectureDiagram code={preview} fullCode={full} label={t("analysis.result.diagramLabel", { option: TIER_LABELS[plan.tier][locale] })} edges={getDiagramEdges(plan, locale)} />; }} />
      </section>

      <ResultsExplorer key={selectedTier} scope={`build_${selectedTier}`} title={t("explorer.components")} rows={selectedPlan.services.map(service => ({ id: service.componentId, values: { name: service.name[locale], component: service.componentId, quantity: service.quantity, unit: service.unitLabel[locale] } }))} columns={[
        { key: "name", label: t("explorer.name") }, { key: "component", label: t("explorer.type") }, { key: "quantity", label: t("explorer.quantity") }, { key: "unit", label: t("explorer.unit") },
      ]}/>
      <CostBreakdown plan={selectedPlan} priceAsOf={result.priceAsOf} />
      <div id={ARTIFACTS_ID} ref={artifactsRef} tabIndex={-1} className="min-w-0 scroll-mt-6">
        {renderArtifacts ? renderArtifacts(selectedPlan) : <ArtifactsSection plan={selectedPlan} initialArtifacts={[]} />}
      </div>
    </div>
  );
}
