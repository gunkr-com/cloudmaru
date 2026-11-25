import Link from "next/link";
import { LocalTime } from "@/components/ui/local-time";
import { getI18n } from "@/i18n/server";
import { getCurrentWorkspace } from "@/services/current-workspace";
import { isAssessmentStale } from "@/lib/assessment/app/job";
import { listAssessments, failAssessment } from "@/services/db/assessments";
import { withSiteName } from "@/lib/dashboard/page-titles";

export async function generateMetadata() { const { t } = await getI18n(); return { title: withSiteName(t("assessment.ui.history")) }; }
export default async function AssessmentHistoryPage() {
  const [{ t }, workspace] = await Promise.all([getI18n(), getCurrentWorkspace()]);
  let records = await listAssessments(workspace.id);
  const now = new Date();
  const stale = records.filter(record => isAssessmentStale(record,now));
  if (stale.length) {
    await Promise.all(stale.map(record => failAssessment(record.id, "interrupted")));
    records = await listAssessments(workspace.id);
  }
  return <div className="min-w-0 space-y-10">
    <header className="space-y-3"><p className="break-words text-xs uppercase text-subtle">{workspace.name}</p><h1 className="text-[32px] font-bold text-ink">{t("assessment.ui.history")}</h1><Link className="inline-block min-h-6 underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink" href="/assessments/new">{t("assessment.ui.new")}</Link></header>
    {!records.length && <p>{t("assessment.ui.emptyHistory")}</p>}
    <ul className="space-y-4">{records.map(record => <li key={record.id}><Link className="block min-w-0 space-y-2 rounded-xl border border-hairline bg-surface-1 p-5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink" href={`/assessments/${record.id}`}><p>{t("assessment.ui.saved")} · <LocalTime value={record.createdAt} format="datetime" /></p><p>{t(`assessment.status.${record.status}`)}</p><p className="break-all text-sm text-muted">{t("assessment.sourceScan", { id: record.sourceScanId })}</p></Link></li>)}</ul>
  </div>;
}
