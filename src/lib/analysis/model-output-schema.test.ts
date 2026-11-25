import { describe, expect, expectTypeOf, it } from "vitest";
import {
  MODEL_OUTPUT_JSON_SCHEMA,
  MODEL_OUTPUT_SCHEMA_NAME,
  modelOutputSchema,
} from "@/lib/analysis/model-output-schema";
import type { ModelOutput, ModelPlan } from "@/types/analysis";
import { validationLimit } from "@/lib/llm/localized-text";

function createOutput(): ModelOutput {
  return {
    requestTitle: { en: "Reservation web service", ko: "예약 웹 서비스" },
    outOfScope: false,
    recommendedTier: "balanced",
    recommendationReason: { en: "Balances cost and ease of operation.", ko: "비용과 운영 편의성을 함께 고려했습니다." },
    plans: (["low", "balanced", "ha"] as const).map((tier) => ({
      tier,
      referenceArchitectureId: "app-service-basic-web-app",
      title: { en: "Web app configuration", ko: "웹앱 운영 구성" },
      items: [{ componentId: "app-service-linux-b1", quantity: 1 }],
      pros: [{ en: "Reduces web server maintenance.", ko: "웹 서버의 관리 부담을 줄입니다." }],
      connections: [{ from: "user", to: "app-service-linux-b1" }],
    })),
  };
}

describe("modelOutputSchema", () => {
  it("정상 구조와 출력 타입을 보장한다", () => {
    const output = modelOutputSchema.parse(createOutput());
    expect(output).toEqual(createOutput());
    expectTypeOf(output).toEqualTypeOf<ModelOutput>();
    expectTypeOf(output.plans[0]).toEqualTypeOf<ModelPlan>();
  });

  it("최대 길이·개수 경계, 소수 수량, 빈 연결 목록을 허용한다", () => {
    const raw = createOutput();
    raw.requestTitle = { en: "a".repeat(validationLimit(80)), ko: "가".repeat(validationLimit(40)) };
    raw.recommendationReason = { en: "a".repeat(validationLimit(400)), ko: "가".repeat(validationLimit(200)) };
    raw.outOfScope = true;
    raw.plans[0].title = { en: "a".repeat(validationLimit(80)), ko: "가".repeat(validationLimit(40)) };
    raw.plans[0].pros = Array.from({ length: 4 }, () => ({ en: "a".repeat(validationLimit(240)), ko: "가".repeat(validationLimit(120)) }));
    raw.plans[0].items = Array.from({ length: 20 }, () => ({ componentId: "app-service-linux-b1", quantity: 0.25 }));
    raw.plans[0].connections = [];
    expect(modelOutputSchema.safeParse(raw).success).toBe(true);
  });

  it.each<readonly [string, unknown]>([
    ["requestTitle", "가".repeat(validationLimit(40) + 1)],
    ["recommendationReason", "가".repeat(validationLimit(200) + 1)],
    ["outOfScope", "false"],
    ["recommendedTier", "medium"],
    ["plans", []],
    ["plans", createOutput().plans.slice(0, 2)],
    ["plans", [...createOutput().plans, createOutput().plans[0]]],
    ...Object.keys(createOutput()).map((field) => [field, undefined] as const),
  ])("잘못된 최상위 필드 %s를 거부한다", (field, value) => {
    expect(modelOutputSchema.safeParse({ ...createOutput(), [field]: value }).success).toBe(false);
  });

  it.each<readonly [string, unknown]>([
    ["title", "가".repeat(validationLimit(40) + 1)],
    ["tier", "medium"],
    ["items", []],
    ["items", Array.from({ length: 21 }, () => ({ componentId: "app-service-linux-b1", quantity: 1 }))],
    ["pros", []],
    ["pros", ["가".repeat(validationLimit(120) + 1)]],
    ["pros", Array.from({ length: 5 }, () => "장점")],
    ["connections", [{ from: "user" }]],
    ["connections", [{ to: "app-service-linux-b1" }]],
    ["items", [{ componentId: "app-service-linux-b1" }]],
    ["items", [{ quantity: 1 }]],
    ...Object.keys(createOutput().plans[0]).map((field) => [field, undefined] as const),
  ])("잘못된 안 필드 %s를 거부한다", (field, value) => {
    const raw = createOutput();
    raw.plans[0] = { ...raw.plans[0], [field]: value };
    expect(modelOutputSchema.safeParse(raw).success).toBe(false);
  });

  it.each([0, -1, Infinity, -Infinity, NaN, "1", null])("잘못된 수량 %s를 거부한다", (quantity) => {
    const raw = createOutput();
    const plans = raw.plans.map((plan) => ({ ...plan, items: [{ componentId: "app-service-linux-b1", quantity }] }));
    expect(modelOutputSchema.safeParse({ ...raw, plans }).success).toBe(false);
  });
});

