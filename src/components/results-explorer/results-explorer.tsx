"use client";
import styles from "./results-explorer.module.css";
import { Fragment, useState, useRef, useSyncExternalStore, type ReactNode } from "react";
import { useI18n } from "@/i18n/provider";
import { formatNumber } from "@/i18n/format";
import { countValues, csvDocument, exploreRows, readExplorerState, writeExplorerState, type ExplorerRow, type ExplorerState } from "@/lib/results-explorer/explorer";
export type ExplorerColumn = { key: string; label: string; kind?: "text" | "identifier" | "status" | "number"; width?: number };
const columnWidth = (column: ExplorerColumn) => column.width ?? (column.kind === "status" ? 128 : column.kind === "number" ? 144 : column.kind === "identifier" ? 208 : 192);
export type ExplorerFacet = { key: string; label: string; chart?: boolean; values?: string[]; labels?: Record<string, string> };
const eventName = "cloudsight-explorer-change";
const subscribe = (callback: () => void) => { window.addEventListener("popstate", callback); window.addEventListener(eventName, callback); return () => { window.removeEventListener("popstate", callback); window.removeEventListener(eventName, callback); }; };
const snapshot = () => window.location.search;
const serverSnapshot = () => "";
const focus = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink";
const control = `min-h-10 w-full min-w-0 rounded-lg border border-control bg-canvas p-2.5 text-sm text-ink ${focus}`;
function missingValue(values: string[]) { let value = "__unobserved__"; while (values.includes(value)) value += "_"; return value; }
export function ResultsExplorer({ scope, title, rows, columns, facets = [], renderFirstCell, renderDetails, notice, defaultSort, emptyMessage, allLabel, summary, layout, csvColumns = columns }: {
  scope: string; title: string; rows: ExplorerRow[]; columns: ExplorerColumn[]; facets?: ExplorerFacet[];
  layout?: "billing"; csvColumns?: ExplorerColumn[];
  renderDetails?: (row: ExplorerRow) => ReactNode;
  renderFirstCell?: (row: ExplorerRow) => ReactNode; notice?: string; defaultSort?: string; emptyMessage?: string; allLabel?: string; summary?: (select: (filters: Record<string, string>) => void) => ReactNode;
}) {
  const { t, locale } = useI18n(); const table = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  function toggle(id: string) { setExpanded(previous => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next; }); }
  const search = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const choices = Object.fromEntries(facets.map(facet => [facet.key, (facet.values ?? countValues(rows, facet.key).map(item => item.value))]));
  const state = readExplorerState(new URLSearchParams(search), scope, [...(defaultSort ? [defaultSort] : []), ...columns.map(column => column.key)], choices);
  const result = exploreRows(rows, state);
  const number = (value: number) => formatNumber(value, locale, { maximumSignificantDigits: 17 });
  function update(patch: Partial<ExplorerState>, replace = false) {
    const url = new URL(window.location.href); const params = writeExplorerState(url.searchParams, scope, { ...state, page: 1, ...patch });
    window.history[replace ? "replaceState" : "pushState"](null, "", `${url.pathname}${params.size ? `?${params}` : ""}${url.hash}`);
    window.dispatchEvent(new Event(eventName));
  }
  function filter(key: string, value: string | null) {
    const filters = { ...state.filters }; if (value === null) delete filters[key]; else filters[key] = value;
    update({ filters });
  }
  function exportCsv() {
    const csv = csvDocument(csvColumns.map(column => column.label), result.all.map(row => csvColumns.map(column => row.values[column.key] ?? null)));
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = `${scope}-filtered.csv`; link.click(); URL.revokeObjectURL(url);
  }
  return <section aria-label={title} className="min-w-0 space-y-5 rounded-xl border border-hairline bg-surface-1 p-4 sm:p-6">
    <header className="flex flex-wrap items-start justify-between gap-3"><h3 className="text-lg font-semibold tracking-tight text-ink">{title}</h3><button type="button" disabled={!result.matched} onClick={exportCsv} className={`min-h-10 rounded-lg border border-control px-3 text-sm font-medium disabled:opacity-50 ${focus}`}>{t("explorer.csv")}</button></header>
    {summary?.(filters => { update({ filters: { ...state.filters, ...filters } }); document.getElementById(`${scope}-table`)?.focus(); })}
    {notice && <p className="text-sm leading-relaxed text-muted">{notice}</p>}
    {facets.some(facet => facet.chart) && <div className="space-y-3"><p className="text-xs leading-relaxed text-muted">{t("explorer.chartNotice")}</p><div className="grid min-w-0 gap-4 md:grid-cols-2">{facets.filter(facet => facet.chart).map(facet => <section key={facet.key} className="min-w-0 space-y-2 rounded-lg border border-hairline p-3"><h4 className="text-sm font-medium text-ink">{facet.label}</h4><ul className="max-h-64 space-y-1 overflow-y-auto p-1">{countValues(rows, facet.key).map(item => {
      const label = facet.labels?.[item.value] ?? (item.value || t("explorer.missing"));
      return <li key={item.value}><button type="button" aria-pressed={state.filters[facet.key] === item.value} className={`w-full rounded-md p-2 text-left hover:bg-surface-2 aria-pressed:bg-surface-2 ${focus}`} onClick={() => { filter(facet.key, item.value); table.current?.focus(); }} aria-label={t("explorer.drill", { label, count: number(item.count), total: number(rows.length) })}>
        <span className="flex min-w-0 items-start justify-between gap-3 text-xs"><span className="min-w-0 break-all">{label}</span><span className="shrink-0 tabular-nums text-muted">{number(item.count)} / {number(rows.length)}</span></span>
        <span aria-hidden="true" className="mt-1.5 block h-2 overflow-hidden rounded-full bg-surface-2"><span className="block h-full rounded-full bg-ink" style={{ width: `${rows.length ? item.count / rows.length * 100 : 0}%` }}/></span>
      </button></li>;
    })}</ul></section>)}</div></div>}
    <div className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-3"><label className="min-w-0 space-y-1.5 text-sm"><span>{t("explorer.search")}</span><input type="search" maxLength={200} value={state.q} onChange={event => update({ q: event.target.value }, true)} className={control}/></label>
      {facets.map(facet => <label key={facet.key} className="min-w-0 space-y-1.5 text-sm"><span>{facet.label}</span><select value={facet.key in state.filters ? state.filters[facet.key] || missingValue(choices[facet.key]) : ""} onChange={event => filter(facet.key, event.target.value === "" ? null : event.target.value === missingValue(choices[facet.key]) ? "" : event.target.value)} className={control}>
        <option value="">{allLabel ?? t("explorer.all")}</option>{choices[facet.key].map(value => <option key={value} value={value || missingValue(choices[facet.key])}>{facet.labels?.[value] ?? (value || t("explorer.missing"))}</option>)}
      </select></label>)}
    </div>
    <div className="flex flex-wrap items-center justify-between gap-3"><p role="status" className="text-sm tabular-nums text-muted">{t("explorer.count", { matched: number(result.matched), total: number(rows.length) })}</p><button type="button" onClick={() => update({ q: "", filters: {}, sort: defaultSort ?? columns[0].key, direction: "asc", page: 1 })} className={`min-h-9 rounded px-2 text-sm underline underline-offset-4 ${focus}`}>{t("explorer.reset")}</button></div>
    <p id={`${scope}-scroll-hint`} className="text-xs text-muted">{t("explorer.scrollHint")}</p>
    <div id={`${scope}-table`} ref={table} tabIndex={0} role="region" aria-label={title} aria-describedby={`${scope}-scroll-hint`} className={`${styles.viewport} ${focus}`} data-layout={layout} onKeyDown={event => {
      if (event.target !== event.currentTarget || event.altKey || event.ctrlKey || event.metaKey || !["ArrowLeft", "ArrowRight"].includes(event.key)) return;
      event.preventDefault();
      event.currentTarget.scrollLeft += (event.key === "ArrowRight" ? 1 : -1) * Math.max(120, event.currentTarget.clientWidth / 2);
    }}>
      <table className={styles.table} style={{ tableLayout: "fixed", width: `calc(var(--first-column-width) + ${columns.slice(1).reduce((sum, column) => sum + columnWidth(column), 0)}px)` }}>
        <caption className="sr-only">{title}</caption>
        <colgroup>{columns.map((column, index) => <col key={column.key} style={{ width: index === 0 ? "var(--first-column-width)" : columnWidth(column) }}/>)}</colgroup>
        <thead><tr>{columns.map(column => <th key={column.key} scope="col" data-kind={column.kind ?? "text"} aria-sort={state.sort === column.key ? state.direction === "asc" ? "ascending" : "descending" : "none"}>
          <button type="button" aria-label={t("explorer.sort", { column: column.label })} onClick={() => update({ sort: column.key, direction: state.sort === column.key && state.direction === "asc" ? "desc" : "asc" })} className={`inline-flex min-h-9 items-center gap-2 rounded text-left ${focus}`}>
            <span>{column.label}</span><span aria-hidden="true" className="shrink-0 text-muted">{state.sort === column.key ? state.direction === "asc" ? "↑" : "↓" : "↕"}</span>
          </button>
        </th>)}</tr></thead>
        <tbody>{result.rows.map(row => <Fragment key={row.id}><tr data-result-row>{columns.map((column, index) => {
          const value = row.labels?.[column.key] ?? (typeof row.values[column.key] === "number" ? number(row.values[column.key] as number) : row.values[column.key] ?? t("explorer.missing"));
          return <td key={column.key} data-kind={column.kind ?? "text"}>
            {index === 0 && renderDetails ? <button id={`${scope}-toggle-${row.id}`} type="button" aria-expanded={expanded.has(row.id)} aria-controls={`${scope}-details-${row.id}`} onClick={() => toggle(row.id)} className={`min-h-9 w-full rounded text-left font-semibold text-ink ${focus}`}><span aria-hidden="true" className="mr-1.5">{expanded.has(row.id) ? "▾" : "▸"}</span>{value}</button> : index === 0 && renderFirstCell ? renderFirstCell(row) : column.kind === "status" ? <span className={styles.status} data-tone={String(row.values[column.key])}>{value}</span> : value}
          </td>;
        })}</tr>{renderDetails && <tr hidden={!expanded.has(row.id)}><td colSpan={columns.length} className={styles.detailsCell}>
          <div id={`${scope}-details-${row.id}`} role="region" aria-labelledby={`${scope}-toggle-${row.id}`} className={styles.details} onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); setExpanded(previous => { const next = new Set(previous); next.delete(row.id); return next; }); document.getElementById(`${scope}-toggle-${row.id}`)?.focus(); } }}>
            {renderDetails(row)}
          </div>
        </td></tr>}</Fragment>)}</tbody>
      </table>
    </div>
    {!result.matched && <p className="text-sm text-muted">{emptyMessage ?? t("explorer.empty")}</p>}
    {result.pageCount > 1 && <nav aria-label={t("explorer.page", { page: number(result.page), pages: number(result.pageCount) })} className="flex flex-wrap items-center justify-between gap-3 text-sm"><button type="button" disabled={result.page === 1} onClick={() => update({ page: result.page - 1 })} className={`min-h-10 rounded border border-control px-3 disabled:opacity-40 ${focus}`}>{t("explorer.previous")}</button><span>{t("explorer.page", { page: number(result.page), pages: number(result.pageCount) })}</span><button type="button" disabled={result.page === result.pageCount} onClick={() => update({ page: result.page + 1 })} className={`min-h-10 rounded border border-control px-3 disabled:opacity-40 ${focus}`}>{t("explorer.next")}</button></nav>}

  </section>;
}
