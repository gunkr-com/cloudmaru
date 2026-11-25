import { renderWithI18n as render } from "@/test/render-with-i18n";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PlanComparison } from "@/components/analysis/plan-comparison";
import { buildAnalysisResult } from "@/lib/analysis/build-result";
import sampleInput from "@/lib/analysis/fixtures/sample-input.json";
import sampleOutput from "@/lib/analysis/fixtures/sample-model-output.json";
import { analysisInputSchema, TIER_LABELS } from "@/lib/analysis/input-schema";
import { loadCatalog } from "@/lib/catalog/load";
import { formatBudgetRatio } from "@/lib/cost/format";
import { formatMoney } from "@/i18n/format";

const outcome = buildAnalysisResult(sampleOutput, analysisInputSchema.parse(sampleInput), loadCatalog());
if (!outcome.ok) throw new Error(outcome.errors.join("\n"));
const plans = outcome.result.plans;

describe("PlanComparison", () => {
  it("omits the compact summary when the parent already provides the complete option matrix", () => {
    render(<PlanComparison plans={plans} selectedTier="balanced" onSelect={vi.fn()} showCompactSummary={false} />);
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getAllByRole("article")).toHaveLength(3);
  });
  it("low·balanced·ha 순서의 카드와 선택된 카드 하나만 표시한다", () => {
    const { rerender } = render(<PlanComparison plans={plans} selectedTier="balanced" onSelect={vi.fn()} />);
    const cards = screen.getAllByRole("article");
    expect(cards).toHaveLength(3);
    ["low", "balanced", "ha"].forEach((tier, index) => {
      expect(plans[index].tier).toBe(tier);
      expect(within(cards[index]).getByRole("heading", { name: plans[index].title.ko })).toBeInTheDocument();
    });
    expect(screen.getAllByRole("button", { pressed: true })).toHaveLength(1);
    expect(within(cards[1]).getByRole("button")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getAllByRole("button", { pressed: false })).toHaveLength(2);
    expect(cards[0].parentElement).toHaveClass("grid", "grid-cols-1", "gap-4", "xl:grid-cols-3");

    rerender(<PlanComparison plans={plans} selectedTier="ha" onSelect={vi.fn()} />);
    expect(screen.getAllByRole("button", { pressed: true })).toHaveLength(1);
    expect(within(cards[2]).getByRole("button")).toHaveAttribute("aria-pressed", "true");
  });

  it("각 카드의 선택을 부모에 전달한다", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<PlanComparison plans={plans} selectedTier="balanced" onSelect={onSelect} />);

    for (const plan of plans) {
      await user.click(screen.getByRole("button", { name: `${plan.title.ko} 선택` }));
      expect(onSelect).toHaveBeenLastCalledWith(plan.tier);
    }
    expect(onSelect).toHaveBeenCalledTimes(plans.length);
  });

  it("각 안을 다이어그램 렌더러에 전달하고 해당 카드에 표시한다", () => {
    const renderDiagram = vi.fn((plan: (typeof plans)[number]) => <div>{TIER_LABELS[plan.tier].ko} 도식</div>);
    render(<PlanComparison plans={plans} selectedTier="low" onSelect={vi.fn()} renderDiagram={renderDiagram} />);

    const cards = screen.getAllByRole("article");
    plans.forEach((plan, index) => {
      expect(renderDiagram).toHaveBeenCalledWith(plan);
      expect(within(cards[index]).getByText(`${TIER_LABELS[plan.tier].ko} 도식`)).toBeInTheDocument();
    });
    expect(screen.queryByText("아키텍처 다이어그램")).not.toBeInTheDocument();
  });

  it("입력 배열 순서와 무관하게 tier 순서로 카드와 모바일 요약 표를 표시한다", () => {
    const shuffled = [plans[2], plans[0], plans[1]];
    render(<PlanComparison plans={shuffled} selectedTier="balanced" onSelect={vi.fn()} selectionHint="카드를 누르세요." />);
    expect(screen.getByText("카드를 누르세요.")).toBeInTheDocument();
    const cards = screen.getAllByRole("article");
    expect(cards.map((card) => card.querySelector("button")?.getAttribute("aria-label"))).toEqual(
      plans.map((plan) => `${plan.title.ko} 선택`),
    );
    const table = screen.getByRole("table");
    expect(within(table).getByRole("caption", { name: "세 안 요약" })).toBeInTheDocument();
    const rows = within(table).getAllByRole("row");
    expect(rows).toHaveLength(4);
    plans.forEach((plan, index) => {
      expect(within(rows[index + 1]).getByText(TIER_LABELS[plan.tier].ko)).toBeInTheDocument();
      expect(within(rows[index + 1]).getByText(`${formatMoney(plan.cost.total, "CAD", "ko")}/월`)).toBeInTheDocument();
      expect(within(rows[index + 1]).getByText(plan.cost.budgetRatio === null ? "—" : formatBudgetRatio(plan.cost.budgetRatio))).toBeInTheDocument();
      if (plan.recommended) expect(within(rows[index + 1]).getByText("추천")).toBeInTheDocument();
    });
  });

  it("selectionHint는 기본으로 렌더하지 않는다", () => {
    render(<PlanComparison plans={plans} selectedTier="balanced" onSelect={vi.fn()} />);
    expect(screen.queryByText("카드를 누르면 아래 비용 내역과 구축 결과물이 그 안으로 바뀝니다.")).not.toBeInTheDocument();
  });
});
