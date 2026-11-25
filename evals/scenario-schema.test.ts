import { describe, expect, it } from "vitest";
import sampleInput from "../src/lib/analysis/fixtures/sample-input.json";
import { loadCatalog } from "../src/lib/catalog/load";
import { calculatePlanCost } from "../src/lib/cost/calculate";
import { loadScenarios, scenarioSchema, scenariosSchema } from "./scenario-schema";

describe("고정 품질 시나리오", () => {
  it("실제 JSON을 검증해 중복 없는 시나리오 10개와 범위 밖 1개를 읽는다", () => {
    const scenarios = loadScenarios();
    expect(scenariosSchema.safeParse(scenarios).success).toBe(true);
    expect(scenarios).toHaveLength(10);
    expect(new Set(scenarios.map(({ id }) => id)).size).toBe(10);
    expect(scenarios.filter(({ expect: expected }) => expected.outOfScope).map(({ id }) => id))
      .toEqual(["internal-llm-chatbot"]);
    expect(scenarios[0].input).toEqual(sampleInput);
  });

  it("요청된 사용자 수·예산·가용성과 명확한 필수 분류를 유지한다", () => {
    const scenarios = loadScenarios();
    expect(scenarios.map(({ input, expect: expected }) => [
      input.expectedUsers, input.monthlyBudget, input.availability, expected.requiredCategories,
    ])).toEqual([
      ["under-10k", 300, "medium", ["compute", "database"]],
      ["under-100", 30, "low", ["compute"]],
      ["under-100", 100, "low", ["compute", "database"]],
      ["under-100k", 1500, "high", ["compute", "database", "storage"]],
      ["under-10k", 500, "medium", ["compute", "database"]],
      ["under-100k", 800, "high", ["compute"]],
      ["under-1k", 400, "medium", ["compute", "database", "cache"]],
      ["under-10k", 1000, "high", ["compute", "database"]],
      ["under-1k", 50, "low", ["compute", "database"]],
      ["under-1k", 500, "medium", ["compute"]],
    ]);
    for (const scenario of scenarios) {
      expect(scenario.title).toMatch(/[가-힣]/);
      expect(scenario.expect.notes).toMatch(/[가-힣]/);
      expect(scenario.input.description.split(/\.\s|\.$/).filter(Boolean).length).toBeGreaterThanOrEqual(2);
    }
  });

  it("예산 기대값은 샘플 출력이 아니라 참조 low 단계의 계산된 비용에 근거한다", () => {
    const catalog = loadCatalog();
    const cheapestLow = Math.min(...catalog.architectures.map(({ tiers }) =>
      calculatePlanCost(tiers.low.items, catalog, { region: "canadacentral" }).total));
    const staticArchitecture = catalog.architectures.find(({ id }) => id === "serverless-static-web-app")!;
    // 정적 사이트에는 참조 구성의 DB·API가 필요 없으므로 정적 호스팅 항목만 적용한다.
    const staticCost = calculatePlanCost(staticArchitecture.tiers.low.items.filter(({ componentId }) =>
      componentId.startsWith("static-web-apps-")), catalog, { region: "canadacentral" }).total;
    const cacheCost = calculatePlanCost([{ componentId: "managed-redis-b0", quantity: 1 }], catalog, { region: "canadacentral" }).total;
    for (const scenario of loadScenarios()) {
      const minimum = scenario.id === "static-portfolio" ? staticCost
        : cheapestLow + (scenario.expect.requiredCategories.includes("cache") ? cacheCost : 0);
      expect(scenario.expect.lowTierWithinBudget, scenario.id).toBe(minimum <= scenario.input.monthlyBudget);
    }
  });

  it.each([
    { id: "Bad_ID" },
    { id: "../escape" },
    { title: " " },
    { input: { ...sampleInput, monthlyBudget: 9 } },
    { input: { ...sampleInput, expectedUsers: "invalid" } },
    { expect: { outOfScope: false, requiredCategories: ["llm"], lowTierWithinBudget: true, notes: "확인" } },
    { expect: { outOfScope: false, requiredCategories: [], lowTierWithinBudget: true, notes: "확인" } },
  ])("잘못된 시나리오를 거부한다: %j", (patch) => {
    expect(scenarioSchema.safeParse({ ...loadScenarios()[0], ...patch }).success).toBe(false);
  });

  it("중복 ID와 잘못된 시나리오 개수를 거부한다", () => {
    const scenarios = loadScenarios();
    expect(scenariosSchema.safeParse(scenarios.slice(1)).success).toBe(false);
    scenarios[1].id = scenarios[0].id;
    expect(scenariosSchema.safeParse(scenarios).success).toBe(false);
    expect(loadScenarios()[1].id).toBe("static-portfolio");
  });
});
