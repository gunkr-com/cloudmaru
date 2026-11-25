import { I18nProvider } from "@/i18n/provider";
import { formatCostNote } from "@/lib/cost/format";
import { renderWithI18n as render } from "@/test/render-with-i18n";
import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AnalysisResultView } from "@/components/analysis/analysis-result-view";
import { buildAnalysisResult } from "@/lib/analysis/build-result";
import sampleInput from "@/lib/analysis/fixtures/sample-input.json";
import sampleOutput from "@/lib/analysis/fixtures/sample-model-output.json";
import { analysisInputSchema, AVAILABILITY_OPTIONS, EXPECTED_USERS_OPTIONS, TIER_LABELS } from "@/lib/analysis/input-schema";
import { loadCatalog } from "@/lib/catalog/load";
import { formatMoney, formatMonthlyMoney } from "@/i18n/format";
import { buildPlanDiagrams } from "@/lib/diagram/plan-diagrams";

// 결과물 섹션이 결과물이 끝나면 router.refresh()로 사이드바 비용을 다시 읽는다.
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("@/components/analysis/architecture-diagram", () => ({
  ArchitectureDiagram: ({ code, fullCode, label }: { code: string; fullCode?: string; label: string }) => (
    <div role="img" aria-label={label} data-code={code} data-full-code={fullCode} />
  ),
}));

const outcome = buildAnalysisResult(sampleOutput, analysisInputSchema.parse(sampleInput), loadCatalog());
if (!outcome.ok) throw new Error(outcome.errors.join("\n"));
const result = outcome.result;
const scopeNotice = "요청하신 내용은 현재 지원 범위(웹앱·API + 데이터베이스) 밖입니다. 가장 가까운 구성으로 추천했습니다.";

