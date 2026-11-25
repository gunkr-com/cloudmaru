import Link from "next/link";
import { ExtensionHistory } from "@/components/extend/extension-history";
import { getI18n } from "@/i18n/server";
import { extensionHistoryCursor, parseExtensionHistoryCursor } from "@/lib/extend-app/history-cursor";
import { withSiteName } from "@/lib/dashboard/page-titles";
import { getCurrentWorkspace } from "@/services/current-workspace";
import { extensionJobs } from "@/services/extension-job";

export async function generateMetadata() { const { t } = await getI18n(); return { title: withSiteName(t("extension.ui.history")) }; }
export default async function ExtensionHistoryPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> } = {}) {
  const [{ t }, workspace] = await Promise.all([getI18n(), getCurrentWorkspace()]);
  const query = await searchParams ?? {};
  const cursor = parseExtensionHistoryCursor(query.before, workspace.id);
  let records: Awaited<ReturnType<typeof extensionJobs.list>> = [];
  let problem = !cursor.valid;
  if (cursor.valid) {
    // One lookahead row bounds every read, while the service retains stale recovery.
    try { records = await extensionJobs.list(workspace.id, { limit: 21, ...(cursor.beforeId ? { beforeId: cursor.beforeId } : {}) }); }
    catch (error) { if (!cursor.beforeId) throw error; problem = true; }
  }
  const visible = records.slice(0, 20);
  const older = records.length > 20 ? extensionHistoryCursor(workspace.id, visible.at(-1)!.id) : null;
  const items = visible.map(record => ({
    workspaceId: record.workspaceId, id: record.id, status: record.status, sourceScanId: record.sourceScanId, createdAt: record.createdAt,
    description: record.input.description, title: record.result?.requestTitle ?? null, errorCode: record.error?.code ?? null,
  }));
  return <section className="min-w-0 space-y-8">
    <header className="space-y-3"><p className="break-words text-xs uppercase text-subtle">{workspace.name}</p><h1 className="text-[32px] font-bold text-ink">{t("extension.ui.history")}</h1>
      <Link href="/extensions/new" className="inline-block min-h-10 rounded-lg bg-ink px-4 py-2 text-canvas focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink">{t("extension.ui.new")}</Link>
    </header>
    {problem ? <p role="alert" className="text-warning">{t("extension.ui.historyUnavailable")}</p> : <ExtensionHistory items={items} />}
    {(query.before !== undefined || older || problem) && <nav aria-label={t("extension.ui.historyNavigation")} className="flex flex-wrap gap-6">
      {(query.before !== undefined || problem) && <Link href="/extensions" className="inline-block min-h-6 underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink">{t("extension.ui.latest")}</Link>}
      {older && <Link href={`/extensions?before=${encodeURIComponent(older)}`} className="inline-block min-h-6 underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink">{t("extension.ui.older")}</Link>}
    </nav>}
  </section>;
}
