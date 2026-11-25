import { describe, expect, it } from "vitest";
import { buildAnalysisResult } from "../src/lib/analysis/build-result";
import sampleOutput from "../src/lib/analysis/fixtures/sample-model-output.json";
import { loadCatalog } from "../src/lib/catalog/load";
import type { AnalysisOutcome } from "../src/types/analysis";
import type { Tier } from "../src/types/catalog";
import { budgetClaims, checkScenario } from "./check-scenario";
import { loadScenarios, type EvalScenario } from "./scenario-schema";

function fixture() {
  const scenario = loadScenarios()[0];
  const built = buildAnalysisResult(sampleOutput, scenario.input, loadCatalog());
  if (!built.ok) throw new Error(built.errors.join("\n"));
  const outcome = { ...built, usage: { promptTokens: 100, completionTokens: 200, costUsd: 0.02 } };
  return { scenario, outcome };
}

describe("checkScenario", () => {
  it("일곱 점검이 모두 통과하면 합계와 사용량을 보존한다", () => {
    const { scenario, outcome } = fixture();
    const before = structuredClone({ scenario, outcome });
    const report = checkScenario(scenario, outcome);
    expect(report.scenarioId).toBe(scenario.id);
    expect(report.passed).toBe(true);
    expect(report.checks).toHaveLength(7);
    expect(report.checks.every(({ passed }) => passed)).toBe(true);
    expect(report.totals).toEqual(Object.fromEntries(outcome.result.plans.map((plan) => [plan.tier, plan.cost.total])));
    expect(report.usage).toEqual(outcome.usage);
    for (const { name, detail } of report.checks) {
      expect(name).toMatch(/[가-힣]/);
      expect(detail).toMatch(/[가-힣]/);
    }
    expect({ scenario, outcome }).toEqual(before);
  });

  it.each(["input", "llm", "validation"] as const)("분석 %s 실패 시 일곱 점검 모두 실패하고 오류와 사용량을 보존한다", (stage) => {
    const { scenario, outcome } = fixture();
    const failure: AnalysisOutcome = { ok: false, stage, errors: ["첫 오류", "둘째 오류"], usage: outcome.usage };
    const report = checkScenario(scenario, failure);
    expect(report).toMatchObject({ scenarioId: scenario.id, passed: false, totals: null, usage: outcome.usage });
    expect(report.checks).toHaveLength(7);
    expect(report.checks.every(({ passed }) => !passed)).toBe(true);
    expect(report.checks[0].detail).toContain(stage);
    expect(report.checks[0].detail).toContain("첫 오류");
    expect(report.checks[0].detail).toContain("둘째 오류");
  });

  it.each([false, true])("범위 밖 기대값 %s와 실제 값이 일치해야 한다", (expected) => {
    const { scenario, outcome } = fixture();
    scenario.expect.outOfScope = expected;
    outcome.result.outOfScope = expected;
    expect(checkScenario(scenario, outcome).checks[1].passed).toBe(true);
    outcome.result.outOfScope = !expected;
    expect(checkScenario(scenario, outcome).checks[1].passed).toBe(false);
    expect(checkScenario(scenario, outcome).passed).toBe(false);
  });

  it("필수 분류는 모든 안에 있어야 하며 서비스 이름이 아니라 카탈로그 ID로 판정한다", () => {
    const { scenario, outcome } = fixture();
    scenario.expect.requiredCategories.push("cache");
    const cache = { componentId: "managed-redis-b0", name: { en: "이름에 의존하지 않음", ko: "이름에 의존하지 않음" }, quantity: 1, unitLabel: { en: "노드", ko: "노드" } };
    for (const plan of outcome.result.plans) plan.services.push({ ...cache });
    expect(checkScenario(scenario, outcome).checks[2].passed).toBe(true);
    outcome.result.plans[1].services.at(-1)!.componentId = "unknown-cache";
    const check = checkScenario(scenario, outcome).checks[2];
    expect(check.passed).toBe(false);
    expect(check.detail).toContain("균형");
    expect(check.detail).toContain("캐시");
  });

  it("예산 이하는 경계값까지 통과하며 초과는 실패한다", () => {
    const { scenario, outcome } = fixture();
    const low = outcome.result.plans.find(({ tier }) => tier === "low")!;
    low.cost.total = scenario.input.monthlyBudget;
    expect(checkScenario(scenario, outcome).checks[3].passed).toBe(true);
    low.cost.total += 1;
    expect(checkScenario(scenario, outcome).checks[3].passed).toBe(false);
    scenario.expect.lowTierWithinBudget = false;
    expect(checkScenario(scenario, outcome).checks[3]).toMatchObject({ passed: true, detail: expect.stringContaining("필수 아님") });
  });

  it("비용 순서는 배열 순서와 관계없고 같은 비용은 통과한다", () => {
    const { scenario, outcome } = fixture();
    for (const plan of outcome.result.plans) plan.cost.total = 100;
    outcome.result.plans.reverse();
    expect(checkScenario(scenario, outcome).checks[4].passed).toBe(true);
    expect(checkScenario(scenario, outcome).totals).toEqual({ low: 100, balanced: 100, ha: 100 });
  });

  it.each(["low", "balanced"] as const)("%s 비용이 다음 안을 넘으면 실패한다", (tier) => {
    const { scenario, outcome } = fixture();
    outcome.result.plans.find((plan) => plan.tier === tier)!.cost.total = 1_000_000_000;
    expect(checkScenario(scenario, outcome).checks[4].passed).toBe(false);
  });

  it.each(["low", "balanced", "ha"] as const)("높은 가용성의 추천 %s를 검사한다", (recommendedTier) => {
    const { scenario, outcome } = fixture();
    scenario.input.availability = "high";
    outcome.result.recommendedTier = recommendedTier;
    expect(checkScenario(scenario, outcome).checks[5].passed).toBe(recommendedTier !== "low");
    scenario.input.availability = "medium";
    expect(checkScenario(scenario, outcome).checks[5].passed).toBe(true);
  });
});

