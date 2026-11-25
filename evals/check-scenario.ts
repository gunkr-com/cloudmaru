import components from "../src/catalog/components.json";
import { TIER_LABELS } from "../src/lib/analysis/input-schema";
import { tierSchema } from "../src/lib/catalog/schema";
import { formatBudgetRatio } from "../src/lib/cost/format";
import { formatMoney } from "../src/i18n/format";
import type { AnalysisOutcome, PlanResult } from "../src/types/analysis";
import type { ComponentCategory, Tier } from "../src/types/catalog";
import type { LlmUsage } from "../src/types/llm";
import type { EvalScenario } from "./scenario-schema";

export type CheckResult = { name: string; passed: boolean; detail: string };
export type ScenarioReport = {
  scenarioId: string;
  passed: boolean;
  checks: CheckResult[];
  totals: Record<Tier, number> | null;
  usage: LlmUsage | null;
};

// PlanResult에는 분류가 없으므로 같은 저장소의 카탈로그 ID로만 판정한다.
const categories = new Map(components.map(({ id, category }) => [id, category]));
const categoryLabels: Record<ComponentCategory, string> = {
  compute: "컴퓨트", database: "데이터베이스", storage: "저장소", cache: "캐시",
  network: "네트워크", monitoring: "모니터링", security: "보안",
};
const checkNames = ["분석 검증", "범위 밖 판정", "필수 구성요소 분류", "최저 비용 안 예산", "안별 비용 순서", "높은 가용성 추천", "예산 표현 일치"];

export type BudgetSide = "over" | "within";
export type BudgetClaim = { side: BudgetSide; sentence: string };

// "예산 30만 원을", "예산 1,500,000원 안에"처럼 예산 뒤에 금액이 올 수 있다.
const AMOUNT = String.raw`(?:\s*(?:CA\$\s*[\d,.]+|[\d,.]+\s*CAD|[\d,.]+\s*[만천억]?\s*원))?`;
const DEGREE = String.raw`(?:(?:크게|조금|다소|약간|살짝|훨씬|많이|꽤|한참|\d+(?:\.\d+)?\s*배(?:\s*가까이)?)\s*)?`;
// verb는 술어가 예산 문구에 바로 붙는 표현(넘다·초과하다·벗어나다·맞다)이고,
// place는 "예산 안·내·이내·이하·밖" 뒤에 조사와 술어가 따로 오는 표현이다.
const budgetPhrases: { side: BudgetSide; place: boolean; pattern: RegExp }[] = [
  { side: "over", place: false, pattern: new RegExp(String.raw`예산${AMOUNT}(?:\s*(?:범위|한도))?\s*[을은이를]?\s*${DEGREE}(?:넘(?![치쳐])|초과|벗어)`, "g") },
  { side: "within", place: false, pattern: new RegExp(String.raw`예산${AMOUNT}\s*[에을를]?\s*맞`, "g") },
  { side: "within", place: true, pattern: new RegExp(String.raw`예산${AMOUNT}\s*(?:범위|한도)?\s*(?:안(?![내정])|내(?!역)|이내|이하)`, "g") },
  { side: "over", place: true, pattern: new RegExp(String.raw`예산${AMOUNT}\s*(?:범위|한도)?\s*밖`, "g") },
];
// 다른 안과 견주는 문장("예산을 넘는 고가용성 안 대신")은 어느 안의 예산 이야기인지 모호하다.
const tierMention = /(?:최저 비용|균형|고가용성)\s*안(?![내정])/;
// 영어 글의 안 이름(프롬프트가 "Lowest cost option" 등으로 쓰게 한다). 다른 안을 말하는 문장은 한국어처럼 건너뛴다.
const englishTierMention = new RegExp(`\\b(?:${Object.values(TIER_LABELS).map(({ en }) => en.toLowerCase()).join("|")})\\s+option\\b`, "i");

function flip(side: BudgetSide): BudgetSide {
  return side === "over" ? "within" : "over";
}

