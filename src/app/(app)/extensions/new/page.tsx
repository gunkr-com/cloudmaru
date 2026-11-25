import { acquireOperatorPrices } from "@/services/operator-prices";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ExtensionForm } from "@/components/extend/extension-form";
import { getI18n } from "@/i18n/server";
import { loadExtensionSupportCatalog } from "@/lib/catalog/extension-support";
import { withSiteName } from "@/lib/dashboard/page-titles";
import { getCurrentWorkspace } from "@/services/current-workspace";
import { extensionJobs } from "@/services/extension-job";
import { listScans } from "@/services/db/scans";
import { getWorkspace } from "@/services/db/workspaces";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };
const link = "inline-block min-h-6 underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink";
export async function generateMetadata() { const { t } = await getI18n(); return { title: withSiteName(t("extension.ui.new")) }; }
export default async function NewExtensionPage({ searchParams }: Props) {
  const [{ t }, workspace, query] = await Promise.all([getI18n(), getCurrentWorkspace(), searchParams]);
  if (query.from !== undefined && typeof query.from !== "string" || query.sourceScanId !== undefined && typeof query.sourceScanId !== "string") notFound();
  const from = typeof query.from === "string" ? query.from : undefined;
  const source = from !== undefined ? await extensionJobs.get(from) : null;
  if (from !== undefined && !source) notFound();
  if (source && query.sourceScanId !== undefined && query.sourceScanId !== source.sourceScanId) notFound();
  if (source && source.workspaceId !== workspace.id) {
    const owner = await getWorkspace(source.workspaceId);
    if (!owner) notFound();
    return <section className="min-w-0 max-w-3xl space-y-5">
      <h1 className="text-[32px] font-bold text-ink">{t("extension.ui.rerun")}</h1>
      <p role="alert" className="break-words text-warning">{t("extension.ui.foreignRerun", { name: owner.name })}</p>
      <p className="break-all">{t("extension.sourceScan", { id: source.sourceScanId })}</p>
      <div className="flex flex-wrap gap-4"><Link className={link} href="/workspaces">{t("extension.ui.workspaces")}</Link><Link className={link} href={`/extensions/${source.id}`}>{t("extension.ui.original")}</Link><Link className={link} href="/extensions/new">{t("extension.ui.startCurrent")}</Link></div>
    </section>;
  }
  const scans = (await listScans(workspace.id, { limit: Number.MAX_SAFE_INTEGER }))
    .filter(scan => scan.workspaceId === workspace.id && scan.status === "succeeded" && scan.summary && scan.summary.resourceCount > 0 && scan.collectedAt)
    .sort((a, b) => Date.parse(b.collectedAt!) - Date.parse(a.collectedAt!) || b.id.localeCompare(a.id))
    .map(scan => ({ id: scan.id, collectedAt: scan.collectedAt!, source: scan.source }));
  const pricing = await acquireOperatorPrices();
  const regions = loadExtensionSupportCatalog().regions;
  return <section className="min-w-0 max-w-3xl space-y-8">
    <header className="space-y-3"><p className="break-words text-xs uppercase text-subtle">{workspace.name}</p><h1 className="text-[32px] font-bold text-ink">{t(source ? "extension.ui.rerun" : "extension.ui.new")}</h1>
      {source && <Link href={`/extensions/${source.id}`} className={link}>{t("extension.ui.original")}</Link>}
    </header>
    {!pricing.ok && <p role="status" className="text-sm text-warning">{t("pricing.unavailable")}</p>}
    {!scans.length && <div className="space-y-3"><p>{t("extension.ui.noScans")}</p><Link className={link} href="/inventory">{t("extension.ui.inventory")}</Link></div>}
    {(scans.length > 0 || source) && <ExtensionForm key={source?.id ?? "new"} workspaceId={workspace.id} defaultRegion={workspace.defaultRegion} regions={regions} scans={scans} initialScanId={typeof query.sourceScanId === "string" ? query.sourceScanId : undefined} initialInput={source?.input} sourceExtensionId={source?.id} />}
    <Link href="/extensions" className={link}>{t("extension.ui.history")}</Link>
  </section>;
}
