import { renderWithI18n as render } from "@/test/render-with-i18n";
import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { JourneySteps } from "@/components/analysis/journey-steps";

const names = ["요구사항 입력", "세 가지 안 비교", "구축 결과물"];

describe("JourneySteps", () => {
  it("세 단계 이름을 고정 순서로 표시한다", () => {
    render(<JourneySteps current="input" />);
    const list = within(screen.getByRole("list", { name: "진행 단계" }));
    expect(list.getAllByRole("listitem").map((item) => item.querySelector("span")?.textContent)).toEqual(names);
  });

  it.each(["input", "compare", "build"] as const)("%s 단계만 현재 단계로 표시한다", (current) => {
    render(<JourneySteps current={current} />);
    const currentItem = screen.getByRole("listitem", { current: "step" });
    expect(currentItem).toHaveTextContent(names[["input", "compare", "build"].indexOf(current)]);
    expect(screen.getAllByRole("listitem").filter((item) => item.getAttribute("aria-current") === "step")).toHaveLength(1);
  });
});

it("영어로 렌더링한다", () => { render(<JourneySteps current="input" />, { locale: "en" }); expect(screen.getByText("Requirements")).toBeInTheDocument(); });
