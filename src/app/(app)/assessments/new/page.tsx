import Link from "next/link";
import { AssessmentForm } from "@/components/assessment/assessment-form";
import { getI18n } from "@/i18n/server";
import { getCurrentWorkspace } from "@/services/current-workspace";
import { listScans } from "@/services/db/scans";
import { withSiteName } from "@/lib/dashboard/page-titles";

export async function generateMetadata() { const { t } = await getI18n(); return { title: withSiteName(t("assessment.ui.new")) }; }
export default async function NewAssessmentPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ t }, workspace, query] = await Promise.all([getI18n(), getCurrentWorkspace(), searchParams]);
  // 실패 스캔이 최신 20개를 채워도 이전 성공 스캔을 선택할 수 있다.
  const scans = (await listScans(workspace.id, { limit: Number.MAX_SAFE_INTEGER }))
    .filter(scan => scan.workspaceId === workspace.id && scan.status === "succeeded" && scan.summary && scan.summary.resourceCount > 0 && scan.collectedAt)
    .sort((a, b) => Date.parse(b.collectedAt!) - Date.parse(a.collectedAt!) || b.id.localeCompare(a.id))
    .map(scan => ({ id: scan.id, collectedAt: scan.collectedAt!, source: scan.source }));
  const initialSource = typeof query.sourceScanId === "string" && scans.some(scan => scan.id === query.sourceScanId) ? query.sourceScanId : "";
  const selected = scans.find(scan => scan.id === initialSource);
  const initialPrevious = typeof query.previousScanId === "string" && selected && scans.some(scan => scan.id === query.previousScanId && Date.parse(scan.collectedAt) < Date.parse(selected.collectedAt)) ? query.previousScanId : "";
  return <div className="min-w-0 max-w-3xl space-y-8">
    <header className="space-y-3"><p className="break-words text-xs uppercase text-subtle">{workspace.name}</p><h1 className="text-[32px] font-bold text-ink">{t("assessment.ui.new")}</h1><p className="text-muted">{t("assessment.localNotice")}</p></header>
    {!scans.length ? <div className="space-y-4"><p>{t("assessment.ui.noScans")}</p><Link className="inline-block min-h-6 underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink" href="/inventory">{t("assessment.ui.inventory")}</Link></div>
      : <AssessmentForm key={workspace.id} workspaceId={workspace.id} scans={scans} initialSource={initialSource} initialPrevious={initialPrevious} />}
    <Link className="inline-block min-h-6 underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink" href="/assessments">{t("assessment.ui.history")}</Link>
  </div>;
}
