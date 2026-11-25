"use client";

import { OptionMatrix } from "@/components/results-explorer/saved-explorers";
import { ResultsExplorer } from "@/components/results-explorer/results-explorer";
import { useEffect, useState, type ReactNode } from "react";
import { useI18n } from "@/i18n/provider";
import { formatMoney, formatMonthlyMoney, formatNumber, formatPercent } from "@/i18n/format";
import { LocalTime } from "@/components/ui/local-time";
import { EXPECTED_USERS_OPTIONS, AVAILABILITY_OPTIONS } from "@/lib/analysis/input-schema";
import { selectExtensionTier } from "@/lib/extend-app/result";
import { reportHref } from "@/lib/report/links";
import type { ExtensionDisplay } from "@/lib/extend-app/result";
import type { CompletionReasonCode } from "@/types/completion";
import type { Tier } from "@/types/catalog";

/** Root22 can render the phase21 panel from this exact saved selection. No request data is accepted here. */
export type ExtensionArtifactSelection = { extensionId: string; sourceScanId: string; tier: Tier };
export type ExtensionResultViewProps = {
  display: ExtensionDisplay; initialTier?: Tier;
  renderArtifacts?: (selection: ExtensionArtifactSelection) => ReactNode;
};
const focus = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink";
const tierColor = { low: "text-tier-low", balanced: "text-tier-balanced", ha: "text-tier-ha" };

