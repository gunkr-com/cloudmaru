import Link from "next/link";
import { notFound } from "next/navigation";
import { formatMonthlyMoney } from "@/i18n/format";
import { EXPECTED_USERS_OPTIONS, AVAILABILITY_OPTIONS } from "@/lib/analysis/input-schema";
import { getI18n } from "@/i18n/server";
import { withSiteName } from "@/lib/dashboard/page-titles";
import { extensionFailureMessage } from "@/lib/extend-app/error-message";
import { selectExtensionTier } from "@/lib/extend-app/result";
import { extensionJobs } from "@/services/extension-job";
import { extensionResults } from "@/services/extension-job-result";
import { getCurrentWorkspace } from "@/services/current-workspace";
import { getWorkspace } from "@/services/db/workspaces";
import { LocalTime } from "@/components/ui/local-time";
import { ExtensionPending, ExtensionCompletionFocus } from "@/components/extend/extension-pending";
import { ExtensionResultWithArtifacts } from "@/components/extend/extension-result-with-artifacts";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };
const link = "inline-block min-h-6 break-words underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink";
export async function generateMetadata() { const { t } = await getI18n(); return { title: withSiteName(t("extension.result.heading")) }; }
export default async function ExtensionPage({ params, searchParams }: Props) {
  const [{ id }, query, { t, locale }, current] = await Promise.all([params, searchParams, getI18n(), getCurrentWorkspace()]);
  // get() performs the shared stale recovery and re-read, including concurrent success.
  const record = await extensionJobs.get(id);
  if (!record) notFound();
  const owner = await getWorkspace(record.workspaceId);
  if (!owner) notFound();
  let display = null;
  if (record.status === "succeeded") {
    try { display = await extensionResults.getDisplay(id); }
    catch { /* Missing/corrupt pinned evidence is a display error, never a latest-catalog fallback. */ }
  }
  const failure = extensionFailureMessage(record.error?.code);
  return <section className="min-w-0 space-y-6">
    <div className="min-w-0 space-y-2 text-sm text-muted">
      <p className="break-words">{owner.name}</p>
      {current.id !== record.workspaceId && <p role="status" className="break-words">{t("extension.otherWorkspace", { name: owner.name })}</p>}
      <Link className={link} href={`/inventory/scans/${record.sourceScanId}`}>{t("extension.sourceScan", { id: record.sourceScanId })}</Link>
    </div>
    {display && process.env.CLOUDSIGHT_DEMO === "1" && <p className="text-sm text-subtle">{t("pricing.syntheticDemo")}</p>}
    {record.status === "succeeded" && display ? <ExtensionResultWithArtifacts display={display} initialTier={selectExtensionTier(query.tier, display.result.recommendedTier)} /> : <>
      <h1 id="extension-heading" tabIndex={-1} className="text-[32px] font-bold text-ink">{t(record.status === "pending" ? "extension.status.pending" : record.status === "failed" ? "extension.status.failed" : "extension.result.heading")}</h1>
      {record.status === "pending" ? <ExtensionPending id={id} createdAt={record.createdAt} />
        : <div className="space-y-3"><p role="alert" className="text-warning">{t(record.status === "failed" ? failure.key : "extension.result.evidenceUnavailable")}</p>
          {record.status === "failed" && <Link className={link} href={`/extensions/new?from=${id}`}>{t("common.retry")}</Link>}
          {record.status === "failed" && failure.keyUnavailable && <Link className={link} href={`/workspaces/${record.workspaceId}/claude`}>{t("workspace.claude.configure")}</Link>}
        </div>}
      <div className="min-w-0 space-y-2"><h2 className="text-xs uppercase text-subtle">{t("extension.result.input")}</h2>
        <p className="whitespace-pre-wrap break-words">{record.input.description}</p>
        <p>{t("extension.ui.budgetLabel")} · {formatMonthlyMoney(record.input.monthlyBudget, "CAD", locale)} · {record.input.region}</p>
        <p>{t("analysis.usersLabel")} · {t(EXPECTED_USERS_OPTIONS.find(option => option.value === record.input.expectedUsers)!.labelKey)}</p>
        <p>{t("analysis.availabilityLabel")} · {t(AVAILABILITY_OPTIONS.find(option => option.value === record.input.availability)!.labelKey)}</p>
        <LocalTime value={record.createdAt} format="datetime" />
      </div>
    </>}
    {record.status !== "pending" && <ExtensionCompletionFocus id={id} />}
    <div className="flex flex-wrap gap-4"><Link className={link} href={`/extensions/new?from=${id}`}>{t("extension.ui.rerun")}</Link><Link className={link} href="/extensions">{t("extension.ui.history")}</Link></div>
  </section>;
}
