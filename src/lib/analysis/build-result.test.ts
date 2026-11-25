import { describe, expect, it } from "vitest";
import { buildAnalysisResult } from "@/lib/analysis/build-result";
import sampleInput from "@/lib/analysis/fixtures/sample-input.json";
import sampleOutput from "@/lib/analysis/fixtures/sample-model-output.json";
import { analysisInputSchema } from "@/lib/analysis/input-schema";
import { validateModelOutput } from "@/lib/analysis/validate-model-output";
import { loadCatalog } from "@/lib/catalog/load";
import { calculatePlanCost } from "@/lib/cost/calculate";
import { buildMermaid } from "@/lib/diagram/build-mermaid";

const input = analysisInputSchema.parse(sampleInput);
const catalog = loadCatalog();

describe("buildAnalysisResult", () => {
  it("직접 작성한 견본을 검증하고 비용·출처·서비스·다이어그램을 조립한다", () => {
    const outcome = buildAnalysisResult(sampleOutput, input, catalog);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error(outcome.errors.join("\n"));
    expect(outcome.result).toEqual({
      region: "canadacentral",
      currency: "CAD",
      requestTitle: sampleOutput.requestTitle,
      input,
      outOfScope: false,
      recommendedTier: "balanced",
      recommendationReason: sampleOutput.recommendationReason,
      priceAsOf: catalog.prices.asOf,
      plans: sampleOutput.plans.map((plan) => {
        const architecture = catalog.architectures.find(({ id }) => id === plan.referenceArchitectureId)!;
        return {
          tier: plan.tier,
          title: plan.title,
          recommended: plan.tier === sampleOutput.recommendedTier,
          referenceArchitecture: { id: architecture.id, name: architecture.name, sources: architecture.sources },
          services: plan.items.map(({ componentId, quantity }) => {
            const component = catalog.components.find(({ id }) => id === componentId)!;
            return { componentId, name: component.name, quantity, unitLabel: component.unitLabel };
          }),
          pros: plan.pros,
          cost: calculatePlanCost(plan.items, catalog, { region: "canadacentral", monthlyBudget: input.monthlyBudget }),
          mermaid: buildMermaid(plan, catalog),
          connections: plan.connections,
        };
      }),
    });
    expect(outcome.result.plans.filter(({ recommended }) => recommended)).toHaveLength(1);
    expect(outcome.result.plans[1].cost.total).toBeLessThanOrEqual(input.monthlyBudget);
  });

  it("모델이 덧붙인 금액·출처·서비스 이름·다이어그램을 사용하지 않는다", () => {
    const extras = {
      total: 1, unitPrice: 1, priceAsOf: "1900-01-01",
      name: "임의 서비스", unitLabel: "임의 단위", mermaid: "graph TD; forged",
      referenceArchitecture: { name: "임의 출처", sources: [{ title: "임의 링크", url: "https://example.com" }] },
    };
    const forged = {
      ...sampleOutput, ...extras,
      plans: sampleOutput.plans.map((plan) => ({
        ...plan, ...extras, cost: { total: 1 },
        items: plan.items.map((item) => ({ ...item, ...extras })),
      })),
    };
    expect(buildAnalysisResult(forged, input, catalog)).toEqual(buildAnalysisResult(sampleOutput, input, catalog));
  });

  it.each(["low", "balanced", "ha"] as const)("정렬된 안에서 %s 하나를 추천하고 범위 밖 표시를 보존한다", (recommendedTier) => {
    const raw = { ...sampleOutput, outOfScope: true, recommendedTier, plans: [...sampleOutput.plans].reverse() };
    const outcome = buildAnalysisResult(raw, input, catalog);
    if (!outcome.ok) throw new Error(outcome.errors.join("\n"));
    expect(outcome.result.plans.map(({ tier }) => tier)).toEqual(["low", "balanced", "ha"]);
    expect(outcome.result.plans.filter(({ recommended }) => recommended).map(({ tier }) => tier)).toEqual([recommendedTier]);
    expect(outcome.result.outOfScope).toBe(true);
  });

  it.each([
    null,
    { ...sampleOutput, plans: [] },
    { ...sampleOutput, requestTitle: "https://example.com" },
    { ...sampleOutput, plans: sampleOutput.plans.map((plan) => ({ ...plan, referenceArchitectureId: "missing" })) },
    { ...sampleOutput, plans: sampleOutput.plans.map((plan) => ({ ...plan, items: [{ componentId: "missing", quantity: 1 }] })) },
  ])("검증 실패의 오류를 그대로 반환하고 부분 결과를 만들지 않는다: %j", (raw) => {
    expect(buildAnalysisResult(raw, input, catalog)).toEqual(validateModelOutput(raw, catalog));
    expect(buildAnalysisResult(raw, input, catalog)).not.toHaveProperty("result");
  });

  it("안의 연결을 검증된 모델 출력의 복사본으로 담는다", () => {
    const validated = validateModelOutput(sampleOutput, catalog);
    if (!validated.ok) throw new Error(validated.errors.join("\n"));
    const outcome = buildAnalysisResult(sampleOutput, input, catalog);
    if (!outcome.ok) throw new Error(outcome.errors.join("\n"));
    expect(outcome.result.plans.map(({ connections }) => connections)).toEqual(
      validated.output.plans.map(({ connections }) => connections),
    );
    expect(outcome.result.plans[0].connections).not.toBe(validated.output.plans[0].connections);
  });

  it("원본 입력·모델 출력·카탈로그를 변경하지 않는 순수 함수다", () => {
    const before = structuredClone({ sampleOutput, input, catalog });
    const outcome = buildAnalysisResult(sampleOutput, input, catalog);
    expect(buildAnalysisResult(sampleOutput, input, catalog)).toEqual(outcome);
    expect({ sampleOutput, input, catalog }).toEqual(before);
  });
});


it("입력 지역에 해당하는 가격을 사용한다", () => {
  const regional = structuredClone(catalog);
  for (const prices of Object.values(regional.prices.prices)) {
    prices.testregion = { ...prices.canadacentral, tiers: prices.canadacentral.tiers.map(tier => ({ ...tier, unitPrice: tier.unitPrice * 3 })) };
  }
  const changedInput = { ...input, region: "testregion" };
  const outcome = buildAnalysisResult(sampleOutput, changedInput, regional);
  expect(outcome.ok).toBe(true);
  if (!outcome.ok) throw new Error(outcome.errors.join("\n"));
  expect(outcome.result.region).toBe("testregion");
  for (const plan of sampleOutput.plans) {
    expect(outcome.result.plans.find(item => item.tier === plan.tier)!.cost).toEqual(calculatePlanCost(plan.items, regional, { region: "testregion", monthlyBudget: input.monthlyBudget }));
  }
});