describe("AnalysisResultView", () => {
  it("제목·입력 요약·추천 이유·세 카드·추천 비용 내역과 견적·초안 고지를 표시한다", () => {
    render(<AnalysisResultView result={result} />);

    expect(screen.getByText("분석 결과")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: result.requestTitle.ko })).toBeInTheDocument();
    expect(screen.getByText("사용자 10,000명 이하 · 월 예산 CA$300/월 · 가용성 보통 · Canada Central")).toBeInTheDocument();
    expect(screen.getByText(result.recommendationReason.ko)).toBeInTheDocument();
    expect(screen.getAllByRole("article")).toHaveLength(3);
    const recommended = result.plans.find((plan) => plan.tier === result.recommendedTier)!;
    expect(screen.getByRole("button", { name: `${recommended.title.ko} 선택`, pressed: true })).toBeInTheDocument();
    const table = screen.getByRole("table", { name: `${TIER_LABELS[recommended.tier].ko} 안 비용 내역` });
    expect(within(table).getByRole("row", { name: `합계 ${formatMoney(recommended.cost.total, "CAD", "ko")}` })).toBeInTheDocument();
    expect(screen.getByText(`기준일 ${result.priceAsOf} · CAD`)).toBeInTheDocument();
    expect(screen.getByText(/예상 비용은 견적이며 실제 청구액과 다를 수 있습니다/)).toBeInTheDocument();
    expect(screen.getByText("Bicep 코드는 검증 전 초안으로 제공됩니다.")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "생성하기" })).toHaveLength(3);
  });

  it("각 카드에 해당 안의 카드용 그림과 큰 그림 정의만 전달한다", () => {
    render(<AnalysisResultView result={result} />);
    const cards = screen.getAllByRole("article");
    result.plans.forEach((plan, index) => {
      const { preview, full } = buildPlanDiagrams(plan, "ko");
      const diagram = within(cards[index]).getByRole("img", { name: `${TIER_LABELS[plan.tier].ko} 안 아키텍처 다이어그램` });
      expect(diagram).toHaveAttribute("data-code", preview);
      expect(diagram).toHaveAttribute("data-full-code", full);
    });
  });

  it("다른 카드를 선택하면 해당 안의 비용 내역과 합계로 바뀐다", async () => {
    const user = userEvent.setup();
    render(<AnalysisResultView result={result} />);

    for (const plan of [result.plans[0], result.plans[2]]) {
      await user.click(screen.getByRole("button", { name: `${plan.title.ko} 선택` }));
      expect(screen.getAllByRole("button", { pressed: true })).toHaveLength(1);
      expect(screen.getByRole("button", { name: `${plan.title.ko} 선택` })).toHaveAttribute("aria-pressed", "true");
      const table = screen.getByRole("table", { name: `${TIER_LABELS[plan.tier].ko} 안 비용 내역` });
      expect(within(table).getByRole("row", { name: `합계 ${formatMoney(plan.cost.total, "CAD", "ko")}` })).toBeInTheDocument();
      plan.cost.lines.forEach((line) => {
        const row = within(table).getByText(line.name.ko).closest("tr")!;
        expect(within(row).getByText(formatCostNote(line, "ko"))).toBeInTheDocument();
      });
      expect(screen.getByText(result.recommendationReason.ko)).toBeInTheDocument();
    }
  });

  it.each([false, true])("범위 밖 고지는 outOfScope=%s를 따른다", (outOfScope) => {
    render(<AnalysisResultView result={{ ...result, outOfScope }} />);
    if (outOfScope) expect(screen.getByText(scopeNotice)).toHaveClass("text-warning");
    else expect(screen.queryByText(scopeNotice)).not.toBeInTheDocument();
  });

  it.each(EXPECTED_USERS_OPTIONS)("사용자 수 $value와 가용성 선택지의 한국어 표기를 재사용한다", (option) => {
    const availability = AVAILABILITY_OPTIONS[2];
    render(<AnalysisResultView result={{ ...result, input: { ...result.input, expectedUsers: option.value, availability: availability.value } }} />);
    expect(screen.getByText(`사용자 ${option.label.ko} · 월 예산 ${formatMonthlyMoney(result.input.monthlyBudget, "CAD", "ko")} · 가용성 ${availability.label.ko} · Canada Central`)).toBeInTheDocument();
  });

  it("추천 안이 첫 카드여도 그 안을 처음 선택하고 다음 phase의 조작은 제공하지 않는다", () => {
    render(<AnalysisResultView result={{ ...result, recommendedTier: "low", plans: result.plans.map((plan) => ({ ...plan, recommended: plan.tier === "low" })) }} />);
    expect(screen.getByRole("button", { name: `${result.plans[0].title.ko} 선택`, pressed: true })).toBeInTheDocument();
    expect(screen.getByRole("table", { name: "최저 비용 안 비용 내역" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "조건 바꿔 다시 분석" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "이 안으로 구축 시작" })).not.toBeInTheDocument();
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
  });

  it("날짜·다시 분석 링크·선택 tier 기반 구축 이동을 제공한다", async () => {
    const user = userEvent.setup();
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    window.matchMedia = vi.fn().mockReturnValue({ matches: false });
    // 현지 날짜로 보인다. 11:00Z는 UTC-11~UTC+12 어디서나 같은 날이다.
    render(<AnalysisResultView result={result} createdAt="2026-10-06T11:00:00.000Z" rerunHref="/again" showBuildAction />);
    expect(screen.getByText(/^분석 결과/)).toHaveTextContent("분석 결과 · 2026-10-06");
    expect(screen.getByRole("link", { name: "조건 바꿔 다시 분석" })).toHaveAttribute("href", "/again");
    const ha = result.plans.find((plan) => plan.tier === "ha")!;
    const action = screen.getByRole("button", { name: "균형 안으로 구축 시작" });
    await user.click(screen.getByRole("button", { name: `${ha.title.ko} 선택` }));
    expect(screen.getByRole("button", { name: "고가용성 안으로 구축 시작" })).toBeInTheDocument();
    const focus = vi.spyOn(HTMLElement.prototype, "focus");
    await user.click(screen.getByRole("button", { name: "고가용성 안으로 구축 시작" }));
    expect(scrollIntoView).toHaveBeenCalled();
    const heading = screen.getByRole("heading", { name: "고가용성 안 구축 결과물" });
    expect(heading).toHaveFocus();
    // 스크롤 직후 기본 focus()는 Chromium에서 부드러운 스크롤을 끊는다.
    expect(focus.mock.calls[focus.mock.contexts.indexOf(heading)]).toEqual([{ preventScroll: true }]);
    focus.mockRestore();
    expect(action).toBeInTheDocument();
  });

  it("제어 모드 선택을 반영하고 콜백을 호출하되 부모 갱신 전 선택을 바꾸지 않는다", async () => {
    const user = userEvent.setup();
    const onSelectTier = vi.fn();
    render(<AnalysisResultView result={result} selectedTier="ha" onSelectTier={onSelectTier} />);
    expect(screen.getByRole("button", { name: `${result.plans.find((plan) => plan.tier === "ha")!.title.ko} 선택`, pressed: true })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: `${result.plans[0].title.ko} 선택` }));
    expect(onSelectTier).toHaveBeenCalledWith(result.plans[0].tier);
    expect(screen.getByRole("button", { name: `${result.plans.find((plan) => plan.tier === "ha")!.title.ko} 선택`, pressed: true })).toBeInTheDocument();
  });

  describe("추천 이유 두 줄 접기", () => {
    // jsdom에는 레이아웃이 없다. 추천 이유 문단이 두 줄을 넘는지만 흉내 낸다.
    let overflowing = false;
    beforeEach(() => {
      overflowing = false;
      vi.spyOn(Element.prototype, "scrollHeight", "get").mockImplementation(function (this: Element) {
        return this.id === "recommendation-reason" && overflowing ? 96 : 48;
      });
      vi.spyOn(Element.prototype, "clientHeight", "get").mockReturnValue(48);
    });
    afterEach(() => {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    });

    it("두 줄을 넘는 이유는 글자 수와 관계없이 접고 펼친다", async () => {
      const user = userEvent.setup();
      overflowing = true;
      render(<AnalysisResultView result={{ ...result, recommendationReason: { en: "A short reason that wraps on narrow screens", ko: "짧지만 좁은 화면에서 넘치는 이유" } }} />);
      const reason = screen.getByText("짧지만 좁은 화면에서 넘치는 이유");
      expect(reason).toHaveClass("line-clamp-2");
      await user.click(screen.getByRole("button", { name: "더 보기", expanded: false }));
      expect(screen.getByRole("button", { name: "접기", expanded: true })).toBeInTheDocument();
      expect(reason).not.toHaveClass("line-clamp-2");
      await user.click(screen.getByRole("button", { name: "접기" }));
      expect(screen.getByRole("button", { name: "더 보기", expanded: false })).toBeInTheDocument();
      expect(reason).toHaveClass("line-clamp-2");
    });

    it("두 줄 안에 들어가면 길어도 토글 없이 두 줄 제한만 둔다", () => {
      const long = "이유".repeat(80);
      render(<AnalysisResultView result={{ ...result, recommendationReason: { en: "A longer reason", ko: long } }} />);
      expect(screen.getByText(long)).toHaveClass("line-clamp-2");
      expect(screen.queryByRole("button", { name: "더 보기" })).not.toBeInTheDocument();
    });

    it("크기가 바뀌면 다시 재서 토글을 갱신하고 언마운트하면 관찰을 멈춘다", () => {
      const observers: { callback: ResizeObserverCallback; disconnect: ReturnType<typeof vi.fn> }[] = [];
      vi.stubGlobal("ResizeObserver", class {
        disconnect = vi.fn();
        constructor(callback: ResizeObserverCallback) { observers.push({ callback, disconnect: this.disconnect }); }
        observe() {}
        unobserve() {}
      });
      const { unmount } = render(<AnalysisResultView result={result} />);
      expect(screen.queryByRole("button", { name: "더 보기" })).not.toBeInTheDocument();
      overflowing = true;
      const observer = observers.at(-1)!;
      act(() => observer.callback([], {} as ResizeObserver));
      expect(screen.getByRole("button", { name: "더 보기", expanded: false })).toBeInTheDocument();
      unmount();
      expect(observer.disconnect).toHaveBeenCalled();
    });
  });

  it("예산 초과 경고는 세 안 모두의 검증된 비율일 때만 표시한다", () => {
    const plans = result.plans.map((plan, index) => ({ ...plan, cost: { ...plan.cost, budgetRatio: [1.4, 2, 1.8][index] } }));
    const { rerender } = render(<AnalysisResultView result={{ ...result, plans }} />);
    expect(screen.getByText("세 안 모두 월 예산을 넘습니다. 가장 낮은 안은 예산의 140%입니다.")).toBeInTheDocument();
    rerender(<AnalysisResultView result={{ ...result, plans: plans.map((plan, index) => ({ ...plan, cost: { ...plan.cost, budgetRatio: index === 0 ? 1 : null } })) }} />);
    expect(screen.queryByText(/세 안 모두 월 예산/)).not.toBeInTheDocument();
  });

  it("결과물 renderer에는 현재 선택한 안을 전달하고 선택 안내를 표시한다", async () => {
    const user = userEvent.setup();
    const renderArtifacts = vi.fn((plan) => <div>사용자 결과물: {plan.tier}</div>);
    render(<AnalysisResultView result={result} renderArtifacts={renderArtifacts} />);
    expect(screen.getByText("카드를 누르면 아래 비용 내역과 구축 결과물이 그 안으로 바뀝니다.")).toBeInTheDocument();
    expect(screen.getByText(`사용자 결과물: ${result.recommendedTier}`)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: `${result.plans[0].title.ko} 선택` }));
    expect(screen.getByText(`사용자 결과물: ${result.plans[0].tier}`)).toBeInTheDocument();
  });
});

