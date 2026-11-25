import { renderWithI18n as render } from "@/test/render-with-i18n";
import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HistoryList } from "@/components/analysis/history-list";
import type { HistoryRow } from "@/lib/dashboard/history";

const row: HistoryRow = {
  id: "a1", href: "/analyses/a1", rerunHref: "/analyses/new?from=a1", title: "예약 서비스",
  createdAt: "2026-10-07T12:00:00.000Z", status: "succeeded", statusLabel: null,
  recommended: { tier: "balanced", tierLabel: "균형", monthlyLabel: "CA$286,700/월" },
  conditionSummary: "사용자 10,000명 이하 · 월 예산 CA$300,000 · 가용성 보통",
};

describe("HistoryList", () => {
  it("shows an empty state with new analysis and sample links", () => {
    render(<HistoryList rows={[]} />);
    expect(screen.getByText("아직 분석이 없습니다.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "새 분석" })).toHaveAttribute("href", "/analyses/new");
    expect(screen.queryByRole("link", { name: "샘플 결과 보기" })).not.toBeInTheDocument();
  });

  it("shows whole-row title and rerun links without nesting links", () => {
    render(<HistoryList rows={[row]} />);
    expect(screen.getByRole("link", { name: "예약 서비스" })).toHaveAttribute("href", "/analyses/a1");
    expect(screen.getByRole("link", { name: "조건 바꿔 다시 분석" })).toHaveAttribute("href", "/analyses/new?from=a1");
    expect(document.querySelectorAll("a a")).toHaveLength(0);
  });

  it("renders pending and failed labels without a rerun action while pending", () => {
    const pending = { ...row, status: "pending" as const, statusLabel: "분석 중", recommended: null };
    const failed = { ...row, id: "a2", status: "failed" as const, statusLabel: "실패", recommended: null };
    render(<HistoryList rows={[pending, failed]} />);
    const list = screen.getByRole("list");
    const items = within(list).getAllByRole("listitem");
    expect(within(items[0]).getByText("분석 중")).toBeInTheDocument();
    expect(within(items[0]).queryByRole("link", { name: "조건 바꿔 다시 분석" })).not.toBeInTheDocument();
    expect(within(items[1]).getByText("실패")).toBeInTheDocument();
  });

  it("renders recommendation label and monthly amount", () => {
    render(<HistoryList rows={[row]} />);
    expect(screen.getByText("균형")).toBeInTheDocument();
    expect(screen.getByText("CA$286,700/월")).toBeInTheDocument();
  });
});

it("영어로 렌더링한다", () => { render(<HistoryList rows={[]} />, { locale: "en" }); expect(screen.getByText("No analyses yet.")).toBeInTheDocument(); });
