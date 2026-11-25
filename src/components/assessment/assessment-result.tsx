"use client";
import type {AssessmentCatalogData} from "@/types/assessment";
import {normalizeCostTotalForDisplay} from "@/lib/assessment/app/cost-display";
import { ResultsExplorer } from "@/components/results-explorer/results-explorer";
import { ActualCostExplorer } from "@/components/results-explorer/saved-explorers";
import { assessmentRows } from "@/lib/results-explorer/adapters";
import { LocalTime } from "@/components/ui/local-time";
import { useI18n } from "@/i18n/provider";
import { formatMoney, formatNumber } from "@/i18n/format";
import { loadAssessmentRules } from "@/lib/assessment/rules/catalog";
import { advisorCatalog } from "@/lib/assessment/advisor-catalog";
import type { AssessmentResult, ActualCost, AssessmentPillar, AssessmentSeverity } from "@/types/assessment";
import type { ComponentResult, CompletionReasonCode, Coverage, Observation, SourceScan } from "@/types/completion";

const panel = "min-w-0 space-y-4 rounded-xl border border-hairline bg-surface-1 p-5 sm:p-6";
const focus = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink";
const severities: AssessmentSeverity[] = ["critical", "high", "medium", "low", "informational"];
const pillars: AssessmentPillar[] = ["reliability", "security", "cost", "operations", "performance"];
function Reasons({ codes }: { codes: CompletionReasonCode[] }) {
  const { t } = useI18n();
  return <ul className="space-y-1 text-sm text-muted">{codes.map(code => <li key={code}>{t(`assessment.reasons.${code}`)}</li>)}</ul>;
}
function CoverageView({ coverage }: { coverage: Coverage }) {
  const { t, locale } = useI18n();
  return <div className="space-y-2 text-sm"><p>{t("assessment.ui.coverage", Object.fromEntries(["total", "included", "excluded"].map(key => [key, formatNumber(coverage[key as "total"], locale)])))}</p>
    <ul>{coverage.reasons.map(reason => <li key={reason.code}>{t(`assessment.reasons.${reason.code}`)} · {formatNumber(reason.count, locale)}</li>)}</ul>
  </div>;
}
function ComponentState({ component }: { component: ComponentResult<unknown> }) {
  const { t } = useI18n();
  return <div className="space-y-2"><p>{t(`assessment.componentStatus.${component.state}`)}</p>
    {component.state === "partial" && <Reasons codes={component.reasons} />}
    {(component.state === "failed" || component.state === "unavailable") && <Reasons codes={[component.reason]} />}
  </div>;
}
function ObservationView({ observation }: { observation: Observation }) {
  const { t } = useI18n();
  return <span className="break-words">{t(`assessment.ui.${observation.state}`)}{observation.state === "present" && <code className="block whitespace-pre-wrap break-all text-xs">{JSON.stringify(observation.value)}</code>}</span>;
}
function Sources({ urls }: { urls: string[] }) {
  const { t } = useI18n();
  return <ul className="space-y-2">{urls.map((url, index) => <li key={url}><a className={`inline-block min-h-6 break-all underline ${focus}`} href={url} target="_blank" rel="noopener noreferrer">{t("assessment.ui.source")} {index + 1}<span className="sr-only"> {t("assessment.ui.newTab")}</span></a></li>)}</ul>;
}
function ScanProvenance({ scan }: { scan: SourceScan }) {
  const { t } = useI18n();
  return <div className="min-w-0 space-y-2 text-sm text-muted">
    <p className="break-all">{t("assessment.sourceScan", { id: scan.id })}</p>
    <p>{t("assessment.ui.collected")} · <LocalTime value={scan.collectedAt} format="datetime" /></p>
    <p>{t(scan.source === "import" ? "assessment.ui.scanFile" : "assessment.ui.scanLive")}</p>
    <p>{t("assessment.ui.completeness")} · {t(`assessment.ui.${scan.completeness.state}`)}</p>
    <Reasons codes={scan.completeness.reasons} />
    <details><summary className={`min-h-6 cursor-pointer ${focus}`}>{t("assessment.ui.scope")}</summary><ul>{scan.subscriptionIds.map(id => <li className="break-all font-mono" key={id}>{id}</li>)}</ul></details>
  </div>;
}
function CostWindow({ component, title, labels }: { component: ComponentResult<ActualCost>; title: string; labels: Record<string, string> }) {
  const { t, locale } = useI18n();
  const money = (amount: number, currency: string, total = false) => {
    // 소액 조정도 실제 0으로 바꾸지 않는다. 통화를 환산하거나 합산하지 않는다.
    if (amount !== 0 && Math.abs(amount) < (total ? 0.005 : 1e-8)) return `${currency} ${formatNumber(amount, locale, { maximumSignificantDigits: 17 })}`;
    return currency === "CAD" || currency === "USD"
      ? formatMoney(amount, currency, locale, { maximumFractionDigits: total ? 2 : 20 })
      : `${currency} ${formatNumber(amount, locale, { maximumFractionDigits: total ? 2 : 20, minimumFractionDigits:2 })}`;
  };
  return <section aria-label={title} className="min-w-0 space-y-4 border-t border-hairline pt-5">
    <h3 className="text-lg font-semibold">{title}</h3><ComponentState component={component} />
    {"data" in component && <>
      <p>{t("assessment.ui.period")} · <LocalTime value={component.data.period.from} format="datetime" /> – <LocalTime value={component.data.period.to} format="datetime" /></p>
      <p>{t("assessment.ui.retrieved")} · <LocalTime value={component.data.retrievedAt} format="datetime" /></p>
      <p>{t("assessment.ui.costScope", { available: component.data.scope.availableSubscriptionIds.length, requested: component.data.scope.requestedSubscriptionIds.length })}</p>
      <p>{t(component.data.scope.paginationComplete ? "assessment.ui.paginationComplete" : "assessment.ui.paginationPartial")}</p>
      <details><summary className={`min-h-6 cursor-pointer ${focus}`}>{t("assessment.ui.scope")}</summary>
        <ul>{component.data.scope.requestedSubscriptionIds.map(id => <li key={id} className="break-all font-mono">{id} · {t(component.data.scope.availableSubscriptionIds.includes(id) ? "assessment.componentStatus.available" : "assessment.componentStatus.unavailable")}</li>)}</ul>
      </details>
      {component.data.totals.map(total => <div key={total.currency} className="space-y-3 border-t border-hairline pt-4">
        <p className="break-all text-xl font-semibold tabular-nums">{money(normalizeCostTotalForDisplay(total.amount,component.data.rows.filter(row=>row.currency === total.currency)), total.currency, true)}</p>
        <details><summary className={`min-h-9 cursor-pointer text-sm underline ${focus}`}>{t("explorer.details")}</summary><ul className="space-y-3">{component.data.rows.filter(row => row.currency === total.currency).map((row, index) => <li key={index} className="min-w-0 space-y-1 border-b border-hairline pb-2 text-sm">
          <p className="break-all">{row.attribution.kind === "resource" ? labels[row.attribution.resourceId] ?? row.attribution.resourceId : t("assessment.ui.unattributed")}</p>
          {row.attribution.kind === "unattributed" && <p>{t(`assessment.ui.${row.attribution.reason}`)}</p>}
          {row.attribution.resourceId && <p className="break-all font-mono text-xs text-muted">{row.attribution.resourceId}</p>}
          <p className="break-all text-xs text-muted">{row.subscriptionId}</p>
          <p className="break-all tabular-nums">{money(row.amount, row.currency)}</p>
        </li>)}</ul></details>
      </div>)}
      <ActualCostExplorer scope={component.data.period.preset === "month-to-date" ? "mtd" : "trailing"} cost={component.data} labels={labels}/>
      <p className="text-sm text-muted">{t("assessment.cost.zeroNotice")}</p>
    </>}
  </section>;
}

