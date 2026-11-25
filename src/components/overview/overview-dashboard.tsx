"use client";
import Link from "next/link";
import { useId, type JSX, type ReactNode } from "react";
import { TextWithLocalTime } from "@/components/ui/local-time";
import { formatNumber } from "@/i18n/format";
import type { MessageKey } from "@/i18n/messages/types";
import { useI18n } from "@/i18n/provider";
import { pickText } from "@/i18n/translate";
import { scanErrorMessageKey } from "@/lib/scans/error-messages";
import { overviewStartPaths, type StartLinkKey, type StartPathKey } from "@/lib/overview/start-paths";
import type { AssessmentSeverity } from "@/types/assessment";
import type { CompletionReasonCode } from "@/types/completion";
import type { JobStatus } from "@/types/job";
import type { OverviewActionKey, OverviewGap, OverviewJobRef, WorkspaceOverview } from "@/types/overview";

const ACTION_LABELS: Record<OverviewActionKey, MessageKey> = {
  "setup-claude": "overview.actions.setupClaude",
  "connect-azure": "overview.actions.connectAzure",
  "view-scan-progress": "overview.actions.viewScanProgress",
  "run-scan": "overview.actions.runScan",
  "view-assessment-progress": "overview.actions.viewAssessmentProgress",
  "assess-latest-scan": "overview.actions.assessLatestScan",
  "review-violations": "overview.actions.reviewViolations",
  "review-unknowns": "overview.actions.reviewUnknowns",
  "check-network": "overview.actions.checkNetwork",
  "plan-extension": "overview.actions.planExtension",
  "start-build": "overview.actions.startBuild",
};
const STATUS_LABELS: Record<JobStatus, MessageKey> = {
  pending: "overview.status.pending", succeeded: "overview.status.succeeded", failed: "overview.status.failed",
};
const COMPONENT_LABELS: Record<Extract<OverviewGap, { key: "component" }>["component"], MessageKey> = {
  advisor: "overview.components.advisor", monthToDate: "overview.components.monthToDate",
  trailing30Days: "overview.components.trailing30Days", diff: "overview.components.diff",
};
const START_TITLES: Record<StartPathKey, MessageKey> = {
  browse: "overview.start.browse.title", health: "overview.start.health.title", design: "overview.start.design.title",
};
const START_BODIES: Record<StartPathKey, MessageKey> = {
  browse: "overview.start.browse.body", health: "overview.start.health.body", design: "overview.start.design.body",
};
const START_LINKS: Record<StartLinkKey, MessageKey> = {
  connect: "overview.start.links.connect", openTopology: "overview.start.links.openTopology",
  openAssessedScan: "overview.start.links.openAssessedScan", openLatestScan: "overview.start.links.openLatestScan",
  openInventory: "overview.start.links.openInventory", openAssessment: "overview.start.links.openAssessment",
  assessScan: "overview.start.links.assessScan", openBuild: "overview.start.links.openBuild", startBuild: "overview.start.links.startBuild",
  openExtend: "overview.start.links.openExtend", startExtend: "overview.start.links.startExtend",
};
const SEVERITIES: AssessmentSeverity[] = ["critical", "high", "medium", "low", "informational"];
const focus = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink";
const linkClass = `inline-flex min-h-8 items-center rounded text-sm text-ink underline underline-offset-4 ${focus}`;

function Section({ title, children }: { title: string; children: ReactNode }): JSX.Element {
  const id = useId();
  return <section aria-labelledby={id} className="min-w-0 space-y-3 rounded-xl border border-hairline bg-surface-1 p-5">
    <h2 id={id} className="text-lg font-semibold text-ink">{title}</h2>
    {children}
  </section>;
}

