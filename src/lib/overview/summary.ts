import { resolveAnalysisStatus } from "@/lib/analysis/analysis-job";
import { isAssessmentStale } from "@/lib/assessment/app/job";
import { isJobStale } from "@/lib/jobs/timing";
import { NETWORK_STALE_MS } from "@/lib/network-diagnostics/validation";
import { resolveScanStatus } from "@/lib/scans/timing";
import type { AssessmentRecord, AssessmentSeverity } from "@/types/assessment";
import type { LocalizedText } from "@/types/i18n";
import type { JobStatus } from "@/types/job";
import type {
  OverviewAction, OverviewActionKey, OverviewAssessment, OverviewGap, OverviewInventory, OverviewJobRef,
  OverviewNetworkVerdict, WorkspaceOverview,
} from "@/types/overview";
import type { ScanRecord } from "@/types/scan";

type TitledJob = OverviewJobRef & { title: LocalizedText | null };

// 서비스가 현재 워크스페이스의 저장 기록만 읽어 넘긴다. 목록은 모두 최신순이다.
export type OverviewSource = {
  workspaceId: string;
  // null이면 설정을 읽지 못한 것이다. 준비됐다고 가정하지 않는다.
  claude: { needsSetup: boolean; available: boolean } | null;
  azureConnected: boolean;
  scans: Pick<ScanRecord, "id" | "status" | "createdAt" | "errorCode">[];
  latestScan: Pick<ScanRecord, "id" | "source" | "collectedAt" | "summary" | "subscriptionIds"> | null;
  assessments: Pick<AssessmentRecord, "id" | "status" | "sourceScanId" | "createdAt" | "result">[];
  analyses: TitledJob[];
  extensions: TitledJob[];
  networkDiagnostics: (OverviewJobRef & { verdict: OverviewNetworkVerdict | null })[];
};

const SEVERITIES: AssessmentSeverity[] = ["critical", "high", "medium", "low", "informational"];
const ACTION_ORDER: OverviewActionKey[] = [
  "setup-claude", "connect-azure", "view-scan-progress", "run-scan", "view-assessment-progress", "assess-latest-scan",
  "review-violations", "review-unknowns", "check-network", "plan-extension", "start-build",
];

function summarizeInventory(input: OverviewSource, now: Date): OverviewInventory {
  const attempts = input.scans.map(scan => resolveScanStatus(scan, now));
  const pending = attempts.find(scan => scan.status === "pending");
  const newest = attempts[0];
  const latest = input.latestScan?.collectedAt && input.latestScan.summary
    ? { id: input.latestScan.id, source: input.latestScan.source, collectedAt: input.latestScan.collectedAt,
      resourceCount: input.latestScan.summary.resourceCount, subscriptionCount: input.latestScan.subscriptionIds.length }
    : null;
  return {
    latest,
    pendingScanId: pending?.id ?? null,
    latestAttemptFailure: newest?.status === "failed" ? { id: newest.id, errorCode: newest.errorCode } : null,
  };
}

function summarizeAssessment(input: OverviewSource, latestScanId: string | null, now: Date): OverviewAssessment {
  const status = (record: OverviewSource["assessments"][number]): JobStatus =>
    record.status === "pending" && isAssessmentStale(record, now) ? "failed" : record.status;
  const first = input.assessments[0];
  const saved = input.assessments.find(record => record.status === "succeeded" && record.result);
  const result = saved?.result;
  if (!saved || !result) return { latestAttempt: first ? { id: first.id, status: status(first), createdAt: first.createdAt } : null, latest: null };
  const violations = Object.fromEntries(SEVERITIES.map(severity => [severity, 0])) as Record<AssessmentSeverity, number>;
  let unknownCount = 0;
  let passCount = 0;
  for (const finding of result.local.findings) {
    if (finding.verdict === "violation") violations[finding.severity] += 1;
    else if (finding.verdict === "unknown") unknownCount += 1;
    else passCount += 1;
  }
  const { total, included, excluded } = result.local.coverage;
  return {
    latestAttempt: { id: first.id, status: status(first), createdAt: first.createdAt },
    latest: {
      id: saved.id, createdAt: saved.createdAt, sourceScanId: saved.sourceScanId, onLatestScan: saved.sourceScanId === latestScanId,
      violations, violationTotal: SEVERITIES.reduce((sum, severity) => sum + violations[severity], 0), unknownCount, passCount,
      coverage: { total, included, excluded },
    },
  };
}

