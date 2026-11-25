import Form from "next/form";
import Link from "next/link";
import { getI18n } from "@/i18n/server";
import { formatNumber } from "@/i18n/format";
import { pluralKey } from "@/i18n/translate";
import type { ResourceTablePage, ResourceTableQuery } from "@/types/inventory";

export async function ResourceTable({ scanId, query, data }: { scanId: string; query: ResourceTableQuery; data: ResourceTablePage }) {
  const { locale, t } = await getI18n();
  const path = `/inventory/scans/${encodeURIComponent(scanId)}`;
  const type = data.appliedType;
  const pageHref = (page: number) => {
    const params = new URLSearchParams();
    if (query.q) params.set("q", query.q);
    if (type) params.set("type", type);
    params.set("page", String(page));
    return `${path}?${params}`;
  };
  const controlClass = "min-h-10 w-full min-w-0 rounded-lg border border-control bg-canvas p-3 text-sm text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink";
  const linkClass = "inline-flex min-h-8 items-center text-sm text-ink underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink";
  return <section className="min-w-0 space-y-5">
    <h2 className="text-xs font-semibold uppercase tracking-[0.6px] text-subtle">{t("inventory.table.title")}</h2>
    {/* Client navigation keeps this document on back/forward, and the key remounts the fields to the current URL.
        A native GET submit reloaded the document and the browser restored the fields typed before leaving.
        autoComplete off stops that restore on reload; prefetch off because the action is this page without filters. */}
    <Form key={`${query.q}\n${type ?? ""}`} action={path} prefetch={false} autoComplete="off" className="grid min-w-0 items-end gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
      <label className="min-w-0 space-y-2 text-sm text-body">
        <span>{t("inventory.table.search")}</span>
        <input type="search" name="q" maxLength={200} defaultValue={query.q} className={controlClass} />
      </label>
      <label className="min-w-0 space-y-2 text-sm text-body">
        <span>{t("inventory.table.type")}</span>
        <select name="type" defaultValue={type ?? ""} className={controlClass}>
          <option value="">{t("inventory.table.allTypes")}</option>
          {data.types.map(item => <option key={item.type} value={item.type}>{item.type} ({formatNumber(item.count, locale)})</option>)}
        </select>
      </label>
      <button type="submit" className="min-h-10 rounded-lg bg-surface-2 px-[18px] py-3 text-sm font-semibold text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink">{t("inventory.table.apply")}</button>
    </Form>
    {data.matched > 0 && <p className="text-sm tabular-nums text-muted">{t(pluralKey(data.matched, "inventory.table.matchedOne", "inventory.table.matched"), { from: formatNumber(data.from, locale), to: formatNumber(data.to, locale), matched: formatNumber(data.matched, locale) })}</p>}
    {!data.matched ? <p className="text-sm text-body">{t("inventory.table.noMatch")}</p> : <div className="relative max-w-full overflow-x-auto rounded-xl border border-hairline bg-surface-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink" tabIndex={0} role="region" aria-label={t("inventory.table.title")}>
      <table className="w-full min-w-[900px] border-collapse text-left text-sm text-body">
        <caption className="sr-only">{t("inventory.table.title")}</caption>
        <thead className="border-b border-border-strong text-xs font-semibold uppercase tracking-[0.6px] text-subtle">
          <tr>
            <th scope="col" className="sticky left-0 z-10 bg-surface-1 px-4 py-3">{t("inventory.table.name")}</th>
            {(["type", "resourceGroup", "region", "subscription", "tags"] as const).map(key => <th key={key} scope="col" className="px-4 py-3">{t(`inventory.table.${key}`)}</th>)}
          </tr>
        </thead>
        <tbody>{data.rows.map(row => <tr key={row.id} className="border-b border-border-row last:border-0">
          <th scope="row" title={row.id} className="sticky left-0 z-10 max-w-64 break-all bg-surface-1 px-4 py-3 font-medium text-ink">{row.name}</th>
          <td className="px-4 py-3 font-mono text-xs">{row.type}</td>
          <td className="px-4 py-3">{row.resourceGroup}</td>
          <td className="px-4 py-3">{row.location ?? t("inventory.table.noRegion")}</td>
          <td className="px-4 py-3">{row.subscriptionName ?? row.subscriptionId.slice(0, 8)}</td>
          <td className="px-4 py-3 tabular-nums">{row.tagCount ? t(pluralKey(row.tagCount, "inventory.table.tagCountOne", "inventory.table.tagCount"), { count: formatNumber(row.tagCount, locale) }) : t("inventory.table.noTags")}</td>
        </tr>)}</tbody>
      </table>
    </div>}
    {data.matched > 0 && <nav aria-label={t("inventory.table.page", { page: formatNumber(data.page, locale), pages: formatNumber(data.pageCount, locale) })} className="flex flex-wrap items-center gap-x-5 gap-y-2">
      {data.page > 1 && <Link href={pageHref(data.page - 1)} className={linkClass}>{t("inventory.table.previous")}</Link>}
      <span className="text-sm tabular-nums text-muted">{t("inventory.table.page", { page: formatNumber(data.page, locale), pages: formatNumber(data.pageCount, locale) })}</span>
      {data.page < data.pageCount && <Link href={pageHref(data.page + 1)} className={linkClass}>{t("inventory.table.next")}</Link>}
    </nav>}
  </section>;
}