describe("budgetClaims", () => {
  it.each([
    // 실제 기록에 나온 문장
    ["월 예산을 조금 넘지만 로그를 더 넉넉히 남겨 문제 원인을 찾기 쉽습니다.", ["over"]],
    ["DB 비밀번호 같은 비밀 값을 Key Vault에 보관합니다. 다만 월 5만 원 예산은 넘습니다.", ["over"]],
    ["예산을 넘으므로 현재 방문 규모에서는 과한 구성이며 향후 성장 시 고려하세요.", ["over"]],
    ["월 예산 30만 원을 크게 넘으므로 예약 중단이 매출에 직결될 때 고려하세요.", ["over"]],
    ["예산을 초과하지만 챗봇을 업무에 필수로 쓸 때 적합합니다.", ["over"]],
    ["배포 슬롯·자동 확장을 갖춘 예산 내 운영 구성", ["within"]],
    ["월 예산 30만 원 안에 들어오며, 앱·DB가 각각 하나라 영역 장애에는 대비하지 않습니다.", ["within"]],
    ["월 예산 안에 들어가며 단일 DB라 영역 장애 시 짧은 중단은 감수해야 합니다.", ["within"]],
    ["P0v3 앱과 버스트형 DB의 예산 맞춤 운영 구성", ["within"]],
    ["하루 수십 명 방문 규모에서도 예산 안에서 운영할 수 있습니다.", ["within"]],
    // 같은 뜻의 다른 표현
    ["예산 초과 구성입니다.", ["over"]],
    ["예산 범위를 벗어납니다.", ["over"]],
    ["예산을 2배 가까이 넘습니다.", ["over"]],
    ["로그를 줄여 예산에 맞췄습니다.", ["within"]],
    ["월 150만 원 예산 이내입니다.", ["within"]],
    ["예산을 넘으므로 트래픽이 크게 늘 때 검토하세요.", ["over"]],
    ["예산 안에 들며 영역 장애에는 대비하지 않습니다.", ["within"]],
  ])("예산 표현 %s를 %j로 읽는다", (text, expected) => {
    expect(budgetClaims(text).map(({ side }) => side)).toEqual(expected);
  });

  it.each([
    ["예산을 넘지 않습니다.", ["within"]],
    ["예산을 초과하지 않는 범위에서 로그를 남깁니다.", ["within"]],
    ["예산 안에 들지 않습니다.", ["over"]],
    ["월 예산 안에 들어오지 못합니다.", ["over"]],
    ["예산에 맞지 않습니다.", ["over"]],
    ["예산 내로 맞출 수 없습니다.", ["over"]],
    ["예산 안에 못 들어갑니다.", ["over"]],
  ])("부정 표현 %s는 뜻을 뒤집어 %j로 읽는다", (text, expected) => {
    expect(budgetClaims(text).map(({ side }) => side)).toEqual(expected);
  });

  it.each([
    "사용량이 늘면 예산을 넘을 수 있습니다.",
    "예산을 넘으면 로그 보존 기간을 줄이세요.",
    "예산에 맞추려면 로그를 줄여야 합니다.",
    "예산을 맞추려고 로그 수집량을 1GB로 줄였고, 한동안 쓰지 않으면 첫 요청이 느릴 수 있습니다.",
    "예산을 넘지 않도록 로그를 줄였습니다.",
    "배포 편의성과 예산을 고려한 운영 구성",
    "현재 MVP 규모와 예산에는 과한 구성으로, 서비스가 커진 뒤 옮겨갈 목표로 적합합니다.",
    // 다른 안을 함께 말하는 문장은 어느 안의 이야기인지 모호하다.
    "예산을 넘는 고가용성 안 대신 단일 DB로 비용을 낮췄습니다.",
    "균형 안으로 예산 30만 원 안에서 운영하고, 고가용성 안은 예산을 크게 넘습니다.",
  ])("가능성·조건·의도·다른 안 비교 %s는 주장으로 보지 않는다", (text) => {
    expect(budgetClaims(text)).toEqual([]);
  });

  it("주장이 나온 문장을 함께 돌려준다", () => {
    expect(budgetClaims("Key Vault에 보관합니다. 다만 월 5만 원 예산은 넘습니다."))
      .toEqual([{ side: "over", sentence: "다만 월 5만 원 예산은 넘습니다." }]);
  });
});

