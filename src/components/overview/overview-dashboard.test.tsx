import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderWithI18n as render } from "@/test/render-with-i18n";
import type { WorkspaceOverview } from "@/types/overview";
import { OverviewDashboard } from "./overview-dashboard";

// 고정 합성 값만 쓴다.
const empty: WorkspaceOverview = {
  inventory: { latest: null, pendingScanId: null, latestAttemptFailure: null },
  assessment: { latestAttempt: null, latest: null },
  build: null, extend: null, network: null,
  actions: [{ key: "setup-claude", href: "/setup" }, { key: "connect-azure", href: "/workspaces/w1/connection" }, { key: "run-scan", href: "/inventory" }],
  gaps: [{ key: "no-scan" }],
};
const full: WorkspaceOverview = {
  inventory: { latest: { id: "scan-1", source: "import", collectedAt: "2026-11-10T12:00:00Z", resourceCount: 32, subscriptionCount: 2 }, pendingScanId: null, latestAttemptFailure: { id: "scan-2", errorCode: "forbidden" } },
  assessment: {
    latestAttempt: { id: "assessment-2", status: "failed", createdAt: "2026-11-12T00:00:00Z" },
    latest: { id: "assessment-1", createdAt: "2026-11-11T12:00:00Z", sourceScanId: "scan-0", onLatestScan: false,
      violations: { critical: 1, high: 2, medium: 0, low: 0, informational: 0 }, violationTotal: 3, unknownCount: 4, passCount: 5,
      coverage: { total: 32, included: 30, excluded: 2 } },
  },
  build: { id: "analysis-1", status: "succeeded", createdAt: "2026-11-09T00:00:00Z", title: { en: "Synthetic web app", ko: "합성 웹 앱" } },
  extend: { id: "extension-1", status: "failed", createdAt: "2026-11-09T00:00:00Z", title: null },
  network: { id: "network-1", status: "succeeded", createdAt: "2026-11-09T00:00:00Z", verdict: "unknown" },
  actions: [{ key: "assess-latest-scan", href: "/assessments/new?sourceScanId=scan-1" }, { key: "review-violations", href: "/assessments/assessment-1" }],
  gaps: [
    { key: "assessment-older-scan" },
    { key: "scan-completeness", state: "unknown", reasons: ["import-scope-unverified"] },
    { key: "rules-excluded", excluded: 2, total: 32, reasons: ["unsupported-type", "missing-data"] },
    { key: "unknown-verdicts", count: 4 },
    { key: "component", component: "advisor", state: "not-requested" },
  ],
};

