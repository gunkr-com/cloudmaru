import { InventoryExplorer } from "@/components/results-explorer/saved-explorers";
import { inventoryRows } from "@/lib/results-explorer/adapters";
import { TextWithLocalTime } from "@/components/ui/local-time";
import { cache } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { InventorySummaryTiles } from "@/components/inventory/inventory-summary-tiles";
import { UnreadSubscriptions } from "@/components/inventory/unread-subscriptions";
import { ScanPending } from "@/components/inventory/scan-pending";
import { ScanStatusPoller, ScanCompletionFocus } from "@/components/inventory/scan-status-poller";
import { ScanFailed } from "@/components/inventory/scan-failed";
import { ResourceTable } from "@/components/inventory/resource-table";
import { getI18n } from "@/i18n/server";
import { formatNumber } from "@/i18n/format";
import { pluralKey } from "@/i18n/translate";
import { withSiteName } from "@/lib/dashboard/page-titles";
import { parseResourceTableQuery, queryInventoryResources } from "@/lib/inventory/resource-table";
import { familiesByStage } from "@/lib/inventory/view";
import { resolveScanStatus } from "@/lib/scans/timing";
import { getCurrentWorkspace } from "@/services/current-workspace";
import { getScan, getScanInventory } from "@/services/db/scans";
import { getWorkspace } from "@/services/db/workspaces";

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const getCachedScan = cache(getScan);

export async function generateMetadata({ params }: Pick<PageProps, "params">): Promise<Metadata> {
  const { id } = await params;
  const { t } = await getI18n();
  if (!uuidPattern.test(id)) return { title: withSiteName(t("inventory.titles.scanNotFound")) };
  try {
    const record = await getCachedScan(id);
    const scan = record ? resolveScanStatus(record, new Date()) : null;
    const key = !scan ? "inventory.titles.scanNotFound" : scan.status === "pending" ? "inventory.titles.scanPending" : scan.status === "failed" || !scan.summary ? "inventory.titles.scanFailed" : "inventory.titles.scan";
    return { title: withSiteName(t(key)) };
  } catch { return {}; }
}

export default async function ScanPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  if (!uuidPattern.test(id)) notFound();
  const record = await getCachedScan(id);
  if (!record) notFound();
  const scan = resolveScanStatus(record, new Date());
  const [{ locale, t }, currentWorkspace, workspace] = await Promise.all([getI18n(), getCurrentWorkspace(), getWorkspace(scan.workspaceId)]);
  const isCurrentWorkspace = currentWorkspace.id === scan.workspaceId;
  const inventory = scan.status === "succeeded" ? await getScanInventory(id) : null;
  const failed = scan.status === "failed" || (scan.status === "succeeded" && (!inventory || !scan.summary));
  const titleKey = failed ? "inventory.titles.scanFailed" : scan.status === "pending" ? "inventory.titles.scanPending" : "inventory.titles.scan";
  const query = parseResourceTableQuery(await searchParams);
  const data = inventory && !failed ? queryInventoryResources(inventory, query) : null;
  const effectiveQuery = data ? { ...query, type: data.appliedType, page: data.page } : query;

  return <div className="min-w-0 space-y-10">
    <header className="space-y-3">
      <p className="text-xs font-semibold uppercase tracking-[0.6px] text-subtle"><TextWithLocalTime text={t("inventory.detail.eyebrow")} value={scan.createdAt} format="datetime" /></p>
      <h1 id="scan-heading" tabIndex={-1} className="text-[32px] font-bold leading-[1.18] tracking-[-0.8px] text-ink">{t(titleKey)}</h1>
      <p className="text-sm text-muted">{t(scan.source === "live" ? "inventory.source.live" : "inventory.source.import")}</p>
      <Link href="/inventory" className="inline-flex min-h-8 items-center text-sm text-ink underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink">{t("inventory.connection.form.goToInventory")}</Link>
    </header>
    {!isCurrentWorkspace && <p className="break-words text-sm leading-[1.7] text-body">{t("inventory.detail.otherWorkspace", { name: workspace?.name ?? scan.workspaceId })}</p>}
    {scan.status === "pending" ? <>
      <ScanPending createdAt={scan.createdAt} />
      <ScanStatusPoller id={scan.id} createdAt={scan.createdAt} />
    </> : <ScanCompletionFocus id={scan.id} />}
    {failed && <ScanFailed workspaceId={scan.workspaceId} source={scan.source} errorCode={scan.status === "failed" ? scan.errorCode : "internal"} isCurrentWorkspace={isCurrentWorkspace} />}
    {!failed && inventory && scan.summary && data && <>
      {isCurrentWorkspace && scan.summary.resourceCount > 0 && <nav aria-label={t("inventory.actions.analyzeScan")} className="flex flex-wrap gap-4">
        <Link href={`/assessments/new?sourceScanId=${scan.id}`} className="inline-flex min-h-9 items-center underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink">{t("assessment.ui.new")}</Link>
        <Link href={`/network?scan=${scan.id}`} className="inline-flex min-h-9 items-center underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink">{t("network.title")}</Link>
        <Link href={`/extensions/new?sourceScanId=${scan.id}`} className="inline-flex min-h-9 items-center underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink">{t("extension.ui.new")}</Link>
      </nav>}
      <section className="space-y-5">
        <InventorySummaryTiles summary={scan.summary} />
        <UnreadSubscriptions subscriptionIds={scan.subscriptionIds} summary={scan.summary} />
        {inventory.skippedRows > 0 && <p className="text-sm text-muted">{t(pluralKey(inventory.skippedRows, "inventory.summary.skippedOne", "inventory.summary.skipped"), { count: formatNumber(inventory.skippedRows, locale) })}</p>}
      </section>
      <InventoryExplorer rows={inventoryRows(inventory.resources)}/>
      <section className="space-y-5">
        <h2 className="text-xs font-semibold uppercase tracking-[0.6px] text-subtle">{t("inventory.detail.families")}</h2>
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {familiesByStage(inventory.resources).map(({ stage, families }) => <section key={stage} className="min-w-0 space-y-3 rounded-xl border border-hairline bg-surface-1 p-5">
            <h3 className="text-sm font-semibold text-ink">{t(`inventory.stages.${stage}`)}</h3>
            <ul className="space-y-2 text-sm text-body">{families.map(({ family, count }) => <li key={family} className="flex flex-wrap justify-between gap-x-4 gap-y-1">
              <span>{t(`inventory.families.${family}`)}</span>
              <span className="tabular-nums text-muted">{t(pluralKey(count, "inventory.detail.familyCountOne", "inventory.detail.familyCount"), { count: formatNumber(count, locale) })}</span>
            </li>)}</ul>
          </section>)}
        </div>
      </section>
      <details className="min-w-0 space-y-4"><summary className="min-h-10 cursor-pointer text-sm underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink">{t("explorer.details")}</summary><ResourceTable scanId={scan.id} query={effectiveQuery} data={data} /></details>
    </>}
  </div>;
}