describe("예산 표현 일치 점검", () => {
  const budgetCheck = (scenario: EvalScenario, outcome: AnalysisOutcome) => checkScenario(scenario, outcome).checks[6];
  const plan = (outcome: AnalysisOutcome, tier: Tier) => {
    if (!outcome.ok) throw new Error("성공 결과가 필요합니다.");
    return outcome.result.plans.find((candidate) => candidate.tier === tier)!;
  };

  it("계산 비용이 예산 이내인데 예산을 넘는다고 쓰면 안과 비율, 문장을 알리며 실패한다", () => {
    const { scenario, outcome } = fixture();
    const balanced = plan(outcome, "balanced");
    balanced.cost.total = scenario.input.monthlyBudget - 0.34;
    balanced.pros.push({ en: "Budget statement", ko: "월 예산을 조금 넘지만 로그를 더 넉넉히 남겨 문제 원인을 찾기 쉽습니다." });
    const check = budgetCheck(scenario, outcome);
    expect(check).toMatchObject({ name: "예산 표현 일치", passed: false });
    expect(check.detail).toContain("균형");
    expect(check.detail).toContain("100%");
    expect(check.detail).toContain("예산 이내");
    expect(check.detail).toContain("월 예산을 조금 넘지만 로그를 더 넉넉히 남겨 문제 원인을 찾기 쉽습니다.");
    expect(checkScenario(scenario, outcome).passed).toBe(false);
  });

  it("예산과 같은 비용은 예산 이내이고 1원이라도 넘으면 예산 초과다", () => {
    const { scenario, outcome } = fixture();
    const balanced = plan(outcome, "balanced");
    balanced.cost.total = scenario.input.monthlyBudget;
    balanced.pros.push({ en: "Budget statement", ko: "예산을 넘습니다." });
    expect(budgetCheck(scenario, outcome).passed).toBe(false);
    balanced.cost.total += 1;
    expect(budgetCheck(scenario, outcome).passed).toBe(true);
    balanced.pros.push({ en: "Budget statement", ko: "예산 안에 들어옵니다." });
    expect(budgetCheck(scenario, outcome)).toMatchObject({ passed: false, detail: expect.stringContaining("예산 초과") });
    balanced.cost.total -= 1;
    balanced.pros.splice(-2, 1);
    expect(budgetCheck(scenario, outcome).passed).toBe(true);
  });

  it("제목도 점검하고 실패한 안을 모두 알린다", () => {
    const { scenario, outcome } = fixture();
    const ha = plan(outcome, "ha");
    ha.cost.total = scenario.input.monthlyBudget * 3;
    ha.title.ko = "예산 내 영역 중복 구성";
    const low = plan(outcome, "low");
    low.cost.total = 1;
    low.pros.push({ en: "Budget statement", ko: "예산을 초과하지만 가장 단순합니다." });
    const check = budgetCheck(scenario, outcome);
    expect(check.passed).toBe(false);
    expect(check.detail).toContain("고가용성");
    expect(check.detail).toContain("예산 내 영역 중복 구성");
    expect(check.detail).toContain("최저 비용");
    expect(check.detail).toContain("예산을 초과하지만 가장 단순합니다.");
  });

  it("부정 표현은 뜻을 뒤집어 판정한다", () => {
    const { scenario, outcome } = fixture();
    const balanced = plan(outcome, "balanced");
    balanced.cost.total = 1;
    balanced.pros.push({ en: "Budget statement", ko: "예산을 넘지 않습니다." });
    expect(budgetCheck(scenario, outcome).passed).toBe(true);
    balanced.cost.total = scenario.input.monthlyBudget + 1;
    expect(budgetCheck(scenario, outcome).passed).toBe(false);
  });

  it("여러 안을 함께 말하는 추천 이유 문단은 점검하지 않는다", () => {
    const { scenario, outcome } = fixture();
    if (!outcome.ok) throw new Error("성공 결과가 필요합니다.");
    outcome.result.recommendationReason.ko = "예산 안에 들어옵니다. 예산을 크게 넘습니다.";
    expect(budgetCheck(scenario, outcome)).toMatchObject({
      passed: true, detail: "세 안의 제목·장점에 계산 비용과 어긋나는 예산 표현이 없습니다.",
    });
  });
});


