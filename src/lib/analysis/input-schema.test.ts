import { describe, expect, expectTypeOf, it } from "vitest";
import {
  AVAILABILITY_OPTIONS,
  AVAILABILITY_DESCRIPTIONS,
  EXPECTED_USERS_BASIS,
  EXPECTED_USERS_HELP,
  EXPECTED_USERS_OPTIONS,
  TIER_LABELS,
  analysisInputSchema,
} from "@/lib/analysis/input-schema";
import type { AnalysisInput } from "@/types/analysis";

const validInput: AnalysisInput = {
  description: "고객이 예약하고 결제하는 웹 서비스를 만들고 싶습니다.",
  expectedUsers: "under-1k",
  monthlyBudget: 100_000, region: "canadacentral",
  availability: "medium",
};

describe("analysisInputSchema", () => {
  it("사용자 수 도움말과 가용성 설명을 공용 상수로 제공한다", () => {
    expect(EXPECTED_USERS_BASIS.ko).toBe("월간 이용자(한 달 동안 서비스를 쓰는 사람 수)");
    expect(EXPECTED_USERS_HELP.ko).toContain("월간 이용자");
    expect(Object.keys(AVAILABILITY_DESCRIPTIONS).sort()).toEqual(
      AVAILABILITY_OPTIONS.map(({ value }) => value).sort(),
    );
    expect(Object.fromEntries(Object.entries(AVAILABILITY_DESCRIPTIONS).map(([key, text]) => [key, text.ko]))).toEqual({
      low: "몇 시간 멈춰도 큰 문제가 없습니다. 개인 프로젝트, 사내 테스트.",
      medium: "업무 시간에 멈추면 곤란하지만 짧은 중단은 감수할 수 있습니다.",
      high: "몇 분만 멈춰도 매출이나 고객에게 바로 영향이 있습니다.",
    });
  });

  it("올바른 입력을 변환 없이 반환하고 입력 타입과 일치한다", () => {
    const input = analysisInputSchema.parse(validInput);
    expect(input).toEqual(validInput);
    expectTypeOf(input).toEqualTypeOf<AnalysisInput>();
  });

  it.each([10, 2000])("서술 길이 경계 %i자를 허용한다", (length) => {
    expect(analysisInputSchema.safeParse({ ...validInput, description: "가".repeat(length) }).success).toBe(true);
  });

  it("CAD 최솟값과 지원 지역을 보존한다", () => {
    expect(analysisInputSchema.parse({ ...validInput, monthlyBudget: 10 })).toEqual({ ...validInput, monthlyBudget: 10 });
    expect(analysisInputSchema.safeParse({ ...validInput, region: "other" }).success).toBe(false);
  });

  it.each(["canadacentral", "westus2", "centralus"])("가격을 확인한 %s 지역을 허용한다", region => {
    expect(analysisInputSchema.parse({ ...validInput, region })).toEqual({ ...validInput, region });
  });

  it.each<readonly [string, unknown]>([
    ["description", "가".repeat(9)],
    ["description", "가".repeat(2001)],
    ["description", null],
    ["monthlyBudget", 9],
    ["monthlyBudget", -1],
    ["monthlyBudget", 10.5],
    ["monthlyBudget", Infinity],
    ["monthlyBudget", NaN],
    ["monthlyBudget", "10000"],
    ["expectedUsers", "under-10"],
    ["availability", "ha"],
    ...Object.keys(validInput).map((field) => [field, undefined] as const),
  ])("잘못된 %s=%s를 한국어 오류로 거부한다", (field, value) => {
    const result = analysisInputSchema.safeParse({ ...validInput, [field]: value });
    expect(result.success).toBe(false);
    if (result.success) throw new Error("잘못된 입력이 통과했습니다.");
    expect(result.error.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: [field], message: expect.any(String) }),
    ]));
    for (const issue of result.error.issues) expect(issue.message).toMatch(/[가-힣]|^analysis\./);
  });

  it("선택지와 공용 표기가 요구사항과 일치하고 모든 선택지가 통과한다", () => {
    expect(EXPECTED_USERS_OPTIONS.map(({ value, label }) => ({ value, label: label.ko }))).toEqual([
      { value: "under-100", label: "100명 이하" },
      { value: "under-1k", label: "1,000명 이하" },
      { value: "under-10k", label: "10,000명 이하" },
      { value: "under-100k", label: "100,000명 이하" },
      { value: "over-100k", label: "100,000명 초과" },
    ]);
    expect(AVAILABILITY_OPTIONS.map(({ value, label }) => ({ value, label: label.ko }))).toEqual([
      { value: "low", label: "낮음" },
      { value: "medium", label: "보통" },
      { value: "high", label: "높음" },
    ]);
    expect(TIER_LABELS).toEqual({
      low: { ko: "최저 비용", en: "Lowest cost" },
      balanced: { ko: "균형", en: "Balanced" },
      ha: { ko: "고가용성", en: "High availability" },
    });
    for (const users of EXPECTED_USERS_OPTIONS) {
      for (const availability of AVAILABILITY_OPTIONS) {
        expect(analysisInputSchema.safeParse({
          ...validInput, expectedUsers: users.value, availability: availability.value,
        }).success).toBe(true);
      }
    }
  });
});

it("검증 실패를 번역 키로 반환한다", () => {
  const parsed = analysisInputSchema.safeParse({});
  expect(parsed.success).toBe(false);
  if (!parsed.success) for (const issue of parsed.error.issues) expect(issue.message).toMatch(/^analysis\./);
});

it("프롬프트용 선택지와 설명은 사전의 두 언어다", () => {
  for (const text of [...EXPECTED_USERS_OPTIONS.map(option => option.label), ...AVAILABILITY_OPTIONS.map(option => option.label), EXPECTED_USERS_BASIS, EXPECTED_USERS_HELP, ...Object.values(AVAILABILITY_DESCRIPTIONS)]) {
    expect(text.en.length).toBeGreaterThan(0);
    expect(text.en).not.toMatch(/[가-힣]/);
    expect(text.ko.length).toBeGreaterThan(0);
  }
});