it("renders English catalog names, quantity notes, and diagrams and English model prose", () => {
  render(<AnalysisResultView result={result} />, { locale: "en" });
  expect(screen.getByRole("heading", { level: 1, name: result.requestTitle.en })).toBeInTheDocument();
  expect(screen.getByText(result.recommendationReason.en)).toBeInTheDocument();
  const plan = result.plans.find(plan => plan.tier === result.recommendedTier)!;
  const table = within(screen.getByRole("table", { name: `${TIER_LABELS[plan.tier].en} option cost breakdown` }));
  for (const line of plan.cost.lines) {
    expect(table.getByText(line.name.en)).toBeInTheDocument();
    expect(table.getAllByText(formatCostNote(line, "en")).length).toBeGreaterThan(0);
    expect(formatCostNote(line, "en")).not.toMatch(/[가-힣]/);
  }
  for (const [index, diagram] of screen.getAllByRole("img").entries()) {
    expect(diagram.getAttribute("data-code")).toBe(buildPlanDiagrams(result.plans[index], "en").preview);
    expect(diagram.getAttribute("data-code")).toContain("Users");
    expect(diagram.getAttribute("data-code")).not.toMatch(/[가-힣]/);
  }
  for (const plan of result.plans) {
    expect(screen.getByRole("heading", { name: plan.title.en })).toBeInTheDocument();
    for (const pro of plan.pros) expect(screen.getAllByText(pro.en).length).toBeGreaterThan(0);
  }
});


