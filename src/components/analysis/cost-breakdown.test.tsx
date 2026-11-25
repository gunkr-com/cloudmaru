import { formatCostNote } from "@/lib/cost/format";
import { renderWithI18n as render } from "@/test/render-with-i18n";
import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CostBreakdown } from "@/components/analysis/cost-breakdown";
import { buildAnalysisResult } from "@/lib/analysis/build-result";
import sampleInput from "@/lib/analysis/fixtures/sample-input.json";
import sampleOutput from "@/lib/analysis/fixtures/sample-model-output.json";
import { analysisInputSchema, TIER_LABELS } from "@/lib/analysis/input-schema";
import { loadCatalog } from "@/lib/catalog/load";
import { formatMoney } from "@/i18n/format";

const outcome = buildAnalysisResult(sampleOutput, analysisInputSchema.parse(sampleInput), loadCatalog());
if (!outcome.ok) throw new Error(outcome.errors.join("\n"));
const result = outcome.result;

describe("CostBreakdown", () => {
  it.each(result.plans)("$tier 안의 실제 표에 항목·비고·금액과 합계를 표시한다", (plan) => {
    render(<CostBreakdown plan={plan} priceAsOf={result.priceAsOf} />);

    expect(screen.getByRole("heading", { name: "비용 내역" })).toBeInTheDocument();
    expect(screen.getByText(`${TIER_LABELS[plan.tier].ko} 안`)).toBeInTheDocument();
    expect(screen.getByText(`기준일 ${result.priceAsOf} · CAD`)).toBeInTheDocument();
    const table = screen.getByRole("table", { name: `${TIER_LABELS[plan.tier].ko} 안 비용 내역` });
    expect(table.tagName).toBe("TABLE");
    const rows = within(table.querySelector("tbody")!).getAllByRole("row");
    expect(rows).toHaveLength(plan.cost.lines.length);
    plan.cost.lines.forEach((line, index) => {
      const row = within(rows[index]);
      expect(row.getByText(line.name.ko)).toBeInTheDocument();
      expect(row.getByText(formatCostNote(line, "ko"))).toBeInTheDocument();
      expect(row.getByRole("cell", { name: formatMoney(line.amount, "CAD", "ko", { maximumFractionDigits: 2 }) })).toHaveClass("text-right", "tabular-nums");
    });
    const total = within(table.querySelector("tfoot")!);
    expect(total.getByText("합계")).toBeInTheDocument();
    expect(total.getByRole("cell", { name: formatMoney(plan.cost.total, "CAD", "ko") })).toHaveClass("text-right", "tabular-nums");
    expect(screen.getByText("예상 비용은 견적이며 실제 청구액과 다를 수 있습니다. 사용량 기반 항목은 표시된 가정을 기준으로 계산했습니다.")).toBeInTheDocument();
  });

  it("합계를 다시 계산하지 않고 전달받은 값을 그대로 표시한다", () => {
    const plan = result.plans[1];
    const suppliedTotal = result.plans[0].cost.total;
    render(<CostBreakdown plan={{ ...plan, cost: { ...plan.cost, total: suppliedTotal } }} priceAsOf={result.priceAsOf} />);

    const total = within(screen.getByRole("table").querySelector("tfoot")!);
    expect(total.getByText(formatMoney(suppliedTotal, "CAD", "ko"))).toBeInTheDocument();
  });
});
