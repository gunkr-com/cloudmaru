import Link from "next/link";
import { notFound } from "next/navigation";
import { AssessmentTopology } from "@/components/assessment/assessment-topology";
import { assessmentTopology, topologyChecks } from "@/lib/assessment/topology";
import { firstIssuesSummary } from "@/lib/assessment/first-summary";
import { isDemoMode } from "@/services/demo-mode";
import { AssessmentResultView } from "@/components/assessment/assessment-result";
import { AssessmentStatus, AssessmentCompletionFocus } from "@/components/assessment/assessment-status";
import { RoadmapPanel } from "@/components/assessment-roadmap/roadmap-panel";
import { LocalTime } from "@/components/ui/local-time";
import { getI18n } from "@/i18n/server";
import { isAssessmentStale, ASSESSMENT_STALE_MS } from "@/lib/assessment/app/job";
import { getCurrentWorkspace } from "@/services/current-workspace";
import { getWorkspace } from "@/services/db/workspaces";
import { getAssessment, failAssessment, getAssessmentCatalogData } from "@/services/db/assessments";
import { getScanInventory } from "@/services/db/scans";
import { withSiteName } from "@/lib/dashboard/page-titles";
import { roadmapJobs } from "@/services/assessment-roadmap";

export async function generateMetadata() { const { t } = await getI18n(); return { title: withSiteName(t("assessment.title")) }; }
export default async function AssessmentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let record = await getAssessment(id);
  if (!record) notFound();
  if (isAssessmentStale(record,new Date())) {
    await failAssessment(id, "interrupted");
    record = await getAssessment(id);
    if (!record) notFound();
  }
  const [{ t, locale }, current, owner] = await Promise.all([getI18n(), getCurrentWorkspace(), getWorkspace(record.workspaceId)]);
  const mismatch = current.id !== record.workspaceId;
  const inventories = record.status === "succeeded" ? await Promise.all([getScanInventory(record.sourceScanId), record.previousScanId ? getScanInventory(record.previousScanId) : null]) : [];
  // Project only display labels and configuration links from the assessment’s source scan.
  const topology = inventories[0] ? assessmentTopology(inventories[0]) : { nodes: [], edges: [] };
  const resourceLabels = Object.fromEntries(inventories.toReversed().flatMap(inventory => inventory?.resources.map(resource => [resource.id, resource.name]) ?? []));
  const catalogData = record.status === "succeeded" ? await getAssessmentCatalogData(record.id) : null;
  if(record.status === "succeeded" && catalogData === null) notFound();
  // 로드맵 근거/상태 조회 실패는 저장된 로컬 결과와 보고서 진입을 가리지 않는다.
  const roadmap = record.status === "succeeded" && record.result
    ? await roadmapJobs.get(record.id, current.id).catch(() => null) : null;
  const retryQuery = new URLSearchParams({ sourceScanId: record.sourceScanId });
  if (record.previousScanId) retryQuery.set("previousScanId", record.previousScanId);
  return <div className="min-w-0 space-y-8">
    <header className="space-y-3"><p className="break-words text-xs uppercase text-subtle">{owner?.name ?? record.workspaceId}</p><h1 id="assessment-heading" tabIndex={-1} className="text-[32px] font-bold text-ink">{t("assessment.title")}</h1><p><LocalTime value={record.createdAt} format="datetime" /> · {t(`assessment.status.${record.status}`)}</p><Link className="inline-block min-h-6 break-all underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink" href={`/inventory/scans/${record.sourceScanId}`}>{t("assessment.sourceScan", { id: record.sourceScanId })}</Link></header>
    {mismatch && <aside className="space-y-3"><p>{t("assessment.otherWorkspace", { name: owner?.name ?? record.workspaceId })}</p><p>{t("assessment.ui.mismatch")}</p><Link className="inline-block min-h-6 underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink" href="/assessments/new">{t("assessment.ui.safeNew")}</Link></aside>}
    {record.status === "pending" ? <AssessmentStatus id={id} startedAt={Date.parse(record.createdAt)} expiresAt={Date.parse(record.createdAt) + ASSESSMENT_STALE_MS} /> : <AssessmentCompletionFocus id={id} />}
    {record.status === "failed" && <div role="alert" className="space-y-2 text-warning"><p>{t("assessment.ui.failed")}</p>{record.error && <p>{t(`assessment.reasons.${record.error.code}`)}</p>}</div>}
    {record.status === "succeeded" && record.result && catalogData && <>
      <Link prefetch={false} className="inline-block min-h-10 rounded-lg border border-control px-4 py-2 font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
        href={`/assessments/${record.id}/report?lang=${locale}&scope=summary`}>{t("reports.viewReport")}</Link>
      <AssessmentTopology topology={topology} checks={topologyChecks(record.result.local.findings, catalogData, locale)}
        summary={firstIssuesSummary(record.result)} demo={isDemoMode()} />
    </>}
    {record.status === "succeeded" && record.result && <AssessmentResultView result={record.result} resourceLabels={resourceLabels} catalogData={catalogData ?? undefined} />}
    {record.status === "succeeded" && record.result && <>
      {roadmap ? <RoadmapPanel initial={roadmap} disabled={mismatch} /> : <p role="status">{t("assessmentRoadmap.errors.unavailable")}</p>}
      <section aria-labelledby="assessment-report-heading" className="min-w-0 space-y-3">
        <h2 id="assessment-report-heading" className="text-xl font-semibold text-ink">{t("assessmentRoadmap.report.title")}</h2>
        <p className="text-sm text-muted">{t("assessmentRoadmap.report.notice")}</p>
        <div className="flex flex-wrap gap-4">
          <Link prefetch={false} className="inline-block min-h-6 underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink" href={`/assessments/${record.id}/report?lang=${locale}`}>{t("assessmentRoadmap.report.title")}</Link>
          <a className="inline-block min-h-6 underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink" href={`/api/assessments/${record.id}/report?format=markdown&lang=${locale}`}>{t("assessmentRoadmap.download")}</a>
        </div>
      </section>
    </>}
    {record.status !== "pending" && !mismatch && <Link className="inline-block min-h-6 underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink" href={`/assessments/new?${retryQuery}`}>{t("assessment.ui.retry")}</Link>}
    <div><Link className="inline-block min-h-6 underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink" href="/assessments">{t("assessment.ui.history")}</Link></div>
  </div>;
}