// 예산 문구 바로 뒤 술어만 본다. 뒤 절의 부정·조건("…들며 영역 장애에는 대비하지 않습니다")은 이 문구와 무관하다.
function readClaim(side: BudgetSide, place: boolean, after: string): BudgetSide | null {
  const words = after.split(/[,;]/)[0].split(/\s+/);
  // 위치 표현은 조사("에", "에서", "로") 뒤 어절이 술어다. "예산 이내입니다"처럼 서술격이 붙으면 그 어절이 술어다.
  const [first = "", second = "", third = ""] = place && /^(?:에서?|으?로)?[는도]?$/.test(words[0]) ? words.slice(1) : words;
  let ending = first;
  let next = second;
  if (first === "못") {
    [side, ending, next] = [flip(side), second, third];
  } else if (/지[는도]?$/.test(first) && /^(?:않|못)/.test(second)) {
    [side, ending, next] = [flip(side), second, third];
  } else if (second === "수" && third.startsWith("없")) {
    [side, ending, next] = [flip(side), third, ""];
  } else if (side === "over" && /^수도?$/.test(second) && third.startsWith("있")) {
    // "예산을 넘을 수 있습니다"는 주의 문구다. "예산 안에서 운영할 수 있습니다"는 예산 이내라는 주장이다.
    return null;
  }
  // 조건·의도("넘으면", "맞추려고", "넘지 않도록", "맞추기 위해")와 "~할 때·경우"는 주장이 아니다.
  if (/(?:면|려고|도록|고자)$/.test(ending) || (ending.endsWith("기") && next.startsWith("위해")) || /^(?:때|경우)/.test(next)) return null;
  return side;
}