describe("OverviewDashboard", () => {
  it.each(["en", "ko"] as const)("shows next actions, empty sections and the no-score notice for an empty workspace in %s", locale => {
    render(<OverviewDashboard workspaceName="Synthetic" overview={empty} />, { locale });
    const en = locale === "en";
    expect(screen.getByRole("heading", { level: 1, name: en ? "Overview" : "개요" })).toBeInTheDocument();
    expect(screen.getByText(en ? /no overall health score/ : /건강 점수는 없습니다/)).toBeInTheDocument();
    const actions = within(screen.getByRole("region", { name: en ? "Next actions" : "다음 할 일" })).getAllByRole("link");
    expect(actions.map(link => [link.textContent, link.getAttribute("href")])).toEqual(en
      ? [["Set up Claude for this workspace", "/setup"], ["Connect Azure, or import a scan file", "/workspaces/w1/connection"], ["Run or import a scan", "/inventory"]]
      : [["이 워크스페이스의 Claude 설정하기", "/setup"], ["Azure 연결 또는 스캔 파일 가져오기", "/workspaces/w1/connection"], ["스캔 실행 또는 가져오기", "/inventory"]]);
    expect(screen.getByText(en ? "No successful scan yet." : "성공한 스캔이 아직 없습니다.")).toBeInTheDocument();
    expect(screen.getByText(en ? "No completed assessment yet." : "완료된 점검이 아직 없습니다.")).toBeInTheDocument();
    expect(screen.getByText(en ? "No saved build analysis yet." : "저장된 구축 분석이 아직 없습니다.")).toBeInTheDocument();
    expect(screen.getByText(en ? "No saved extension yet." : "저장된 확장이 아직 없습니다.")).toBeInTheDocument();
    expect(screen.getByText(en ? "No saved network diagnostic yet." : "저장된 경로 진단이 아직 없습니다.")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: en ? "Coverage gaps" : "커버리지 공백" })).getByText(en ? /No successful scan, so/ : /성공한 스캔이 없어/)).toBeInTheDocument();
    expect(screen.queryByText(/score:|%/i)).not.toBeInTheDocument();
  });

  it("shows saved counts, source times, coverage, and links to each saved record", () => {
    const { container } = render(<OverviewDashboard workspaceName="Synthetic" overview={full} />, { locale: "en" });
    const inventory = within(screen.getByRole("region", { name: "Inventory" }));
    expect(inventory.getByText(/Collected/).textContent).toContain("File");
    expect(inventory.getByText("32")).toBeInTheDocument();
    expect(inventory.getByText(/most recent scan attempt failed/)).toBeInTheDocument();
    expect(inventory.getByRole("link", { name: "Open inventory" })).toHaveAttribute("href", "/inventory/scans/scan-1");
    const assessment = within(screen.getByRole("region", { name: "Assessment" }));
    expect(assessment.getByText("Based on an older scan, not the latest one.")).toBeInTheDocument();
    expect(assessment.getByText("Most recent attempt: Failed")).toBeInTheDocument();
    expect(assessment.getByText("Checked 30 of 32 resources · 2 excluded")).toBeInTheDocument();
    expect(assessment.getByText("Critical").nextSibling).toHaveTextContent("1");
    expect(assessment.getByText("High").nextSibling).toHaveTextContent("2");
    expect(assessment.queryByText("Medium")).not.toBeInTheDocument();
    expect(assessment.getByRole("link", { name: "Open assessment" })).toHaveAttribute("href", "/assessments/assessment-1");
    expect(within(screen.getByRole("region", { name: "Build" })).getByRole("link", { name: "Synthetic web app" })).toHaveAttribute("href", "/analyses/analysis-1");
    const extend = within(screen.getByRole("region", { name: "Extend" }));
    expect(extend.getByRole("link", { name: "Untitled extension" })).toHaveAttribute("href", "/extensions/extension-1");
    expect(extend.getByText(/Failed/)).toBeInTheDocument();
    const network = within(screen.getByRole("region", { name: "Network" }));
    expect(network.getByText("Verdict: Unknown")).toBeInTheDocument();
    expect(network.getByRole("link", { name: "Open diagnostic" })).toHaveAttribute("href", "/network/network-1");
    const gaps = within(screen.getByRole("region", { name: "Coverage gaps" })).getAllByRole("listitem").map(item => item.textContent);
    expect(gaps).toHaveLength(5);
    expect(gaps[1]).toMatch(/^The assessed scan's collection scope is unverified: .+/);
    expect(gaps[2]).toMatch(/^2 of 32 resources were excluded from checks: .+, .+/);
    expect(gaps[3]).toBe("4 findings are unknown because evidence was missing.");
    expect(gaps[4]).toBe("Azure Advisor: Not requested");
    expect(container.querySelectorAll("time")).toHaveLength(5);
  });

  it("states when there are no actions or gaps instead of rendering empty lists", () => {
    render(<OverviewDashboard workspaceName="Synthetic" overview={{ ...full, actions: [], gaps: [] }} />, { locale: "ko" });
    expect(screen.getByText("제안할 일이 없습니다. 아래 항목에서 저장된 결과를 확인하세요.")).toBeInTheDocument();
    expect(screen.getByText("최근 저장 결과에 기록된 커버리지 공백이 없습니다.")).toBeInTheDocument();
  });

  it.each(["en", "ko"] as const)("presents the three start paths with their feature names and fresh-install guidance in %s", locale => {
    render(<OverviewDashboard workspaceName="Synthetic" workspaceId="w1" overview={empty} />, { locale });
    const en = locale === "en";
    const start = within(screen.getByRole("region", { name: en ? "Start here" : "여기서 시작하기" }));
    expect(start.getAllByRole("heading", { level: 3 }).map(heading => heading.textContent)).toEqual(en
      ? ["Browse a saved environment", "Check health", "Compare a new design"]
      : ["저장된 환경 둘러보기", "상태 확인", "새 구성 비교"]);
    expect(start.getAllByText("Assess")).toHaveLength(2);
    expect(start.getByText("Build · Extend")).toBeInTheDocument();
    expect(start.getByRole("link", { name: en ? "Connect Azure or import a scan" : "Azure 연결 또는 스캔 가져오기" })).toHaveAttribute("href", "/workspaces/w1/connection");
    expect(start.getByRole("link", { name: en ? "Start a Build" : "Build 시작" })).toHaveAttribute("href", "/analyses/new");
    expect(start.getByText(/npm run demo/)).toBeInTheDocument();
    expect(screen.queryByText(en ? /Synthetic offline demo/ : /합성 오프라인 데모/)).not.toBeInTheDocument();
  });

  it("links the start paths to saved demo results and labels the synthetic data", () => {
    render(<OverviewDashboard workspaceName="Synthetic" workspaceId="w1" demo overview={full} />, { locale: "en" });
    expect(screen.getByRole("note")).toHaveTextContent(/Synthetic offline demo.*fictional/);
    const start = within(screen.getByRole("region", { name: "Start here" }));
    expect(start.getByRole("link", { name: "Open the saved setup" })).toHaveAttribute("href", "/assessments/assessment-1#topology");
    expect(start.getByRole("link", { name: "Open the assessed scan" })).toHaveAttribute("href", "/inventory/scans/scan-0");
    expect(start.getByRole("link", { name: "Open the newest scan (not the assessed one)" })).toHaveAttribute("href", "/inventory/scans/scan-1");
    expect(start.getAllByRole("link").map(link => link.getAttribute("href"))[0]).toBe("/assessments/assessment-1#topology");
    expect(start.getByRole("link", { name: "Open the latest assessment" })).toHaveAttribute("href", "/assessments/assessment-1");
    expect(start.getByRole("link", { name: "Open the saved Build" })).toHaveAttribute("href", "/analyses/analysis-1");
    expect(start.getByRole("link", { name: "Open the saved Extend" })).toHaveAttribute("href", "/extensions/extension-1");
    expect(start.queryByText(/npm run demo/)).not.toBeInTheDocument();
  });

  it("does not lead the no-account demo walkthrough with Claude setup", () => {
    const actions = [{ key: "setup-claude", href: "/setup" }, { key: "check-network", href: "/network" }] as const;
    render(<OverviewDashboard workspaceName="Synthetic" workspaceId="w1" demo overview={{ ...full, actions: [...actions] }} />, { locale: "en" });
    const next = within(screen.getByRole("region", { name: "Next actions" })).getAllByRole("link").map(link => link.getAttribute("href"));
    expect(next).toEqual(["/network"]);
  });
});
