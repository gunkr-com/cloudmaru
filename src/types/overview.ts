import type { CompletionReasonCode } from "@/types/completion";
import type { AssessmentSeverity } from "@/types/assessment";
import type { LocalizedText } from "@/types/i18n";
import type { JobStatus } from "@/types/job";
import type { ScanErrorCode, ScanSource } from "@/types/scan";

export type OverviewComponentState = "not-requested" | "available" | "partial" | "unavailable" | "failed";
export type OverviewNetworkVerdict = "allowed" | "blocked" | "unknown";

// 저장된 현재 워크스페이스 기록만으로 요약한다. 화면에 필요한 표시용 필드만 담는다.
export type OverviewJobRef = { id: string; status: JobStatus; createdAt: string };

export type OverviewInventory = {
  latest: { id: string; source: ScanSource; collectedAt: string; resourceCount: number; subscriptionCount: number } | null;
  pendingScanId: string | null;
  // 가장 최근 시도가 실패했고 그보다 새 성공 스캔이 없을 때만 채운다.
  latestAttemptFailure: { id: string; errorCode: ScanErrorCode | null } | null;
};

export type OverviewAssessment = {
  latestAttempt: OverviewJobRef | null;
  latest: {
    id: string;
    createdAt: string;
    sourceScanId: string;
    onLatestScan: boolean;
    violations: Record<AssessmentSeverity, number>;
    violationTotal: number;
    unknownCount: number;
    passCount: number;
    coverage: { total: number; included: number; excluded: number };
  } | null;
};

export type OverviewActionKey =
  | "setup-claude" | "connect-azure" | "view-scan-progress" | "run-scan" | "assess-latest-scan"
  | "view-assessment-progress" | "review-violations" | "review-unknowns" | "check-network" | "plan-extension" | "start-build";
export type OverviewAction = { key: OverviewActionKey; href: string };

export type OverviewGap =
  | { key: "no-scan" }
  | { key: "not-assessed" }
  | { key: "assessment-older-scan" }
  | { key: "scan-completeness"; state: "partial" | "unknown"; reasons: CompletionReasonCode[] }
  | { key: "rules-excluded"; excluded: number; total: number; reasons: CompletionReasonCode[] }
  | { key: "unknown-verdicts"; count: number }
  | { key: "component"; component: "advisor" | "monthToDate" | "trailing30Days" | "diff"; state: Exclude<OverviewComponentState, "available"> }
  | { key: "no-network" }
  | { key: "claude-unknown" };

export type WorkspaceOverview = {
  inventory: OverviewInventory;
  assessment: OverviewAssessment;
  build: (OverviewJobRef & { title: LocalizedText | null }) | null;
  extend: (OverviewJobRef & { title: LocalizedText | null }) | null;
  network: (OverviewJobRef & { verdict: OverviewNetworkVerdict | null }) | null;
  actions: OverviewAction[];
  gaps: OverviewGap[];
};