// 문장마다 예산을 넘는다(over)·예산 안이다(within)라는 주장을 찾는다. 부정은 뜻을 뒤집고 가능성·조건·의도는 건너뛴다.
function englishBudgetClaims(text: string): BudgetClaim[] {
  const pattern = /\b(within|under|fits?(?:\s+(?:in|within))?|over|above|exceeds?|go\s+over)\s+(?:the|your)\s+budget\b/gi;
  return text.split(/(?<=[.!?])\s+/).flatMap(sentence => {
    if (/\bif\b/i.test(sentence) || englishTierMention.test(sentence)) return [];
    return [...sentence.matchAll(pattern)].flatMap(match => {
      const before = sentence.slice(0, match.index);
      // 가능성·의도는 주장이 아니다. 직전 표현만 보고 다른 절의 주장까지 지우지 않는다.
      if (/\b(?:may|might|could|can)\s+(?:(?:not|be|go)\s+)*$/i.test(before) || /\bto\s+(?:stay|keep|fit)\s+$/i.test(before)) return [];
      let side: BudgetSide = /^(?:over|above|exceed|go)/i.test(match[1]) ? "over" : "within";
      // 부정어와 예산 표현 사이의 동사("never goes over", "doesn't stay within")도 부정으로 읽는다.
      if (/\b(?:not|never|cannot|(?:isn|aren|doesn|don|can|won)['’]t)\s+(?:(?:stay|stays|keep|keeps|fit|fits|go|goes|remain|remains|be|is|are)\s+)*$/i.test(before)) side = flip(side);
      return [{ side, sentence }];
    });
  });
}

export function budgetClaims(text: string, locale: "en" | "ko" = "ko"): BudgetClaim[] {
  if (locale === "en") return englishBudgetClaims(text);
  return text.split(/(?<=[.!?])\s+/).flatMap((sentence) => {
    if (tierMention.test(sentence)) return [];
    const found = budgetPhrases.flatMap(({ side, place, pattern }) => [...sentence.matchAll(pattern)].map((match) => ({
      index: match.index, side: readClaim(side, place, sentence.slice(match.index + match[0].length)),
    })));
    return found.sort((a, b) => a.index - b.index)
      .flatMap(({ side }) => side === null ? [] : [{ side, sentence }]);
  });
}

// 안마다 제목·장점이 계산 비용과 반대로 예산을 말하는지 본다. 여러 안을 함께 말하는 추천 이유 문단은 보지 않는다.
function budgetClaimMismatches(plans: PlanResult[], budget: number): string[] {
  return plans.flatMap((plan) => {
    const actual: BudgetSide = plan.cost.total <= budget ? "within" : "over";
    const label = `${TIER_LABELS[plan.tier].ko} 안(예산의 ${formatBudgetRatio(plan.cost.total / budget)}, 예산 ${actual === "within" ? "이내" : "초과"})`;
    return (["en", "ko"] as const).flatMap(locale =>
      [plan.title[locale], ...plan.pros.map(pro => pro[locale])].flatMap(text => budgetClaims(text, locale)))
      .filter(({ side }) => side !== actual)
      .map(({ side, sentence }) => `${label}이 예산을 ${side === "over" ? "넘는다고" : "안에 든다고"} 씀: "${sentence}"`);
  });
}

export function checkScenario(scenario: EvalScenario, outcome: AnalysisOutcome): ScenarioReport {
  if (!outcome.ok) {
    return {
      scenarioId: scenario.id,
      passed: false,
      checks: checkNames.map((name, index) => ({
        name,
        passed: false,
        detail: index === 0 ? `분석 실패 단계: ${outcome.stage}; ${outcome.errors.join("; ")}`
          : "분석 결과가 없어 점검할 수 없습니다.",
      })),
      totals: null,
      usage: outcome.usage,
    };
  }

  const { result } = outcome;
  // runAnalysis가 스키마·카탈로그 검증을 마친 세 안만 전달한다.
  const plans = tierSchema.options.map((tier) => result.plans.find((plan) => plan.tier === tier)!);
  const totals: Record<Tier, number> = {
    low: plans[0].cost.total,
    balanced: plans[1].cost.total,
    ha: plans[2].cost.total,
  };
  const missing = plans.flatMap((plan) => {
    const present = new Set(plan.services.map(({ componentId }) => categories.get(componentId)));
    return scenario.expect.requiredCategories.filter((category) => !present.has(category))
      .map((category) => `${TIER_LABELS[plan.tier].ko}: ${categoryLabels[category]} 누락`);
  });
  const budgetMismatches = budgetClaimMismatches(plans, scenario.input.monthlyBudget);
  const checks: CheckResult[] = [
    { name: checkNames[0], passed: true, detail: "분석이 검증을 통과해 세 안의 결과가 만들어졌습니다." },
    {
      name: checkNames[1],
      passed: result.outOfScope === scenario.expect.outOfScope,
      detail: `기대: ${scenario.expect.outOfScope ? "범위 밖" : "범위 안"}, 실제: ${result.outOfScope ? "범위 밖" : "범위 안"}`,
    },
    {
      name: checkNames[2], passed: missing.length === 0,
      detail: missing.length > 0 ? missing.join("; ")
        : `세 안 모두 필수 분류 포함: ${scenario.expect.requiredCategories.map((category) => categoryLabels[category]).join(", ")}`,
    },
    {
      name: checkNames[3],
      passed: !scenario.expect.lowTierWithinBudget || totals.low <= scenario.input.monthlyBudget,
      detail: `${scenario.expect.lowTierWithinBudget ? "예산 내 구성 필수" : "예산 내 구성 필수 아님"}: 최저 비용 ${formatMoney(totals.low, "CAD", "ko")}, 예산 ${formatMoney(scenario.input.monthlyBudget, "CAD", "ko")}`,
    },
    {
      name: checkNames[4], passed: totals.low <= totals.balanced && totals.balanced <= totals.ha,
      detail: `최저 비용 ${formatMoney(totals.low, "CAD", "ko")} ≤ 균형 ${formatMoney(totals.balanced, "CAD", "ko")} ≤ 고가용성 ${formatMoney(totals.ha, "CAD", "ko")} 여부`,
    },
    {
      name: checkNames[5], passed: scenario.input.availability !== "high" || result.recommendedTier !== "low",
      detail: `${scenario.input.availability === "high" ? "높은 가용성: 최저 비용 추천 제외" : "높은 가용성 조건 해당 없음"}; 추천 안: ${TIER_LABELS[result.recommendedTier].ko}`,
    },
    {
      name: checkNames[6], passed: budgetMismatches.length === 0,
      detail: budgetMismatches.length > 0 ? budgetMismatches.join("; ") : "세 안의 제목·장점에 계산 비용과 어긋나는 예산 표현이 없습니다.",
    },
  ];
  return { scenarioId: scenario.id, passed: checks.every(({ passed }) => passed), checks, totals, usage: outcome.usage };
}