describe("MODEL_OUTPUT_JSON_SCHEMA", () => {
  it("제공자 스키마 이름은 비어 있지 않은 안전한 식별자다", () => {
    expect(MODEL_OUTPUT_SCHEMA_NAME).toMatch(/^[a-zA-Z0-9_-]{1,64}$/);
  });

  it("모든 객체는 모든 필드를 필수로 지정하며 단순 구조 키워드만 사용한다", () => {
    const allowed = ["type", "properties", "items", "required", "enum", "additionalProperties"];
    function check(schema: unknown): void {
      expect(schema).toBeTypeOf("object");
      const node = schema as Record<string, unknown>;
      expect(Object.keys(node).every((key) => allowed.includes(key))).toBe(true);
      if (node.type === "object") {
        const properties = node.properties as Record<string, unknown>;
        expect(node.additionalProperties).toBe(false);
        expect(node.required).toEqual(Object.keys(properties));
        for (const child of Object.values(properties)) check(child);
      } else if (node.type === "array") {
        check(node.items);
      } else {
        expect(["string", "boolean", "number"]).toContain(node.type);
      }
    }
    check(MODEL_OUTPUT_JSON_SCHEMA);
  });

  it("금액·URL·Mermaid 없이 모델 출력의 모든 필드와 타입을 표현한다", () => {
    const string = { type: "string" };
    const tier = { type: "string", enum: ["low", "balanced", "ha"] };
    const object = (properties: Record<string, unknown>) => ({
      type: "object", properties, required: Object.keys(properties), additionalProperties: false,
    });
    const localized = object({ en: string, ko: string });
    expect(MODEL_OUTPUT_JSON_SCHEMA).toEqual(object({
      requestTitle: localized,
      outOfScope: { type: "boolean" },
      recommendedTier: tier,
      recommendationReason: localized,
      plans: {
        type: "array",
        items: object({
          tier,
          referenceArchitectureId: string,
          title: localized,
          items: { type: "array", items: object({ componentId: string, quantity: { type: "number" } }) },
          pros: { type: "array", items: localized },
          connections: { type: "array", items: object({ from: string, to: string }) },
        }),
      },
    }));
  });
});

it.each([
  ["requestTitle", 40], ["recommendationReason", 200], ["title", 40], ["pro", 120],
] as const)("en·ko %s 길이 한도를 각각 검사한다", (field, koLimit) => {
  for (const locale of ["en", "ko"] as const) {
    const raw = createOutput();
    const text = { en: "English", ko: "한국어" };
    text[locale] = (locale === "en" ? "a" : "가").repeat(validationLimit(locale === "en" ? koLimit * 2 : koLimit) + 1);
    if (field === "title") raw.plans[0].title = text;
    else if (field === "pro") raw.plans[0].pros = [text];
    else raw[field] = text;
    const parsed = modelOutputSchema.safeParse(raw);
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(parsed.error.issues[0].path.at(-1)).toBe(locale);
  }
});