/** 저장 어댑터가 코드 엔진·카탈로그·비밀 가리기를 재검증한 결과만 받는다. */
export function AssessmentResultView({ result, resourceLabels, catalogData }: { result: AssessmentResult; resourceLabels: Record<string, string>; catalogData?: AssessmentCatalogData }) {
  const { t, locale } = useI18n();
  const rules = catalogData?.rules ?? loadAssessmentRules();
  const savedAdvisor = catalogData?.advisor ?? advisorCatalog;
  const findings = result.local.findings;
  const rows = assessmentRows(findings, resourceLabels, Object.fromEntries(rules.rules.map(rule => [rule.id, rule.title[locale]]))).map(row => ({ ...row, labels: { ...row.labels,
    verdict: t(`assessment.verdict.${row.values.verdict as "pass" | "violation" | "unknown"}`),
    severity: t(`assessment.severity.${row.values.severity as AssessmentSeverity}`),
    pillar: t(`assessment.pillars.${row.values.pillar as AssessmentPillar}`),
  } }));
  const label = (id: string) => resourceLabels[id] ?? id;
  return <div className="min-w-0 space-y-10 text-body">
    <section aria-label={t("assessment.localTitle")} className={`${panel} max-sm:border-0 max-sm:bg-transparent max-sm:p-0`}>
      <h2 className="text-xl font-semibold text-ink">{t("assessment.localTitle")}</h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">{severities.map(value => <p key={value} className="rounded-lg border border-hairline bg-canvas p-3 text-xs text-muted">{t(`assessment.severity.${value}`)}<strong className="mt-1 block text-2xl font-semibold tabular-nums text-ink">{formatNumber(result.local.findings.filter(f => f.verdict === "violation" && f.severity === value).length, locale)}</strong></p>)}</div>
      <div className="grid gap-3 sm:grid-cols-5">{pillars.map(value => <div key={value}><p>{t(`assessment.pillars.${value}`)}</p>{(["pass", "violation", "unknown"] as const).map(verdict => <p className="text-sm" key={verdict}>{t(`assessment.verdict.${verdict}`)} · {formatNumber(result.local.findings.filter(f => f.pillar === value && f.verdict === verdict).length, locale)}</p>)}</div>)}</div>
      <p className="text-sm text-muted">{t("assessment.localNotice")}</p>
      <ScanProvenance scan={result.sourceScan} />
      <p>{t("assessment.ui.version")} · {result.local.rulesVersion}</p>
      <p>{t("assessment.ui.evaluated")} · <LocalTime value={result.local.evaluatedAt} format="datetime" /></p>
      <h3 className="font-semibold">{t("assessment.coverage.title")}</h3><CoverageView coverage={result.local.coverage} />
      <p className="text-sm text-muted">{t("assessment.coverage.unknown")}</p>
      {!findings.length && <p>{t("assessment.ui.noLocalFindings")}</p>}
      <p className="text-sm text-muted">{t("assessment.ui.findingCount", { count: formatNumber(findings.length, locale) })}</p>
      <ResultsExplorer emptyMessage={t("assessment.ui.noFindings")} allLabel={t("assessment.ui.all")} scope="findings" title={t("explorer.findings")} rows={rows} defaultSort="verdict" columns={[
        { key: "rule", label: t("explorer.rule") }, { key: "resource", label: t("explorer.resource"), kind: "identifier" }, { key: "verdict", label: t("explorer.verdictColumn"), kind: "status" }, { key: "severity", label: t("explorer.severity"), kind: "status" }, { key: "pillar", label: t("explorer.pillar"), kind: "status" }, { key: "type", label: t("explorer.type"), kind: "identifier" }, { key: "group", label: t("explorer.group"), kind: "identifier" },
      ]} facets={[
        { key: "verdict", label: t("explorer.verdict"), chart: true, values: ["pass", "violation", "unknown"], labels: Object.fromEntries((["pass", "violation", "unknown"] as const).map(value => [value, t(`assessment.verdict.${value}`)])) },
        { key: "severity", label: t("assessment.ui.filterSeverity"), chart: true, values: severities, labels: Object.fromEntries(severities.map(value => [value, t(`assessment.severity.${value}`)])) },
        { key: "pillar", label: t("assessment.ui.filterPillar"), values: pillars, labels: Object.fromEntries(pillars.map(value => [value, t(`assessment.pillars.${value}`)])) },
        { key: "type", label: t("explorer.type") }, { key: "group", label: t("explorer.group") },
      ]} renderDetails={row => {
        const finding = findings.find(finding => finding.id === row.id)!;

        const rule = rules.rules.find(rule => rule.id === finding.ruleId);
        if (!rule) return null;
        return <div key={finding.id} className="min-w-0 space-y-3">
          <h4 className="font-semibold text-ink">{rule.title[locale]}</h4>
          <p className="break-words text-sm text-muted">{label(finding.resourceId)} · {t(`assessment.verdict.${finding.verdict}`)} · {t(`assessment.severity.${finding.severity}`)}</p>
          <p>{rule.description[locale]}</p><p>{t("assessment.ui.version")} · {finding.ruleVersion}</p>
          <p className="break-all font-mono text-xs">{finding.resourceId}</p>
          {finding.reasonCode && <Reasons codes={[finding.reasonCode]} />}
          <h4 className="font-semibold">{t("assessment.ui.evidence")}</h4>
          <ul className="space-y-3">{finding.evidence.map((item, index) => <li key={index} className="min-w-0 space-y-1"><p className="break-all text-xs text-muted">{label(item.resourceId)}</p><code className="block break-all text-xs">{item.propertyPath}</code><ObservationView observation={item.observation} /></li>)}</ul>
          <h4 className="font-semibold">{t("assessment.ui.remediation")}</h4><p>{rule.remediation[locale]}</p><Sources urls={rule.sources} />
        </div>;
      }}/>
    </section>
    {[result.advisor, result.actualCost.monthToDate, result.actualCost.trailing30Days, result.diff].some(c => ["partial", "unavailable", "failed"].includes(c.state)) && <p>{t("assessment.partialInsights")}</p>}
    <section aria-label={t("assessment.sections.advisor")} className={panel}>
      <h2 className="text-xl font-semibold">{t("assessment.sections.advisor")}</h2><ComponentState component={result.advisor} />
      <p className="text-sm text-muted">{t("assessment.ui.advisorNotice")}</p>
      {"data" in result.advisor && <>
        <p>{t("assessment.ui.retrieved")} · <LocalTime value={result.advisor.data.retrievedAt} format="datetime" /></p><CoverageView coverage={result.advisor.data.coverage} />
        {!result.advisor.data.recommendations.length && <p>{t("assessment.ui.noAdvisor")}</p>}
        {result.advisor.data.recommendations.map(rec => {
          const entry = savedAdvisor.entries.find(entry => entry.ruleId === rec.ruleId && entry.actionId === rec.actionId && entry.recommendationTypeId === rec.recommendationTypeId);
          return entry && <article className="space-y-2 border-t border-hairline pt-3" key={rec.recommendationId}><h3 className="font-semibold">{entry.title[locale]}</h3><p className="break-all">{label(rec.resourceId)}</p><p>{entry.description[locale]}</p><Sources urls={entry.sources} /></article>;
        })}
      </>}
    </section>
    <section className="min-w-0 space-y-4"><h2 className="text-xl font-semibold">{t("assessment.sections.actualCost")}</h2><p className="text-sm text-muted">{t("assessment.ui.provisional")}</p>
      <div className="min-w-0 space-y-8"><CostWindow title={t("assessment.cost.monthToDate")} component={result.actualCost.monthToDate} labels={resourceLabels} /><CostWindow title={t("assessment.cost.trailing30Days")} component={result.actualCost.trailing30Days} labels={resourceLabels} /></div>
      <p className="text-sm text-muted">{t("assessment.ui.noSavings")}</p>
    </section>
    <section aria-label={t("assessment.sections.diff")} className={panel}>
      <h2 className="text-xl font-semibold">{t("assessment.sections.diff")}</h2><ComponentState component={result.diff} />
      {result.diff.state === "not-requested" && <p>{t("assessment.ui.noComparison")}</p>}
      {"data" in result.diff && <>
        <p className="text-sm text-muted">{t("assessment.ui.diffNotice")}</p>
        <h3>{t("assessment.ui.baseline")}</h3><ScanProvenance scan={result.diff.data.baselineScan} />
        <h3>{t("assessment.ui.comparison")}</h3><ScanProvenance scan={result.diff.data.comparisonScan} />
        <p>{t("assessment.ui.compared")} · <LocalTime value={result.diff.data.comparedAt} format="datetime" /></p><CoverageView coverage={result.diff.data.coverage} />
        <ul>{Object.entries(result.diff.data.counts).map(([kind, count]) => <li key={kind}>{t(`assessment.ui.${kind === "unknown" ? "diffUnknown" : kind}` as Parameters<typeof t>[0])} · {formatNumber(count, locale)}</li>)}</ul>
        {!result.diff.data.changes.length && <p>{t("assessment.ui.noChanges")}</p>}
        {result.diff.data.changes.map(change => <details key={change.resourceId} className="space-y-3 border-t border-hairline pt-3"><summary className={`min-h-6 cursor-pointer break-all ${focus}`}>{t(`assessment.ui.${change.kind === "unknown" ? "diffUnknown" : change.kind}`)} · {label(change.resourceId)}</summary>
          {change.kind === "unknown" && <Reasons codes={change.reasons} />}
          {change.kind === "changed" && change.properties.map(property => <div className="min-w-0 space-y-2" key={property.path}><code className="block break-all text-xs">{property.path}</code><div className="grid min-w-0 gap-3 sm:grid-cols-2"><div className="min-w-0"><p>{t("assessment.ui.before")}</p><ObservationView observation={property.before} /></div><div className="min-w-0"><p>{t("assessment.ui.after")}</p><ObservationView observation={property.after} /></div></div></div>)}
        </details>)}
      </>}
    </section>
  </div>;
}
