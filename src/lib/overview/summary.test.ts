import { describe, expect, it } from "vitest";
import { assessment, completeSnapshot, ids, partialSnapshot } from "@/lib/completion/fixtures.test-data";
import type { AssessmentResult } from "@/types/assessment";
import { buildWorkspaceOverview, type OverviewSource } from "./summary";

// 고정 합성 자료만 쓴다. 회사 데이터·실제 키가 없다.
const now = new Date("2026-11-13T12:00:00Z");
const recent = "2026-11-13T11:59:00Z";
const old = "2026-11-12T00:00:00Z";
const scan = completeSnapshot.record;
const succeededAssessment = { id: ids.assessment, status: "succeeded" as const, sourceScanId: ids.scan, createdAt: assessment.createdAt, result: assessment as AssessmentResult };

function source(overrides: Partial<OverviewSource> = {}): OverviewSource {
  return {
    workspaceId: ids.workspace, claude: { needsSetup: false, available: true }, azureConnected: true,
    scans: [scan], latestScan: scan, assessments: [], analyses: [], extensions: [], networkDiagnostics: [],
    ...overrides,
  };
}
const keys = (value: ReturnType<typeof buildWorkspaceOverview>) => value.actions.map(action => action.key);

describe("buildWorkspaceOverview", () => {
  it("guides an empty workspace to Claude setup, Azure connection and a first scan without inventing results", () => {
    const view = buildWorkspaceOverview(source({ claude: { needsSetup: true, available: false }, azureConnected: false, scans: [], latestScan: null }), now);
    expect(view.actions).toEqual([
      { key: "setup-claude", href: "/setup" },
      { key: "connect-azure", href: `/workspaces/${ids.workspace}/connection` },
      { key: "run-scan", href: "/inventory" },
      { key: "start-build", href: "/analyses/new" },
    ]);
    expect(view.gaps).toEqual([{ key: "no-scan" }]);
    expect(view.inventory).toEqual({ latest: null, pendingScanId: null, latestAttemptFailure: null });
    expect(view.assessment).toEqual({ latestAttempt: null, latest: null });
    expect(view.build).toBeNull(); expect(view.extend).toBeNull(); expect(view.network).toBeNull();
  });

  it("does not ask for an Azure connection when an imported scan already exists", () => {
    const imported = { ...scan, source: "import" as const };
    const view = buildWorkspaceOverview(source({ azureConnected: false, scans: [imported], latestScan: imported }), now);
    expect(keys(view)).not.toContain("connect-azure");
    expect(view.inventory.latest).toMatchObject({ id: ids.scan, source: "import", resourceCount: scan.summary.resourceCount, subscriptionCount: 1 });
  });

  it("reports an unreadable Claude status as unknown instead of ready", () => {
    const view = buildWorkspaceOverview(source({ claude: null }), now);
    expect(keys(view)).not.toContain("setup-claude");
    expect(view.gaps).toContainEqual({ key: "claude-unknown" });
  });

  it("links an active scan to its progress and treats a stale pending scan as interrupted", () => {
    const pending = { ...scan, id: "pending-scan", status: "pending" as const, createdAt: recent, collectedAt: null, summary: null };
    const active = buildWorkspaceOverview(source({ scans: [pending], latestScan: null }), now);
    expect(active.actions[0]).toEqual({ key: "view-scan-progress", href: "/inventory/scans/pending-scan" });
    expect(keys(active)).not.toContain("run-scan");
    expect(active.inventory.pendingScanId).toBe("pending-scan");
    const stale = buildWorkspaceOverview(source({ scans: [{ ...pending, createdAt: old }], latestScan: null }), now);
    expect(stale.inventory).toMatchObject({ pendingScanId: null, latestAttemptFailure: { id: "pending-scan", errorCode: "interrupted" } });
    expect(keys(stale)).toContain("run-scan");
  });

  it("surfaces a failed newest attempt only when no newer successful scan exists", () => {
    const failed = { ...scan, id: "failed-scan", status: "failed" as const, errorCode: "forbidden" as const, createdAt: recent };
    expect(buildWorkspaceOverview(source({ scans: [failed, scan] }), now).inventory.latestAttemptFailure).toEqual({ id: "failed-scan", errorCode: "forbidden" });
    expect(buildWorkspaceOverview(source({ scans: [scan, failed] }), now).inventory.latestAttemptFailure).toBeNull();
  });

  it("asks to assess the latest scan when it has no assessment and leaves verdicts unknown", () => {
    const view = buildWorkspaceOverview(source(), now);
    expect(view.actions).toContainEqual({ key: "assess-latest-scan", href: `/assessments/new?sourceScanId=${ids.scan}` });
    expect(view.gaps).toContainEqual({ key: "not-assessed" });
    expect(view.assessment.latest).toBeNull();
  });

  it("counts saved code verdicts, coverage and unavailable components from the latest succeeded assessment", () => {
    const view = buildWorkspaceOverview(source({ assessments: [succeededAssessment] }), now);
    expect(view.assessment.latest).toEqual({
      id: ids.assessment, createdAt: assessment.createdAt, sourceScanId: ids.scan, onLatestScan: true,
      violations: { critical: 0, high: 0, medium: 11, low: 0, informational: 0 }, violationTotal: 11, unknownCount: 10, passCount: 11,
      coverage: { total: 32, included: 32, excluded: 0 },
    });
    expect(keys(view)).toEqual(["review-violations", "review-unknowns", "check-network", "plan-extension", "start-build"]);
    expect(view.actions[0]).toEqual({ key: "review-violations", href: `/assessments/${ids.assessment}` });
    expect(view.gaps).toEqual([
      { key: "unknown-verdicts", count: 10 },
      { key: "component", component: "advisor", state: "partial" },
      { key: "component", component: "trailing30Days", state: "failed" },
      { key: "no-network" },
    ]);
  });

  it("reports partial scan scope and excluded rule coverage with their saved reason codes", () => {
    const result = { ...assessment, sourceScan: partialSnapshot.sourceScan,
      local: { ...assessment.local, findings: [], coverage: { total: 32, included: 30, excluded: 2, reasons: [{ code: "unsupported-type", count: 1 }, { code: "missing-data", count: 1 }] } },
      advisor: { state: "not-requested" }, actualCost: { ...assessment.actualCost, trailing30Days: assessment.actualCost.monthToDate }, diff: { state: "not-requested" } } as unknown as AssessmentResult;
    const view = buildWorkspaceOverview(source({ assessments: [{ ...succeededAssessment, result }] }), now);
    expect(keys(view)).not.toContain("review-violations");
    expect(keys(view)).toContain("review-unknowns");
    expect(view.gaps.slice(0, 2)).toEqual([
      { key: "scan-completeness", state: "partial", reasons: ["scope-not-collected", "collection-partial"] },
      { key: "rules-excluded", excluded: 2, total: 32, reasons: ["unsupported-type", "missing-data"] },
    ]);
    expect(view.gaps).toContainEqual({ key: "component", component: "advisor", state: "not-requested" });
    expect(view.gaps).toContainEqual({ key: "component", component: "diff", state: "not-requested" });
  });

  it("marks an assessment of an older scan as outdated and asks for a new one", () => {
    const newer = { ...scan, id: "newer-scan", collectedAt: "2026-11-12T12:00:00Z" };
    const view = buildWorkspaceOverview(source({ scans: [newer, scan], latestScan: newer, assessments: [succeededAssessment] }), now);
    expect(view.assessment.latest?.onLatestScan).toBe(false);
    expect(view.actions[0]).toEqual({ key: "assess-latest-scan", href: "/assessments/new?sourceScanId=newer-scan" });
    expect(view.gaps[0]).toEqual({ key: "assessment-older-scan" });
  });

  it("follows an active assessment instead of starting another and resolves stale ones as failed", () => {
    const pending = { id: "pending-assessment", status: "pending" as const, sourceScanId: ids.scan, createdAt: recent, result: null };
    const active = buildWorkspaceOverview(source({ assessments: [pending] }), now);
    expect(active.actions[0]).toEqual({ key: "view-assessment-progress", href: "/assessments/pending-assessment" });
    expect(keys(active)).not.toContain("assess-latest-scan");
    expect(active.assessment.latestAttempt).toEqual({ id: "pending-assessment", status: "pending", createdAt: recent });
    const stale = buildWorkspaceOverview(source({ assessments: [{ ...pending, createdAt: old }, succeededAssessment] }), now);
    expect(stale.assessment.latestAttempt?.status).toBe("failed");
    expect(stale.assessment.latest?.id).toBe(ids.assessment);
    expect(keys(stale)).not.toContain("view-assessment-progress");
  });

  it("summarizes the latest Build, Extend and network records with resolved statuses", () => {
    const title = { en: "Synthetic web app", ko: "합성 웹 앱" };
    const view = buildWorkspaceOverview(source({
      assessments: [succeededAssessment],
      analyses: [{ id: "analysis-1", status: "pending", createdAt: old, title: null }],
      extensions: [{ id: ids.extension, status: "succeeded", createdAt: recent, title }],
      networkDiagnostics: [{ id: ids.network, status: "succeeded", createdAt: recent, verdict: "unknown" }],
    }), now);
    expect(view.build).toEqual({ id: "analysis-1", status: "failed", createdAt: old, title: null });
    expect(view.extend).toEqual({ id: ids.extension, status: "succeeded", createdAt: recent, title });
    expect(view.network).toEqual({ id: ids.network, status: "succeeded", createdAt: recent, verdict: "unknown" });
    expect(keys(view)).not.toContain("check-network");
    expect(keys(view)).not.toContain("plan-extension");
    expect(keys(view)).not.toContain("start-build");
    expect(view.gaps).not.toContainEqual({ key: "no-network" });
  });

  it("projects a pending network diagnostic as failed past the network store's own stale threshold", () => {
    const at = (seconds: number) => new Date(now.getTime() - seconds * 1000).toISOString();
    const network = (createdAt: string) => buildWorkspaceOverview(source({ networkDiagnostics: [{ id: ids.network, status: "pending", createdAt, verdict: null }] }), now).network?.status;
    expect(network(at(299))).toBe("pending");
    expect(network(at(310))).toBe("failed");
  });

  it("encodes scan ids in generated links", () => {
    const odd = { ...scan, id: "a b&c" };
    const view = buildWorkspaceOverview(source({ scans: [odd], latestScan: odd }), now);
    expect(view.actions).toContainEqual({ key: "assess-latest-scan", href: "/assessments/new?sourceScanId=a%20b%26c" });
  });
});
