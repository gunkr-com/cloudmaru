import { renderWithI18n as render } from "@/test/render-with-i18n";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PlanCard } from "@/components/analysis/plan-card";
import { buildAnalysisResult } from "@/lib/analysis/build-result";
import sampleInput from "@/lib/analysis/fixtures/sample-input.json";
import sampleOutput from "@/lib/analysis/fixtures/sample-model-output.json";
import { analysisInputSchema, TIER_LABELS } from "@/lib/analysis/input-schema";
import { loadCatalog } from "@/lib/catalog/load";
import { formatBudgetRatio, formatQuantity } from "@/lib/cost/format";
import { formatMoney } from "@/i18n/format";

const outcome = buildAnalysisResult(sampleOutput, analysisInputSchema.parse(sampleInput), loadCatalog());
if (!outcome.ok) throw new Error(outcome.errors.join("\n"));
const plans = outcome.result.plans;
const plan = plans[1];

describe("PlanCard", () => {
  it("이름·단계·계산된 금액·예산 대비·구성 서비스·장점·카탈로그 출처를 표시한다", () => {
    render(<PlanCard plan={plan} selected={false} />);

    expect(screen.getByRole("heading", { name: plan.title.ko })).toBeInTheDocument();
    expect(screen.getAllByText(TIER_LABELS[plan.tier].ko)).toHaveLength(2);

    expect(screen.getByText(formatMoney(plan.cost.total, "CAD", "ko"))).toBeInTheDocument();
    expect(screen.getByText("/월")).toBeInTheDocument();
    expect(screen.getByText(`예산 대비 ${formatBudgetRatio(plan.cost.budgetRatio!)}`)).toBeInTheDocument();

    const services = within(screen.getByRole("list", { name: "구성 서비스" })).getAllByRole("listitem");
    expect(services).toHaveLength(plan.services.length);
    plan.services.forEach((service, index) => {
      expect(within(services[index]).getByText(service.name.ko)).toBeInTheDocument();
      expect(within(services[index]).getByText(formatQuantity(service.quantity, service.unitLabel, "ko"))).toBeInTheDocument();
    });
    const pros = within(screen.getByRole("list", { name: "장점" }));
    plan.pros.forEach((pro) => expect(pros.getByText(pro.ko)).toBeInTheDocument());

    expect(screen.getAllByRole("link")).toHaveLength(plan.referenceArchitecture.sources.length);
    for (const source of plan.referenceArchitecture.sources) {
      const link = screen.getByRole("link", { name: `${source.title} (새 탭)` });
      expect(link).toHaveAttribute("href", source.url);
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noopener noreferrer");
      expect(link.parentElement).toHaveTextContent(`근거 · ${source.title} (새 탭)`);
    }
  });

  it("구성 서비스 수량은 비용 내역처럼 천 단위 쉼표와 붙인 단위로 표시하고 저장된 단위 스냅샷을 따른다", () => {
    const services = [
      { componentId: "app-service-linux-b1", name: { en: "App Service", ko: "App Service" }, quantity: 1, unitLabel: { en: "대", ko: "대" } },
      { componentId: "key-vault-operations", name: { en: "Key Vault", ko: "Key Vault" }, quantity: 10, unitLabel: { en: "만 건", ko: "만 건" } },
      { componentId: "functions-consumption-duration", name: { en: "Functions 실행 시간", ko: "Functions 실행 시간" }, quantity: 200000, unitLabel: { en: "GB·초", ko: "GB·초" } },
      { componentId: "functions-consumption-executions", name: { en: "Functions 실행 횟수", ko: "Functions 실행 횟수" }, quantity: 1000000, unitLabel: { en: "회", ko: "회" } },
      // 단위가 "10회"이던 때 저장된 결과는 수량과 단위를 붙이면 "10000010회"처럼 읽힌다.
      { componentId: "functions-consumption-legacy", name: { en: "예전 Functions 실행 횟수", ko: "예전 Functions 실행 횟수" }, quantity: 100000, unitLabel: { en: "10회", ko: "10회" } },
    ];
    render(<PlanCard plan={{ ...plan, services }} selected={false} />);

    const items = within(screen.getByRole("list", { name: "구성 서비스" })).getAllByRole("listitem");
    expect(items.map((item) => item.lastElementChild?.textContent)).toEqual([
      "1대", "10만 건", "200,000GB·초", "1,000,000회", "100,000 × 10회",
    ]);
  });

  it.each(plans)("$tier 안은 추천 여부와 선택 여부를 독립적으로 표시한다", (item) => {
    render(<PlanCard plan={item} selected />);

    expect(screen.getByRole("button", { name: `${item.title.ko} 선택` })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("article")).toHaveClass("outline-2", "outline-offset-4", "outline-ink");
    expect(screen.getByRole("article")).toHaveClass(item.recommended ? "border-border-recommended" : "border-hairline");
    if (item.recommended) expect(screen.getByText("추천")).toBeInTheDocument();
    else expect(screen.queryByText("추천")).not.toBeInTheDocument();
  });

  it("선택하지 않은 카드는 선택 외곽선이 없고 alignRows는 subgrid 행을 사용한다", () => {
    const { rerender } = render(<PlanCard plan={plan} selected={false} />);
    expect(screen.getByRole("article")).not.toHaveClass("outline-2", "outline-ink");
    rerender(<PlanCard plan={plan} selected={false} alignRows />);
    expect(screen.getByRole("article")).toHaveClass("xl:row-span-7", "xl:grid", "xl:grid-rows-subgrid");
    // xl 미만에서는 subgrid가 없으므로 정렬하지 않는 카드와 같은 세로 간격을 둔다.
    expect(screen.getByRole("article")).toHaveClass("max-xl:flex", "max-xl:flex-col", "max-xl:gap-5");
  });

  it("alignRows에서 선택 버튼 위에 놓인 다이어그램·근거 영역은 행 높이로 늘어나지 않는다", () => {
    // 늘어나면 더 짧은 카드의 빈 자리가 투명한 z-20 영역에 덮여 카드를 눌러도 선택되지 않는다.
    render(<PlanCard plan={plan} selected={false} alignRows diagram={<div data-testid="diagram" />} />);
    expect(screen.getByTestId("diagram").parentElement).toHaveClass("z-20", "xl:self-start");
    const sources = screen.getAllByRole("link", { name: /\(새 탭\)/ })[0].closest("ul");
    expect(sources).toHaveClass("z-20", "xl:self-start");
  });

  it("예산 대비가 null이면 생략하고 0이면 표시한다", () => {
    const { rerender } = render(<PlanCard plan={{ ...plan, cost: { ...plan.cost, budgetRatio: null } }} selected={false} />);
    expect(screen.queryByText(/예산 대비/)).not.toBeInTheDocument();

    rerender(<PlanCard plan={{ ...plan, cost: { ...plan.cost, budgetRatio: 0 } }} selected={false} />);
    expect(screen.getByText(`예산 대비 ${formatBudgetRatio(0)}`)).toBeInTheDocument();
  });

  it("클릭과 키보드 선택은 해당 단계를 전달하고 선택 상태는 props를 따른다", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<PlanCard plan={plan} selected={false} onSelect={onSelect} />);
    const button = screen.getByRole("button", { name: `${plan.title.ko} 선택` });

    await user.click(button);
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(plan.tier);
    expect(button).toHaveAttribute("aria-pressed", "false");
    onSelect.mockClear();
    await user.keyboard("{Enter}");
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(plan.tier);
  });

  it("출처 링크는 선택 버튼과 분리되어 안을 선택하지 않는다", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<PlanCard plan={plan} selected={false} onSelect={onSelect} />);
    const link = screen.getAllByRole("link")[0];

    expect(link.closest("button")).toBeNull();
    await user.click(link);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("선택 콜백 없이도 카드를 표시하고 클릭할 수 있다", async () => {
    const user = userEvent.setup();
    render(<PlanCard plan={plan} selected={false} />);
    await user.click(screen.getByRole("button", { name: `${plan.title.ko} 선택` }));
    expect(screen.getByRole("article")).toBeInTheDocument();
  });

  it("다이어그램이 없으면 공용 줄무늬 자리, 있으면 전달한 노드를 표시한다", () => {
    const { rerender } = render(<PlanCard plan={plan} selected={false} />);
    expect(screen.getByText("아키텍처 다이어그램")).toHaveClass("diagram-placeholder", "h-[120px]");

    rerender(<PlanCard plan={plan} selected={false} diagram={<div>전달된 다이어그램</div>} />);
    expect(screen.getByText("전달된 다이어그램")).toBeInTheDocument();
    expect(screen.queryByText("아키텍처 다이어그램")).not.toBeInTheDocument();
  });
});