export function OverviewDashboard({ workspaceName, workspaceId, overview, demo = false }: {
  workspaceName: string; workspaceId?: string; overview: WorkspaceOverview; demo?: boolean;
}): JSX.Element {
  const { locale, t } = useI18n();
  const actionsId = useId();
  const startId = useId();
  const startPaths = overviewStartPaths(overview, workspaceId ?? "");
  // 계정 없이 보는 합성 데모에서는 Claude 설정을 첫 할 일로 내세우지 않는다.
  const actions = demo ? overview.actions.filter(action => action.key !== "setup-claude") : overview.actions;
  const gapsId = useId();
  const count = (value: number) => formatNumber(value, locale);
  const reasons = (codes: CompletionReasonCode[]) => codes.map(code => t(`assessment.reasons.${code}`)).join(", ");
  const latestRecord = (record: OverviewJobRef) => <p className="text-sm text-muted">
    <TextWithLocalTime text={t("overview.latestRecord", { status: t(STATUS_LABELS[record.status]) })} value={record.createdAt} format="datetime" />
  </p>;
  const gapText = (gap: OverviewGap): string => {
    switch (gap.key) {
      case "no-scan": return t("overview.gaps.noScan");
      case "not-assessed": return t("overview.gaps.notAssessed");
      case "assessment-older-scan": return t("overview.gaps.olderScan");
      case "scan-completeness": return t(gap.state === "partial" ? "overview.gaps.scanPartial" : "overview.gaps.scanUnknown", { reasons: reasons(gap.reasons) });
      case "rules-excluded": return t("overview.gaps.rulesExcluded", { excluded: count(gap.excluded), total: count(gap.total), reasons: reasons(gap.reasons) });
      case "unknown-verdicts": return t("overview.gaps.unknownVerdicts", { count: count(gap.count) });
      case "component": return t("overview.gaps.component", { component: t(COMPONENT_LABELS[gap.component]), state: t(`assessment.componentStatus.${gap.state}`) });
      case "no-network": return t("overview.gaps.noNetwork");
      case "claude-unknown": return t("overview.gaps.claudeUnknown");
    }
  };
  const { inventory, assessment, build, extend, network } = overview;
  const latestAssessment = assessment.latest;

  return <div className="min-w-0 space-y-8 text-body">
    <header className="space-y-3">
      <p className="break-words text-xs font-semibold uppercase tracking-[0.6px] text-subtle">{workspaceName}</p>
      <h1 className="text-[32px] font-bold leading-[1.18] tracking-[-0.8px] text-ink">{t("overview.title")}</h1>
      <p className="text-sm leading-[1.7] text-muted">{t("overview.description")}</p>
      <p className="text-sm leading-[1.7] text-muted">{t("overview.noScore")}</p>
    </header>

    {demo && <p role="note" className="rounded-lg border border-hairline bg-surface-2 px-4 py-3 text-sm text-ink">{t("overview.demo")}</p>}

    <section aria-labelledby={startId} className="space-y-4">
      <div className="space-y-1">
        <h2 id={startId} className="text-xl font-semibold text-ink">{t("overview.start.title")}</h2>
        <p className="text-sm text-muted">{t("overview.start.description")}</p>
      </div>
      <ol className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {startPaths.map(path => <li key={path.key} className="min-w-0 space-y-3 rounded-xl border border-hairline bg-surface-1 p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.6px] text-subtle">{t(path.feature === "assess" ? "overview.start.features.assess" : "overview.start.features.build")}</p>
          <h3 className="text-lg font-semibold text-ink">{t(START_TITLES[path.key])}</h3>
          <p className="text-sm text-muted">{t(START_BODIES[path.key])}</p>
          {path.needsData && <p className="text-sm">{t(path.key === "health" ? "overview.start.healthNeedsData" : "overview.start.needsData")}</p>}
          {path.needsData && path.key === "browse" && !demo && <p className="text-sm text-muted">{t("overview.start.demoHint")}</p>}
          {path.links.length > 0 && <ul className="space-y-1">
            {path.links.map(link => <li key={link.key}><Link href={link.href} className={linkClass}>{t(START_LINKS[link.key])}</Link></li>)}
          </ul>}
        </li>)}
      </ol>
    </section>

    <section aria-labelledby={actionsId} className="space-y-4 rounded-xl border border-border-strong bg-surface-1 p-5">
      <h2 id={actionsId} className="text-xl font-semibold text-ink">{t("overview.actions.title")}</h2>
      {actions.length
        ? <ol className="flex flex-wrap gap-3">{actions.map((action, index) => <li key={action.key}><Link href={action.href} className={`inline-flex min-h-10 items-center rounded-lg px-4 py-2 text-sm font-semibold ${focus} ${index === 0 ? "bg-ink text-canvas" : "border border-control text-ink hover:bg-surface-2"}`}>{t(ACTION_LABELS[action.key])}</Link></li>)}</ol>
        : <p>{t("overview.actions.none")}</p>}
    </section>

    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Section title={t("overview.inventory.title")}>
        {inventory.latest ? <>
          <p className="text-sm text-muted"><TextWithLocalTime text={t("overview.inventory.collected", { source: t(inventory.latest.source === "live" ? "inventory.source.live" : "inventory.source.import") })} value={inventory.latest.collectedAt} format="datetime" /></p>
          <dl className="grid grid-cols-2 gap-3">
            <div><dt className="text-sm text-muted">{t("overview.inventory.resources")}</dt><dd className="text-2xl font-bold tabular-nums text-ink">{count(inventory.latest.resourceCount)}</dd></div>
            <div><dt className="text-sm text-muted">{t("overview.inventory.subscriptions")}</dt><dd className="text-2xl font-bold tabular-nums text-ink">{count(inventory.latest.subscriptionCount)}</dd></div>
          </dl>
        </> : <p>{t("overview.inventory.none")}</p>}
        {inventory.pendingScanId && <p>{t("overview.inventory.running")}</p>}
        {inventory.latestAttemptFailure && <p className="text-sm text-warning">{t("overview.inventory.lastAttemptFailed", { reason: inventory.latestAttemptFailure.errorCode ? t(scanErrorMessageKey(inventory.latestAttemptFailure.errorCode)) : t("overview.status.failed") })}</p>}
        <Link href={inventory.latest ? `/inventory/scans/${encodeURIComponent(inventory.latest.id)}` : "/inventory"} className={linkClass}>{t("overview.inventory.open")}</Link>
      </Section>

      <Section title={t("overview.assessment.title")}>
        {latestAssessment ? <>
          <p className="text-sm text-muted"><TextWithLocalTime text={t("overview.assessment.saved")} value={latestAssessment.createdAt} format="datetime" /></p>
          {!latestAssessment.onLatestScan && <p className="text-sm text-warning">{t("overview.assessment.olderScan")}</p>}
          <dl className="grid grid-cols-3 gap-3">
            <div><dt className="text-sm text-muted">{t("overview.assessment.violations")}</dt><dd className="text-2xl font-bold tabular-nums text-ink">{count(latestAssessment.violationTotal)}</dd></div>
            <div><dt className="text-sm text-muted">{t("overview.assessment.unknown")}</dt><dd className="text-2xl font-bold tabular-nums text-ink">{count(latestAssessment.unknownCount)}</dd></div>
            <div><dt className="text-sm text-muted">{t("overview.assessment.pass")}</dt><dd className="text-2xl font-bold tabular-nums text-ink">{count(latestAssessment.passCount)}</dd></div>
          </dl>
          {latestAssessment.violationTotal > 0 && <dl className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {SEVERITIES.filter(severity => latestAssessment.violations[severity] > 0).map(severity => <div key={severity} className="flex gap-1">
              <dt className="text-muted">{t(`assessment.severity.${severity}`)}</dt><dd className="tabular-nums text-ink">{count(latestAssessment.violations[severity])}</dd>
            </div>)}
          </dl>}
          <p className="text-sm text-muted">{t("overview.assessment.coverage", { included: count(latestAssessment.coverage.included), total: count(latestAssessment.coverage.total), excluded: count(latestAssessment.coverage.excluded) })}</p>
        </> : <p>{t("overview.assessment.none")}</p>}
        {assessment.latestAttempt && assessment.latestAttempt.id !== latestAssessment?.id
          && <p className="text-sm">{t("overview.assessment.latestAttempt", { status: t(STATUS_LABELS[assessment.latestAttempt.status]) })}</p>}
        <div className="flex flex-wrap gap-x-6">
          {latestAssessment && <Link href={`/assessments/${encodeURIComponent(latestAssessment.id)}`} className={linkClass}>{t("overview.assessment.open")}</Link>}
          <Link href="/assessments" className={linkClass}>{t("overview.assessment.history")}</Link>
        </div>
      </Section>

      <Section title={t("overview.build.title")}>
        {build ? <>
          <Link href={`/analyses/${encodeURIComponent(build.id)}`} className={linkClass}>{(build.title && pickText(build.title, locale).trim()) || t("overview.build.untitled")}</Link>
          {latestRecord(build)}
        </> : <p>{t("overview.build.none")}</p>}
        <Link href="/analyses" className={linkClass}>{t("overview.build.history")}</Link>
      </Section>

      <Section title={t("overview.extend.title")}>
        {extend ? <>
          <Link href={`/extensions/${encodeURIComponent(extend.id)}`} className={linkClass}>{(extend.title && pickText(extend.title, locale).trim()) || t("overview.extend.untitled")}</Link>
          {latestRecord(extend)}
        </> : <p>{t("overview.extend.none")}</p>}
        <Link href="/extensions" className={linkClass}>{t("overview.extend.history")}</Link>
      </Section>

      <Section title={t("overview.network.title")}>
        {network ? <>
          {latestRecord(network)}
          {network.verdict && <p>{t("overview.network.verdict", { verdict: t(`network.verdict.${network.verdict}`) })}</p>}
          <Link href={`/network/${encodeURIComponent(network.id)}`} className={linkClass}>{t("overview.network.open")}</Link>
        </> : <p>{t("overview.network.none")}</p>}
        <Link href="/network" className={linkClass}>{t("overview.network.history")}</Link>
      </Section>
    </div>

    <section aria-labelledby={gapsId} className="space-y-3">
      <h2 id={gapsId} className="text-xl font-semibold text-ink">{t("overview.gaps.title")}</h2>
      {overview.gaps.length
        ? <ul className="list-disc space-y-1 pl-5 text-sm">{overview.gaps.map((gap, index) => <li key={index}>{gapText(gap)}</li>)}</ul>
        : <p>{t("overview.gaps.none")}</p>}
    </section>
  </div>;
}