describe("CAD 예산 표현", () => {
  it("CAD 금액 뒤의 예산 주장을 읽는다", () => {
    expect(budgetClaims("예산 CA$50을 넘습니다.")).toMatchObject([{ side: "over" }]);
    expect(budgetClaims("예산 CA$1,000 안에 들어갑니다.")).toMatchObject([{ side: "within" }]);
  });
});

it("각 언어는 해당 언어의 예산 표현으로 점검한다", () => {
  const { scenario, outcome } = fixture();
  if (!outcome.ok) throw new Error("성공 결과가 필요합니다.");
  const low = outcome.result.plans[0];
  low.cost.total = 1;
  low.title.en = "예산 초과";
  low.pros.push({ en: "예산을 넘습니다.", ko: "관리 부담을 줄입니다." });
  expect(checkScenario(scenario, outcome).checks[6].passed).toBe(true);
});

it.each([
  ["Within the budget", ["within"]], ["Fits in your budget", ["within"]], ["Fits within the budget", ["within"]], ["Under your budget", ["within"]],
  ["Over the budget", ["over"]], ["Exceeds your budget", ["over"]], ["Above the budget", ["over"]],
  ["Does not fit within your budget", ["over"]], ["Does not fit your budget", ["over"]], ["It may not exceed the budget", []], ["It may be over your budget", []], ["Not within the budget", ["over"]], ["Does not exceed the budget", ["within"]],
  ["If traffic rises, it exceeds your budget", []], ["It may exceed the budget", []], ["It could go over your budget", []], ["Reduce logs to stay within the budget", []],
  ["Cheaper than the High availability option, which is over your budget.", []], ["Unlike the lowest cost option, it stays within the budget.", []], ["Balanced option: within the budget", []],
  ["It can't fit within your budget", ["over"]], ["It cannot fit within the budget", ["over"]], ["It won\u2019t exceed your budget", ["within"]], ["It isn\u2019t within the budget", ["over"]],
  ["It never goes over the budget", ["within"]], ["It doesn't stay within the budget", ["over"]], ["It does not remain under your budget", ["over"]], ["It won't be over the budget", ["within"]],
])("reads English budget claims: %s", (text, expected) => {
  expect(budgetClaims(text as string, "en").map(({ side }) => side)).toEqual(expected);
});
it.each(["title", "pros"] as const)("compares English %s claims against calculated costs", field => {
  const { scenario, outcome } = fixture();
  const plan = outcome.result.plans[0];
  plan.cost.total = 1;
  if (field === "title") plan.title.en = "Over your budget";
  else plan.pros.push({ en: "Over your budget", ko: "운영합니다." });
  expect(checkScenario(scenario, outcome).checks[6].passed).toBe(false);
  plan.cost.total = scenario.input.monthlyBudget + 1;
  expect(checkScenario(scenario, outcome).checks[6].passed).toBe(true);
});

it.each(["Within your budget", "Does not fit your budget"])("compares affirmative and negated English budget claims: %s", text => {
  const { scenario, outcome } = fixture();
  const plan = outcome.result.plans[0];
  plan.pros.push({ en: text, ko: "운영합니다." });
  plan.cost.total = scenario.input.monthlyBudget + 1;
  expect(checkScenario(scenario, outcome).checks[6].passed).toBe(text.startsWith("Does"));
  plan.cost.total = scenario.input.monthlyBudget;
  expect(checkScenario(scenario, outcome).checks[6].passed).toBe(!text.startsWith("Does"));
});
