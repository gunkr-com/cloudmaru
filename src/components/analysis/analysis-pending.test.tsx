import { renderWithI18n as render } from "@/test/render-with-i18n";
import { act, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AnalysisPending } from "@/components/analysis/analysis-pending";
import type { AnalysisInput } from "@/types/analysis";

const input: AnalysisInput = {
  description: "예약 서비스 요구사항입니다.\n두 번째 줄도 유지합니다.",
  expectedUsers: "under-10k",
  monthlyBudget: 300_000, region: "canadacentral",
  availability: "medium",
};

describe("AnalysisPending", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("진행률을 만들지 않고 120초부터 오래 걸리는 문구를 표시한다", () => {
    vi.setSystemTime(new Date("2026-10-14T00:00:42Z"));
    render(<AnalysisPending input={input} createdAt="2026-10-14T00:00:00Z" />);
    expect(screen.getByRole("status")).toHaveTextContent("분석 중입니다. 보통 1~2분 걸립니다.");
    expect(screen.getByRole("progressbar", { name: "분석 진행 상태" })).not.toHaveAttribute("aria-valuenow");
    expect(screen.getByText("0:42")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(83_000));
    expect(screen.getByText("2:05")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("평소보다 오래 걸리고 있습니다. 조금만 더 기다려 주세요.");
    expect(screen.getByRole("status")).not.toHaveTextContent("2:05");
  });

  it("경과 시간 이름은 aria-label 대신 라이브 영역 밖의 화면 밖 텍스트로 둔다", () => {
    vi.setSystemTime(new Date("2026-10-14T00:00:42Z"));
    render(<AnalysisPending input={input} createdAt="2026-10-14T00:00:00Z" />);
    const label = screen.getByText("경과 시간");
    const elapsed = screen.getByText("0:42");
    expect(label).toHaveClass("sr-only");
    expect(elapsed).toContainElement(label);
    expect(elapsed).toHaveTextContent("경과 시간 0:42");
    expect(elapsed).not.toHaveAttribute("aria-label");
    expect(screen.getByRole("status")).not.toContainElement(elapsed);
  });

  it("시계 차이가 미래 createdAt을 만들면 0:00으로 제한한다", () => {
    vi.setSystemTime(new Date("2026-10-14T00:00:00Z"));
    render(<AnalysisPending input={input} createdAt="2026-10-14T00:01:00Z" />);
    expect(screen.getByText("0:00")).toBeInTheDocument();
  });

  it("읽기 전용 입력 요약과 페이지를 떠나도 계속되는 안내를 보인다", () => {
    render(<AnalysisPending input={input} createdAt="2026-10-14T00:00:00Z" />);
    const description = screen.getByText((_, element) => element?.tagName === "DD" && element.textContent === input.description);
    expect(description).toHaveClass("whitespace-pre-wrap");
    expect(screen.getByText("10,000명 이하")).toBeInTheDocument();
    expect(screen.getByText("CA$300,000/월")).toBeInTheDocument();
    expect(screen.getByText("보통")).toBeInTheDocument();
    expect(screen.getByText("Canada Central")).toBeInTheDocument();
    expect(screen.getByText("페이지를 떠나도 분석은 계속됩니다. 결과는 분석 기록에 남습니다.")).toBeInTheDocument();
  });

  it("언마운트하면 경과 시간 타이머를 정리한다", () => {
    const { unmount } = render(<AnalysisPending input={input} createdAt="2026-10-14T00:00:00Z" />);
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});

it("영어로 렌더링한다", () => { render(<AnalysisPending input={input} createdAt={new Date().toISOString()} />, { locale: "en" }); expect(screen.getByRole("status")).toHaveTextContent("Analyzing. This usually takes 1–2 minutes."); });
