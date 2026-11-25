"use client";
import { useI18n } from "@/i18n/provider";
import { formatNumber, formatMoney } from "@/i18n/format";
import { networkRows } from "@/lib/results-explorer/adapters";
import { signedCostGroups, type ExplorerRow } from "@/lib/results-explorer/explorer";
import { ResultsExplorer } from "./results-explorer";
import type { ActualCost } from "@/types/assessment";
import type { NetworkDiagnostic } from "@/types/network-diagnostics";
export function InventoryExplorer({ rows }: { rows: ExplorerRow[] }) {
  const { t } = useI18n();
  return <ResultsExplorer scope="resources" title={t("explorer.inventory")} rows={rows} columns={[
    { key: "name", label: t("explorer.name") }, { key: "type", label: t("explorer.type"), kind: "identifier" }, { key: "group", label: t("explorer.group"), kind: "identifier" }, { key: "region", label: t("explorer.region") }, { key: "subscription", label: t("inventory.table.subscription"), kind: "identifier" }, { key: "tags", label: t("inventory.table.tags"), kind: "identifier" }, { key: "resource", label: t("explorer.resource"), kind: "identifier" },
  ]} facets={[{ key: "type", label: t("explorer.type"), chart: true }, { key: "group", label: t("explorer.group") }, { key: "region", label: t("explorer.region"), chart: true }]}/>;
}
export function NetworkExplorer({ paths }: { paths: NetworkDiagnostic["engine"]["paths"] }) {
  const { t } = useI18n();
  const rows = networkRows(paths).map(row => ({ ...row, labels: { verdict: t(`network.verdict.${row.values.verdict as "allowed" | "blocked" | "unknown"}`), type: t(`network.hopTypes.${row.values.type as NetworkDiagnostic["engine"]["paths"][number]["hops"][number]["hopType"]}`) } }));
  return <ResultsExplorer scope="hops" title={t("explorer.network")} notice={t("explorer.networkNotice")} rows={rows} columns={[
    { key: "path", label: t("explorer.path") }, { key: "hop", label: t("explorer.hop"), kind: "number" }, { key: "resource", label: t("explorer.resource") }, { key: "type", label: t("explorer.hopType") }, { key: "verdict", label: t("explorer.verdictColumn"), kind: "status" },
  ]} facets={[{ key: "verdict", label: t("explorer.verdict"), chart: true, labels: { allowed: t("network.verdict.allowed"), blocked: t("network.verdict.blocked"), unknown: t("network.verdict.unknown") } }, { key: "type", label: t("explorer.hopType"), labels: Object.fromEntries(rows.map(row => [String(row.values.type), row.labels.type])) }, { key: "path", label: t("explorer.path") }]}/>;
}
export function ActualCostExplorer({ cost, scope, labels }: { cost: ActualCost; scope: string; labels: Record<string, string> }) {
  const { t, locale } = useI18n();
  const signLabels = { positive: t("explorer.positive"), negative: t("explorer.negative"), zero: t("explorer.zero") };
  const rows = cost.rows.map((row, index) => {
    const sign = row.amount > 0 ? "positive" : row.amount < 0 ? "negative" : "zero";
    const resource = row.attribution.resourceId;
    return {
      id: String(index),
      values: { resource, subscription: row.subscriptionId, currency: row.currency, sign, amount: row.amount },
      labels: {
        resource: resource ? labels[resource] ?? resource : t("assessment.ui.unattributed"),
        sign: signLabels[sign],
        amount: `${row.currency} ${formatNumber(row.amount, locale, { maximumSignificantDigits: 17 })}`,
      },
    };
  });
  const resourceLabels = Object.fromEntries(rows.map(row => [String(row.values.resource ?? ""), row.labels.resource]));
  const resource = { key: "resource", label: t("explorer.resource") };
  const amount = { key: "amount", label: t("explorer.amount"), kind: "number", width: 140 } as const;
  const currency = { key: "currency", label: t("explorer.currency"), width: 112 };
  const sign = { key: "sign", label: t("explorer.sign"), width: 152 };
  const subscription = { key: "subscription", label: t("inventory.table.subscription"), kind: "identifier" } as const;
  return <ResultsExplorer scope={scope} title={t("explorer.actualCost")} notice={t("explorer.costNotice")} rows={rows}
    layout="billing" columns={[resource, amount, currency, sign, subscription]} csvColumns={[resource, subscription, currency, sign, amount]}
    facets={[{ key: "currency", label: currency.label }, { key: "sign", label: sign.label, labels: signLabels }, { key: "resource", label: resource.label, labels: resourceLabels }]} summary={select => <div className="grid min-w-0 gap-4 sm:grid-cols-2">{signedCostGroups(cost.rows).map(group => {
    const max = Math.max(...group.rows.map(row => Math.abs(row.amount)));
    return <section key={`${group.currency}:${group.sign}`} className="min-w-0 rounded-lg border border-hairline p-3">
      <h4 className="mb-3 text-sm font-semibold">{group.currency} · {signLabels[group.sign]}</h4>
      <ol className="max-h-56 space-y-2 overflow-y-auto p-1">{group.rows.map((row, index) => {
        const resource = row.attribution.resourceId ?? "";
        const label = resource ? labels[resource] ?? resource : t("assessment.ui.unattributed");
        const amount = formatNumber(row.amount, locale, { maximumSignificantDigits: 17 });
        return <li key={index}><button type="button" onClick={() => select({ resource, currency: group.currency, sign: group.sign })} aria-label={t("explorer.costDrill", { resource: label, currency: group.currency, amount })} className="w-full space-y-1 rounded p-2 text-left text-xs hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink">
          <span className="block [overflow-wrap:anywhere]">{label}</span><span className="block tabular-nums">{amount}</span>
          <span aria-hidden="true" className="block h-2 rounded bg-surface-2"><span className="block h-2 rounded bg-ink" style={{ width: `${max ? Math.abs(row.amount) / max * 100 : 0}%` }}/></span>
        </button></li>;
      })}</ol>
    </section>;
  })}</div>}/>;
}