it("영어 결과는 option 용어·CAD·매개변수 경고를 표시하고 영어 모델 문장을 표시한다", () => {
  const overBudget = { ...result, outOfScope: true, plans: result.plans.map(plan => ({ ...plan, cost: { ...plan.cost, budgetRatio: 1.4 } })) };
  render(<AnalysisResultView result={overBudget} createdAt="2026-11-05T12:00:00" rerunHref="/analyses/new" showBuildAction renderArtifacts={() => null} />, { locale: "en" });
  expect(screen.getByText(/^Analysis results/)).toHaveTextContent("Analysis results · 2026-11-05");
  expect(screen.getByRole("heading", { name: result.requestTitle.en })).toBeInTheDocument();
  expect(screen.getByText(result.recommendationReason.en)).toBeInTheDocument();
  expect(screen.getByText("All three options exceed your monthly budget. The lowest cost option is 140% of your budget.")).toBeInTheDocument();
  expect(screen.getByText(/outside the current scope/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Start building with/ })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Re-run with changes" })).toBeInTheDocument();
  expect(screen.getByRole("region", { name: "Compare options" })).toBeInTheDocument();
  expect(screen.getByRole("table", { name: "Option comparison" })).toHaveTextContent("CA$");
  expect(screen.getByRole("region", { name: "Cost breakdown" })).toHaveTextContent("CA$");
  expect(screen.getByRole("region", { name: "Cost breakdown" })).toHaveTextContent("Price as of");
  expect(screen.getAllByText("Recommended")).toHaveLength(1);
  expect(screen.getAllByText("Budget ratio: 140%")).toHaveLength(3);
  expect(screen.getAllByRole("list", { name: "Services in this option" })).toHaveLength(3);
  for (const plan of result.plans) {
    expect(screen.getByRole("button", { name: `Select ${plan.title.en}` })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: `${TIER_LABELS[plan.tier].en} option architecture diagram` })).toHaveAttribute("data-code", buildPlanDiagrams(plan, "en").preview);
    plan.pros.forEach(pro => expect(screen.getByText(pro.en)).toBeInTheDocument());
  }
});

