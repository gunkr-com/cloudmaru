import { renderWithI18n as render } from "@/test/render-with-i18n";
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { InputSummary } from "@/components/analysis/input-summary";
import { AVAILABILITY_OPTIONS, EXPECTED_USERS_OPTIONS } from "@/lib/analysis/input-schema";
import type { AnalysisInput } from "@/types/analysis";

const baseInput: AnalysisInput = {
  description: "회원 예약 웹 서비스입니다. 입력 내용을 줄바꿈으로 보존합니다.",
  expectedUsers: "under-100",
  monthlyBudget: 100_000, region: "canadacentral",
  availability: "low",
};

describe("InputSummary", () => {
  it("모든 선택지 라벨을 입력 스키마의 표기로 보여 준다", () => {
    for (const option of EXPECTED_USERS_OPTIONS) {
      const { unmount } = render(<InputSummary input={{ ...baseInput, expectedUsers: option.value }} />);
      expect(screen.getByText(option.label.ko)).toBeInTheDocument();
      unmount();
    }
    for (const option of AVAILABILITY_OPTIONS) {
      const { unmount } = render(<InputSummary input={{ ...baseInput, availability: option.value }} />);
      expect(screen.getByText(option.label.ko)).toBeInTheDocument();
      unmount();
    }
  });
});


it.each(["en", "ko"] as const)("%s에서 월 예산과 지역을 표시한다", (locale) => {
  render(<InputSummary input={{ ...baseInput, monthlyBudget: 1234 }} />, { locale });
  expect(screen.getByText(locale === "en" ? "CA$1,234/mo" : "CA$1,234/월")).toBeInTheDocument();
  expect(screen.getByText("Canada Central")).toBeInTheDocument();
});
