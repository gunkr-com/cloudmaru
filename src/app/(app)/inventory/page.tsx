import { TextWithLocalTime } from "@/components/ui/local-time";
import Link from "next/link";
import { InventorySummaryTiles } from "@/components/inventory/inventory-summary-tiles";
import { UnreadSubscriptions } from "@/components/inventory/unread-subscriptions";
import { ScanControls } from "@/components/inventory/scan-controls";
import { ScanHistory } from "@/components/inventory/scan-history";
import { formatNumber } from "@/i18n/format";
import { pluralKey } from "@/i18n/translate";
import { getI18n } from "@/i18n/server";
import { withSiteName } from "@/lib/dashboard/page-titles";
import { scanErrorMessageKey } from "@/lib/scans/error-messages";
import { resolveScanStatus } from "@/lib/scans/timing";
import { checkConnectionCertificate } from "@/services/azure/credential";
import { getCurrentWorkspace } from "@/services/current-workspace";
import { getLatestSucceededScan, listScans } from "@/services/db/scans";
import { getWorkspaceAzureSettings } from "@/services/db/workspace-azure";

export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: withSiteName(t("inventory.titles.inventory")) };
}

export default async function InventoryPage() {
  const [{ locale, t }, workspace] = await Promise.all([getI18n(), getCurrentWorkspace()]);
  const [settings, records, latest] = await Promise.all([
    getWorkspaceAzureSettings(workspace.id), listScans(workspace.id, { limit: 20 }), getLatestSucceededScan(workspace.id),
  ]);
  const now = new Date();
  const scans = records.map(record => resolveScanStatus(record, now));
  const pending = scans.find(scan => scan.status === "pending");
  const connection = settings?.connection;
  const certificate = connection ? await checkConnectionCertificate(connection) : null;
  const linkClass = "inline-flex min-h-8 items-center rounded-md text-sm text-ink underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink";

  return <div className="min-w-0 space-y-10">
    <header className="space-y-3">
      <p className="text-xs font-semibold uppercase tracking-[0.6px] text-subtle">{t("inventory.eyebrow")}</p>
      <h1 className="text-[32px] font-bold leading-[1.18] tracking-[-0.8px] text-ink">{t("inventory.title")}</h1>
      <p className="text-sm leading-[1.7] text-muted">{t("inventory.description")}</p>
    </header>
    <section className="space-y-4 rounded-xl border border-hairline bg-surface-1 p-6 sm:p-8">
      <p className="text-sm text-body">{connection
        ? t(pluralKey(settings.subscriptionIds.length, "inventory.connection.summaryOne", "inventory.connection.summary"), { tenant: connection.tenantId.slice(0, 8) + "…", count: formatNumber(settings.subscriptionIds.length, locale) })
        : t("inventory.connection.notConnected")}</p>
      {certificate && <p className={"text-sm leading-[1.7] " + (certificate.ok ? "text-muted" : "text-warning")}>{certificate.ok
        ? <TextWithLocalTime text={t("inventory.connection.certificateValid")} value={certificate.validTo} format="date" />
        : t(scanErrorMessageKey(certificate.code))}</p>}
      <Link href={"/workspaces/" + workspace.id + "/connection"} className={linkClass}>{t(connection ? "inventory.actions.editConnection" : "inventory.actions.setUpConnection")}</Link>
      <ScanControls workspaceId={workspace.id} canRunScan={!!connection} />
      {pending && <p className="text-sm text-body">{t("inventory.scanRunning")}{" "}
        <Link href={"/inventory/scans/" + pending.id} className={linkClass}>{t("inventory.actions.viewProgress")}</Link>
      </p>}
    </section>
    {latest?.summary && latest.collectedAt && <section className="space-y-5">
      <div className="space-y-2">
        <h2 className="text-xs font-semibold uppercase tracking-[0.6px] text-subtle">{t("inventory.latest.title")}</h2>
        <p className="text-sm text-muted"><TextWithLocalTime text={t("inventory.latest.collected", { source: t(latest.source === "live" ? "inventory.source.live" : "inventory.source.import") })} value={latest.collectedAt} format="datetime" /></p>
      </div>
      <InventorySummaryTiles summary={latest.summary} />
      <UnreadSubscriptions subscriptionIds={latest.subscriptionIds} summary={latest.summary} />
      <Link href={"/inventory/scans/" + latest.id} className={linkClass}>{t("inventory.actions.viewInventory")}</Link>
    </section>}
    <section className="space-y-5">
      <h2 className="text-xs font-semibold uppercase tracking-[0.6px] text-subtle">{t("inventory.history.title")}</h2>
      <ScanHistory scans={scans} />
    </section>
  </div>;
}