it("언어 전환은 선택한 안을 유지하고 다이어그램 정의와 접근성 이름을 바꾼다", async () => {
  const user = userEvent.setup();
  const view = render(<I18nProvider locale="ko"><AnalysisResultView result={result} renderArtifacts={() => null} /></I18nProvider>);
  const selected = result.plans[0];
  await user.click(screen.getByRole("button", { name: `${selected.title.ko} 선택` }));
  view.rerender(<I18nProvider locale="en"><AnalysisResultView result={result} renderArtifacts={() => null} /></I18nProvider>);
  expect(screen.getByRole("button", { name: `Select ${selected.title.en}`, pressed: true })).toBeInTheDocument();
  expect(screen.getByRole("table", { name: `${TIER_LABELS[selected.tier].en} option cost breakdown` })).toBeInTheDocument();
  for (const plan of result.plans) {
    expect(screen.getByRole("img", { name: `${TIER_LABELS[plan.tier].en} option architecture diagram` })).toHaveAttribute("data-code", buildPlanDiagrams(plan, "en").preview);
  }
});

it("adds a three-option matrix and selected component exploration", () => {
 render(<AnalysisResultView result={result}/>);
 expect(screen.getByRole("table",{name:"구성안 비교"})).toBeInTheDocument();
 expect(screen.getByRole("table",{name:"구성요소 탐색"})).toBeInTheDocument();
});

it.each(["en", "ko"] as const)("saved %s results link to the report for the selected option; previews without a saved ID do not", async locale => {
  const user = userEvent.setup();
  const view = render(<AnalysisResultView result={result} reportId="00000000-0000-4000-8000-000000000001" />, { locale });
  const name = locale === "en" ? "View report" : "보고서 보기";
  expect(screen.getByRole("link", { name })).toHaveAttribute("href", `/analyses/00000000-0000-4000-8000-000000000001/report?lang=${locale}&tier=${result.recommendedTier}`);
  const ha = result.plans.find((plan) => plan.tier === "ha")!;
  await user.click(screen.getByRole("button", { name: locale === "en" ? `Select ${ha.title.en}` : `${ha.title.ko} 선택` }));
  expect(screen.getByRole("link", { name })).toHaveAttribute("href", `/analyses/00000000-0000-4000-8000-000000000001/report?lang=${locale}&tier=ha`);
  view.unmount();
  render(<AnalysisResultView result={result} />, { locale });
  expect(screen.queryByRole("link", { name })).not.toBeInTheDocument();
});