function collectGaps(input: OverviewSource, inventory: OverviewInventory, assessment: OverviewAssessment): OverviewGap[] {
  const gaps: OverviewGap[] = [];
  const result = input.assessments.find(record => record.id === assessment.latest?.id)?.result ?? null;
  if (!inventory.latest) gaps.push({ key: "no-scan" });
  else if (assessment.latest && !assessment.latest.onLatestScan) gaps.push({ key: "assessment-older-scan" });
  else if (!assessment.latest) gaps.push({ key: "not-assessed" });
  if (result) {
    const completeness = result.sourceScan.completeness;
    if (completeness.state !== "complete") gaps.push({ key: "scan-completeness", state: completeness.state, reasons: completeness.reasons });
    const coverage = result.local.coverage;
    if (coverage.excluded > 0) gaps.push({ key: "rules-excluded", excluded: coverage.excluded, total: coverage.total, reasons: coverage.reasons.map(reason => reason.code) });
    if (assessment.latest!.unknownCount > 0) gaps.push({ key: "unknown-verdicts", count: assessment.latest!.unknownCount });
    const components = [
      ["advisor", result.advisor.state], ["monthToDate", result.actualCost.monthToDate.state],
      ["trailing30Days", result.actualCost.trailing30Days.state], ["diff", result.diff.state],
    ] as const;
    for (const [component, state] of components) if (state !== "available") gaps.push({ key: "component", component, state });
  }
  if (inventory.latest && !input.networkDiagnostics.length) gaps.push({ key: "no-network" });
  if (!input.claude) gaps.push({ key: "claude-unknown" });
  return gaps;
}

function collectActions(input: OverviewSource, inventory: OverviewInventory, assessment: OverviewAssessment): OverviewAction[] {
  const actions = new Map<OverviewActionKey, string>();
  const latestScan = inventory.latest;
  if (input.claude?.needsSetup) actions.set("setup-claude", "/setup");
  if (!input.azureConnected && !latestScan) actions.set("connect-azure", `/workspaces/${encodeURIComponent(input.workspaceId)}/connection`);
  if (inventory.pendingScanId) actions.set("view-scan-progress", `/inventory/scans/${encodeURIComponent(inventory.pendingScanId)}`);
  else if (!latestScan) actions.set("run-scan", "/inventory");
  const attempt = assessment.latestAttempt;
  if (attempt?.status === "pending") actions.set("view-assessment-progress", `/assessments/${encodeURIComponent(attempt.id)}`);
  if (latestScan) {
    const covered = input.assessments.some((record, index) => record.sourceScanId === latestScan.id
      && (record.status === "succeeded" || (index === 0 && attempt?.status === "pending")));
    if (!covered) actions.set("assess-latest-scan", `/assessments/new?sourceScanId=${encodeURIComponent(latestScan.id)}`);
  }
  if (assessment.latest) {
    const href = `/assessments/${encodeURIComponent(assessment.latest.id)}`;
    if (assessment.latest.violationTotal > 0) actions.set("review-violations", href);
    if (assessment.latest.unknownCount > 0 || assessment.latest.coverage.excluded > 0) actions.set("review-unknowns", href);
  }
  if (latestScan && !input.networkDiagnostics.length) actions.set("check-network", "/network");
  if (latestScan && !input.extensions.length) actions.set("plan-extension", "/extensions/new");
  if (!input.analyses.length) actions.set("start-build", "/analyses/new");
  return ACTION_ORDER.filter(key => actions.has(key)).map(key => ({ key, href: actions.get(key)! }));
}

/** 저장된 기록만으로 현재 워크스페이스 요약을 만든다. 점수나 추정치를 만들지 않고, 모르는 부분은 gaps로 남긴다. */
export function buildWorkspaceOverview(input: OverviewSource, now: Date): WorkspaceOverview {
  const inventory = summarizeInventory(input, now);
  const assessment = summarizeAssessment(input, inventory.latest?.id ?? null, now);
  const analysis = input.analyses[0];
  const extension = input.extensions[0];
  const network = input.networkDiagnostics[0];
  return {
    inventory,
    assessment,
    build: analysis ? { ...analysis, status: resolveAnalysisStatus({ ...analysis, errorStage: null }, now).status } : null,
    extend: extension ? { ...extension, status: extension.status === "pending" && isJobStale(extension.createdAt, now) ? "failed" : extension.status } : null,
    // 경로 진단 저장소의 만료 기준과 같다. 기록은 바꾸지 않고 화면 값만 실패로 둔다.
    network: network ? { ...network, status: network.status === "pending" && !(Date.parse(network.createdAt) >= now.getTime() - NETWORK_STALE_MS) ? "failed" : network.status } : null,
    actions: collectActions(input, inventory, assessment),
    gaps: collectGaps(input, inventory, assessment),
  };
}