export function ExtensionResultView({ display, initialTier, renderArtifacts }: ExtensionResultViewProps) {
  const { t, locale } = useI18n();
  const { result, components, references, resources } = display;
  const [selectedTier, setSelectedTier] = useState<Tier>(initialTier ?? result.recommendedTier);
  useEffect(() => {
    const sync = () => setSelectedTier(selectExtensionTier(new URLSearchParams(window.location.search).get("tier"), initialTier ?? result.recommendedTier));
    sync(); window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, [result.id, result.recommendedTier, initialTier]);
  const plan = result.plans.find(p => p.tier === selectedTier)!;
  const cost = plan.incrementalCost;
  const reason = (code: CompletionReasonCode) => t(`extension.reasons.${code}`);
  const componentName = (id: string) => components[id].name[locale];
  const resourceName = (id: string) => resources[id].name;
  const quantity = (id: string, amount: number) => t("extension.result.quantity", { quantity: formatNumber(amount, locale), unit: components[id].unitLabel[locale] });
  const assumptions = (id: string, amount: number) => {
    const c = components[id];
    return c.assumption ? t("analysis.costAssumption", { value: c.assumption[locale].replaceAll("{quantity}", formatNumber(amount, locale)) })
      : c.hourly ? t("analysis.costHours") : c.free ? t("analysis.costFree") : null;
  };
  const externalSources = (sources: { title: string; url: string }[]) => <ul className="space-y-2">{sources.map(source => <li key={source.url} className="min-w-0"><a href={source.url} target="_blank" rel="noopener noreferrer" className={`inline-block min-h-6 break-words underline ${focus}`}>{source.title}<span className="sr-only"> {t("analysis.result.newTab")}</span></a></li>)}</ul>;
  const costLabel = (value: typeof cost) => "data" in value
    ? formatMonthlyMoney(value.data.total, "CAD", locale)
    : t("extension.result.unavailable");
  function select(tier: Tier) {
    setSelectedTier(tier);
    const url = new URL(window.location.href); url.searchParams.set("tier", tier);
    window.history.pushState(null, "", url.pathname + url.search + url.hash);
  }
  return <div className="min-w-0 space-y-10 text-body">
    <header className="space-y-3">
      <p className="text-xs uppercase tracking-wide text-subtle">{t("extension.result.heading")} · <LocalTime value={result.createdAt} format="datetime" /></p>
      <h1 id="extension-heading" tabIndex={-1} className="break-words text-[32px] font-bold leading-tight text-ink">{result.requestTitle[locale]}</h1>
      <p>{display.region[locale]} · {t("extension.ui.budgetLabel")}: {formatMonthlyMoney(result.input.monthlyBudget, "CAD", locale)}</p>
      <p>{t("analysis.usersLabel")} · {t(EXPECTED_USERS_OPTIONS.find(option => option.value === result.input.expectedUsers)!.labelKey)}</p>
      <p>{t("analysis.availabilityLabel")} · {t(AVAILABILITY_OPTIONS.find(option => option.value === result.input.availability)!.labelKey)}</p>
      <details><summary className={`min-h-6 cursor-pointer ${focus}`}>{t("analysis.result.reason")}</summary><p className="mt-2 whitespace-pre-wrap break-words">{result.recommendationReason[locale]}</p></details>
      <a className={`inline-block min-h-6 break-words font-semibold underline ${focus}`} href={reportHref("extend", result.id, { locale, tier: selectedTier })}>{t("reports.viewReport")}</a>
    </header>
    <section aria-label={t("analysis.result.compare")} className="grid min-w-0 gap-4 xl:grid-cols-3">
      {result.plans.map(option => <div key={option.tier} className={`min-w-0 rounded-xl border bg-surface-1 p-5 ${option.tier === result.recommendedTier ? "border-recommended" : "border-hairline"} ${option.tier === selectedTier ? "outline-2 outline-offset-4 outline-ink" : ""}`}>
        <button type="button" className={`block min-h-24 w-full space-y-2 rounded-lg text-left ${focus}`} aria-pressed={selectedTier === option.tier} aria-label={t("extension.result.select", { option: t(`common.tiers.${option.tier}`) })} onClick={() => select(option.tier)}>
          <span className={`block text-xs font-semibold uppercase ${tierColor[option.tier]}`}>● {t(`common.tiers.${option.tier}`)}</span>
          {option.tier === result.recommendedTier && <span className="inline-block rounded-full bg-ink px-2 py-0.5 text-xs font-semibold text-canvas">{t("analysis.result.recommended")}</span>}
          <span className="block break-words font-semibold text-ink">{option.title[locale]}</span>
          <span className="block text-[30px] font-bold tabular-nums text-ink">{costLabel(option.incrementalCost)}</span>
          {option.incrementalCost.state === "partial" && <span className="block text-sm text-warning">{t("extension.result.partial")}</span>}
          {option.incrementalCost.state === "available" && <span className="block text-sm">{t("analysis.result.budgetRatio", { ratio: formatPercent(option.incrementalCost.data.total / result.input.monthlyBudget, locale) })}</span>}
        </button>
      </div>)}
    </section>
    <OptionMatrix options={result.plans.map(option => ({ id: option.tier, title: t(`common.tiers.${option.tier}`), cost: "data" in option.incrementalCost ? option.incrementalCost.data.total : null, costState: t(`assessment.componentStatus.${option.incrementalCost.state}`), components: new Set([...option.reusedResources, ...option.newItems, ...option.usageIncreases].map(item => item.componentId)).size, reference: references[option.referenceArchitectureId].name[locale], reuse: { reused: option.reusedResources.length, newItems: option.newItems.length, increases: option.usageIncreases.length } }))}/>
    <ResultsExplorer key={selectedTier} scope={`extend_${selectedTier}`} title={t("explorer.components")} rows={[
      ...plan.reusedResources.map((item, index) => ({ id: `reused:${index}`, values: { name: componentName(item.componentId), kind: "reused", resource: item.resourceId, quantity: null, unit: null }, labels: { kind: t("explorer.reused"), resource: resourceName(item.resourceId) } })),
      ...plan.newItems.map((item, index) => ({ id: `new:${index}`, values: { name: componentName(item.componentId), kind: "new", resource: null, quantity: item.quantity, unit: components[item.componentId].unitLabel[locale] }, labels: { kind: t("explorer.newItems") } })),
      ...plan.usageIncreases.map((item, index) => ({ id: `increase:${index}`, values: { name: componentName(item.componentId), kind: "increase", resource: item.resourceId, quantity: item.quantity, unit: components[item.componentId].unitLabel[locale] }, labels: { kind: t("explorer.increases"), resource: resourceName(item.resourceId) } })),
    ]} columns={[{ key: "name", label: t("explorer.name") }, { key: "kind", label: t("explorer.kind") }, { key: "resource", label: t("explorer.resource") }, { key: "quantity", label: t("explorer.quantity") }, { key: "unit", label: t("explorer.unit") }]} facets={[{ key: "kind", label: t("explorer.kind"), chart: true, labels: { reused: t("explorer.reused"), new: t("explorer.newItems"), increase: t("explorer.increases") } }]}/>
    <p className="text-sm text-subtle">{t("extension.additionalCost")}</p>
    <section aria-labelledby="extension-services" className="min-w-0 space-y-6 rounded-xl border border-hairline bg-surface-1 p-5 sm:p-6">
      <h2 id="extension-services" className="text-xl font-semibold text-ink">{t(`common.tiers.${selectedTier}`)}</h2>
      <div className="grid min-w-0 gap-6 xl:grid-cols-3">
        <div className="min-w-0 space-y-3"><h3 className="font-semibold text-ink">{t("extension.reused")}</h3>
          <ul className="space-y-3">{plan.reusedResources.map(item => <li key={item.resourceId} className="break-words"><p className="font-semibold">{resourceName(item.resourceId)}</p><p>{componentName(item.componentId)}</p><p className="text-sm text-muted">{item.reason[locale]}</p></li>)}</ul>
          {!plan.reusedResources.length && <p>{t("extension.result.none")}</p>}
        </div>
        <div className="min-w-0 space-y-3"><h3 className="font-semibold text-ink">{t("extension.newItems")}</h3><ul className="space-y-3">{plan.newItems.map(item => <li key={item.componentId} className="break-words">{componentName(item.componentId)}<p className="text-sm text-muted">{quantity(item.componentId, item.quantity)}</p>{item.instanceCount !== undefined && <p className="text-sm text-muted">{t("extension.result.instanceCount", { count: formatNumber(item.instanceCount, locale) })}</p>}</li>)}</ul></div>
        <div className="min-w-0 space-y-3"><h3 className="font-semibold text-ink">{t("extension.usageIncreases")}</h3><ul className="space-y-3">{plan.usageIncreases.map(item => <li key={`${item.resourceId}:${item.componentId}`} className="break-words">{resourceName(item.resourceId)} · {componentName(item.componentId)}<p className="text-sm text-muted">{quantity(item.componentId, item.quantity)}</p></li>)}</ul>{!plan.usageIncreases.length && <p>{t("extension.result.none")}</p>}</div>
      </div>
      <p className="text-sm text-warning">{t("extension.capacityNotice")}</p>
      <details><summary className={`min-h-6 cursor-pointer ${focus}`}>{t("analysis.result.pros")}</summary><ul className="mt-3 space-y-2">{plan.pros.map((pro, index) => <li key={index} className="break-words">{pro[locale]}</li>)}</ul></details>
      <details><summary className={`min-h-6 cursor-pointer ${focus}`}>{t("analysis.result.reference")} · {references[plan.referenceArchitectureId].name[locale]}</summary>
        <div className="mt-3 space-y-4">{externalSources(references[plan.referenceArchitectureId].sources)}
          {[...new Set([...plan.reusedResources, ...plan.newItems, ...plan.usageIncreases].map(i => i.componentId))].map(id => <div key={id}><p className="mb-2 font-semibold">{componentName(id)}</p>{externalSources(components[id].sources)}</div>)}
        </div>
      </details>
    </section>
    <section aria-labelledby="extension-cost" className="min-w-0 space-y-4">
      <h2 id="extension-cost" className="text-xl font-semibold text-ink">{t("extension.additionalCost")}</h2>
      <p className="text-sm text-subtle">{t("extension.result.priceAsOf", { date: "data" in cost ? cost.data.priceAsOf : display.priceAsOf })}</p>
      {"data" in cost ? <>
        <div className="min-w-0 overflow-x-auto"><table className="w-full text-left text-sm">
          <caption className="sr-only">{t("extension.result.costBreakdown")}</caption>
          <thead><tr className="border-b border-strong text-subtle"><th className="p-3">{t("analysis.result.item")}</th><th className="p-3 text-right">{t("extension.additionalCost")}</th></tr></thead>
          <tbody>{cost.data.lines.map(line => <tr key={`${line.kind}:${line.componentId}:${line.resourceId}`} className="border-b border-hairline">
            <td className="p-3"><p className="break-words font-semibold">{componentName(line.componentId)}</p><p>{t(line.kind === "new" ? "extension.result.newCost" : "extension.result.increasedCost")}{line.resourceId && <> · {resourceName(line.resourceId)}</>}</p><p>{quantity(line.componentId, line.quantity)}</p><p className="text-subtle">{assumptions(line.componentId, line.quantity)}</p></td>
            <td className="p-3 text-right align-top tabular-nums">{formatMoney(line.amount, "CAD", locale, { maximumFractionDigits: 2 })}</td>
          </tr>)}</tbody>
          <tfoot><tr className="border-t border-strong text-lg font-bold text-ink"><th className="p-3">{t(cost.state === "partial" ? "extension.result.pricedSubtotal" : "analysis.result.total")}</th><td className="p-3 text-right tabular-nums">{formatMoney(cost.data.total, "CAD", locale, { maximumFractionDigits: 2 })}</td></tr></tfoot>
        </table></div>
      </> : <p>{t("extension.result.unavailable")} · {reason("reason" in cost ? cost.reason : "price-unavailable")}</p>}
      {cost.state !== "available" && <div className="space-y-2 text-warning"><p>{t("extension.priceNotice")}</p>{cost.state === "partial" && cost.reasons.map(code => <p key={code}>{reason(code)}</p>)}
        <ul>{[...plan.newItems, ...plan.usageIncreases].filter(item => !("data" in cost) || !cost.data.lines.some(line => line.componentId === item.componentId && line.resourceId === ("resourceId" in item ? item.resourceId : null))).map((item, index) => <li key={index}>{componentName(item.componentId)} · {quantity(item.componentId, item.quantity)}</li>)}</ul>
      </div>}
      <p className="text-sm text-subtle">{t("extension.result.baseCostNotice")}</p>
      <p className="text-sm text-subtle">{t("extension.freeGrantNotice")}</p>
      <p className="text-sm text-subtle">{t("analysis.result.estimateNotice")}</p>
    </section>
    <section aria-labelledby="extension-checks" className="min-w-0 space-y-4">
      <h2 id="extension-checks" className="text-xl font-semibold text-ink">{t("extension.result.checks")}</h2>
      <p className="text-sm text-warning">{t("extension.result.deploymentNotice")}</p>
      {plan.checks.map((check, index) => <details key={index} className="min-w-0 rounded-xl border border-hairline bg-surface-1 p-4">
        <summary className={`min-h-6 cursor-pointer ${focus}`}>{t(`extension.result.${check.kind}`)} · <span>{t(`extension.verdict.${check.verdict}`)}</span></summary>
        <div className="mt-3 space-y-3">{check.reasonCodes.map(code => <p key={code}>{reason(code)}</p>)}
          <ul>{check.resourceIds.map(id => <li key={id} className="break-words">{resourceName(id)}</li>)}{check.componentIds.map(id => <li key={id}>{componentName(id)}</li>)}</ul>
          {check.evidence.map((evidence, i) => <div key={i} className="min-w-0 space-y-1 text-sm">
            <p className="break-words">{t("extension.result.evidence")} · {resourceName(evidence.resourceId)}</p>
            <p className="break-all font-mono">{evidence.propertyPath}</p>
            <pre className="whitespace-pre-wrap break-all font-mono text-muted">{evidence.observation.state === "present" ? JSON.stringify(evidence.observation.value, null, 2) : t(evidence.observation.state === "missing" ? "extension.result.missing" : "extension.result.invalid")}</pre>
          </div>)}
        </div>
      </details>)}
    </section>
    {plan.subnetProposals.length > 0 && <section className="min-w-0 space-y-4"><h2 className="text-xl font-semibold text-ink">{t("extension.result.subnets")}</h2>
      {plan.subnetProposals.map(subnet => <div key={subnet.id} className="min-w-0 space-y-2 rounded-xl border border-hairline p-4">
        <p className="break-words">{subnet.id} · {componentName(subnet.componentId)} · {subnet.region}</p>
        <p className="break-all font-mono">{subnet.addressPrefixes.join(", ")}</p>
        <p>{t(subnet.parent.kind === "new" ? "extension.result.newParent" : "extension.result.existingParent")}</p>
        {subnet.parent.kind === "existing" ? <><p className="break-words">{resourceName(subnet.parent.resourceId)}</p><p className="break-all font-mono">{resources[subnet.parent.resourceId].addressPrefixes.join(", ")}</p></>
          : <><p className="break-words">{subnet.parent.id} · {componentName(subnet.parent.componentId)}</p><p className="break-all font-mono">{subnet.parent.addressPrefixes.join(", ")}</p></>}
      </div>)}
    </section>}
    <section className="space-y-3"><h2 className="text-xl font-semibold text-ink">{t("extension.result.coverage")}</h2>
      <p>{t("extension.coverage", { included: result.contextCoverage.included, total: result.contextCoverage.total })}</p>
      <p>{t("extension.result.excluded", { count: result.contextCoverage.excluded })}</p>
      <ul>{result.contextCoverage.reasons.map(r => <li key={r.code}>{reason(r.code)} · {formatNumber(r.count, locale)}</li>)}</ul>
      <p>{t("extension.result.completeness", { state: t(result.sourceScan.completeness.state === "complete" ? "extension.result.complete" : result.sourceScan.completeness.state === "partial" ? "extension.result.incomplete" : "extension.result.unknown") })}</p>
      <ul>{result.sourceScan.completeness.reasons.map(code => <li key={code}>{reason(code)}</li>)}</ul>
      <p>{t("extension.result.source")} · <LocalTime value={result.sourceScan.collectedAt} format="datetime" /></p>
      <p className="text-sm text-subtle">{t("extension.result.collectionNotice")}</p>
    </section>
    <details><summary className={`min-h-6 cursor-pointer ${focus}`}>{t("extension.result.input")}</summary><p className="mt-2 whitespace-pre-wrap break-words">{result.input.description}</p></details>
    {renderArtifacts?.({ extensionId: result.id, sourceScanId: result.sourceScanId, tier: selectedTier })}
  </div>;
}
