import { renderWithI18n as render } from "@/test/render-with-i18n";
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AnalysisFailed } from "@/components/analysis/analysis-failed";
import type { AnalysisInput } from "@/types/analysis";

const input: AnalysisInput = {
  description: "예약 웹 서비스입니다. PostgreSQL 데이터베이스를 사용합니다.",
  expectedUsers: "under-1k",
  monthlyBudget: 100_000, region: "canadacentral",
  availability: "low",
};

describe("AnalysisFailed", () => {
  it.each([
    ["failed", "분석 결과를 만들지 못했습니다."],
    ["timeout", "분석이 제한 시간 안에 끝나지 않았습니다."],
  ] as const)("%s 이유의 한국어 안내와 다시 시도 링크를 표시한다", (reason, message) => {
    render(<AnalysisFailed reason={reason} retryHref="/analyses/new?source=abc" />);
    expect(screen.getByRole("alert")).toHaveTextContent(message);
    expect(screen.getByRole("link", { name: "다시 시도" })).toHaveAttribute("href", "/analyses/new?source=abc");
    expect(screen.queryByText("보낸 요구사항")).not.toBeInTheDocument();
  });

  it("입력이 있을 때만 요구사항 요약을 함께 보여 준다", () => {
    render(<AnalysisFailed reason="failed" retryHref="/retry" input={input} />);
    expect(screen.getByText("보낸 요구사항")).toBeInTheDocument();
    expect(screen.getByText(input.description)).toBeInTheDocument();
  });
});

it("영어로 렌더링한다", () => { render(<AnalysisFailed reason="timeout" retryHref="/retry" />, { locale: "en" }); expect(screen.getByRole("alert")).toHaveTextContent("The analysis did not finish within the time limit."); });