export type ComparisonOption = { id: string; title: string; cost: number | null; components: number; reference: string; costState?: string; reuse?: { reused: number; newItems: number; increases: number } };
export function OptionMatrix({ options }: { options: ComparisonOption[] }) {
  const { t, locale } = useI18n();
  return <section className="min-w-0 space-y-3"><h3 className="text-lg font-semibold text-ink">{t("explorer.comparison")}</h3><div tabIndex={0} role="region" aria-label={t("explorer.comparison")} className="relative overflow-x-auto rounded-xl border border-hairline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"><table className="w-full border-collapse text-left text-sm"><caption className="sr-only">{t("explorer.comparison")}</caption><thead className="bg-surface-2"><tr><th className="sticky left-0 z-10 min-w-28 bg-surface-2 p-3" scope="col">{t("explorer.option")}</th>{options.map(option => <th key={option.id} className="min-w-40 p-3 align-top" scope="col">{option.title}</th>)}</tr></thead><tbody>
    <tr className="border-t border-hairline"><th scope="row" className="sticky left-0 z-10 min-w-28 border-r border-hairline bg-surface-1 p-3 font-medium">{t("explorer.monthly")}</th>{options.map(option => <td key={option.id} className="p-3 align-top tabular-nums">{option.cost === null ? t("explorer.missing") : formatMoney(option.cost, "CAD", locale, { maximumFractionDigits: 2 })}{option.costState && <span className="block text-xs text-muted">{option.costState}</span>}</td>)}</tr>
    <tr className="border-t border-hairline"><th scope="row" className="sticky left-0 z-10 min-w-28 border-r border-hairline bg-surface-1 p-3 font-medium">{t("explorer.services")}</th>{options.map(option => <td key={option.id} className="p-3 tabular-nums">{formatNumber(option.components, locale)}</td>)}</tr>
    {options.some(option => option.reuse) && <tr className="border-t border-hairline"><th scope="row" className="sticky left-0 z-10 min-w-28 border-r border-hairline bg-surface-1 p-3 font-medium">{t("explorer.reuse")}</th>{options.map(option => <td key={option.id} className="p-3 tabular-nums">{option.reuse ? `${option.reuse.reused} / ${option.reuse.newItems} / ${option.reuse.increases}` : t("explorer.missing")}</td>)}</tr>}
    <tr className="border-t border-hairline"><th scope="row" className="sticky left-0 z-10 min-w-28 border-r border-hairline bg-surface-1 p-3 font-medium">{t("explorer.reference")}</th>{options.map(option => <td key={option.id} className="break-words p-3 align-top">{option.reference}</td>)}</tr>
  </tbody></table></div></section>;
}
