import { describe, expect, it } from "vitest";
import { validateModelOutput } from "@/lib/analysis/validate-model-output";
import { loadCatalog } from "@/lib/catalog/load";
import type { ModelOutput } from "@/types/analysis";

const catalog = loadCatalog();

function createOutput(architecture = catalog.architectures[0]): ModelOutput {
  return {
    requestTitle: { en: "Reservation web service", ko: "예약 웹 서비스" },
    outOfScope: false,
    recommendedTier: "balanced",
    recommendationReason: { en: "Balances cost and ease of operation.", ko: "비용과 운영 편의성을 함께 고려했습니다." },
    plans: (["low", "balanced", "ha"] as const).map((tier) => {
      const { title, items, pros, connections } = architecture.tiers[tier];
      return structuredClone({ tier, referenceArchitectureId: architecture.id, title, items, pros, connections });
    }),
  };
}

function errorsFor(raw: unknown): string[] {
  const result = validateModelOutput(raw, catalog);
  expect(result.ok).toBe(false);
  expect(result).not.toHaveProperty("output");
  if (result.ok) throw new Error("잘못된 출력이 통과했습니다.");
  expect(result.errors.length).toBeGreaterThan(0);
  return result.errors;
}

describe("validateModelOutput", () => {
  it.each(catalog.architectures)("실제 카탈로그 $id의 3개 안을 허용한다", (architecture) => {
    const raw = createOutput(architecture);
    expect(validateModelOutput(raw, catalog)).toEqual({ ok: true, output: raw });
  });

  it("범위 밖 표시와 각 추천 단계를 그대로 보존한다", () => {
    for (const recommendedTier of ["low", "balanced", "ha"] as const) {
      const raw = { ...createOutput(), outOfScope: true, recommendedTier };
      expect(validateModelOutput(raw, catalog)).toEqual({ ok: true, output: raw });
    }
  });

  it.each([0, 1, 2, 4])("안 개수 %i개는 보완하거나 잘라내지 않고 거부한다", (length) => {
    const raw = createOutput();
    raw.plans = Array.from({ length }, (_, index) => raw.plans[index % 3]);
    expect(errorsFor(raw)).toEqual(expect.arrayContaining([expect.stringMatching(/plans:/)]));
  });

  it("중복 단계와 빠진 단계를 모두 보고한다", () => {
    const raw = createOutput();
    raw.plans[2].tier = "balanced";
    const errors = errorsFor(raw);
    expect(errors).toEqual(expect.arrayContaining([
      expect.stringMatching(/balanced.*한 번/), expect.stringMatching(/ha.*한 번/),
    ]));
  });

  it.each([
    ["없는 참조 아키텍처", (raw: ModelOutput) => { raw.plans[0].referenceArchitectureId = "unknown-architecture"; }, /plans.0.referenceArchitectureId.*카탈로그/],
    ["없는 구성요소", (raw: ModelOutput) => { raw.plans[0].items.push({ componentId: "unknown-component", quantity: 1 }); }, /plans.0.items.5.componentId.*카탈로그/],
    ["중복 구성요소", (raw: ModelOutput) => { raw.plans[0].items.push(raw.plans[0].items[0]); }, /plans.0.items.5.componentId.*중복/],
    ["컴퓨트 없음", (raw: ModelOutput) => { raw.plans[0].items = [{ componentId: "postgres-flex-b1ms", quantity: 1 }]; raw.plans[0].connections = []; }, /plans.0.items.*compute/],
    ["다른 안의 출발 노드", (raw: ModelOutput) => { raw.plans[0].connections[0].from = raw.plans[1].items[0].componentId; }, /plans.0.connections.0.from/],
    ["다른 안의 도착 노드", (raw: ModelOutput) => { raw.plans[0].connections[0].to = raw.plans[1].items[0].componentId; }, /plans.0.connections.0.to/],
    ["사용자 도착 노드", (raw: ModelOutput) => { raw.plans[0].connections[0].to = "user"; }, /plans.0.connections.0.to/],
    ["자기 연결", (raw: ModelOutput) => { raw.plans[0].connections[0].from = raw.plans[0].connections[0].to; }, /plans.0.connections.0:.*같/],
    ["특수 속성 이름", (raw: ModelOutput) => { raw.plans[0].items[0].componentId = "constructor"; }, /componentId.*카탈로그/],
  ] as const)("%s 위반을 거부한다", (_label, mutate, pattern) => {
    const raw = createOutput();
    mutate(raw);
    expect(errorsFor(raw)).toEqual(expect.arrayContaining([expect.stringMatching(pattern)]));
  });

  it.each([0, -1, NaN, Infinity, -Infinity])("수량 %s를 오류로 반환한다", (quantity) => {
    const raw = createOutput();
    raw.plans[0].items[0].quantity = quantity;
    expect(errorsFor(raw)).toEqual(expect.arrayContaining([expect.stringMatching(/plans.0.items.0.quantity/)]));
  });

  it.each(["http://example.com", "https://example.com", "www.example.com", "HTTPS://example.com", "WwW.example.com"])(
    "모든 글 필드에서 주소 %s를 거부한다",
    (url) => {
      for (const locale of ["en", "ko"] as const) {
        const raw = createOutput();
        raw.requestTitle[locale] = url;
        raw.recommendationReason[locale] = `Link: ${url}`;
        raw.plans[1].title[locale] = url;
        raw.plans[2].pros = [{ en: "Pro", ko: "장점", [locale]: url }, { en: "Pro", ko: "장점", [locale]: url }];
        const errors = errorsFor(raw);
        for (const path of ["requestTitle", "recommendationReason", "plans.1.title", "plans.2.pros.0", "plans.2.pros.1"]) {
          expect(errors).toEqual(expect.arrayContaining([expect.stringContaining(`${path}.${locale}:`)]));
        }
      }
    },
  );

  it("형식 오류가 있어도 다른 필드의 참조·단계·URL 오류를 함께 보고한다", () => {
    const raw = createOutput();
    raw.plans[0].items[0].quantity = NaN;
    raw.plans[0].referenceArchitectureId = "unknown-architecture";
    raw.plans[0].items.push(raw.plans[0].items[1]);
    raw.plans[1].items = [{ componentId: "missing-compute", quantity: 1 }];
    raw.plans[1].connections = [{ from: "missing-from", to: "user" }];
    raw.plans[2].tier = "low";
    raw.plans[2].connections = [{ from: "user", to: "user" }];
    raw.plans[2].pros = [{ en: "https://example.com", ko: "장점" }];
    const errors = errorsFor({ ...raw, requestTitle: null });
    for (const pattern of [
      /requestTitle/, /plans.0.items.0.quantity/, /plans.0.referenceArchitectureId/,
      /plans.0.items.5.componentId.*중복/, /plans.1.items.0.componentId/,
      /plans.1.items:.*compute/, /plans.1.connections.0.from/, /plans.1.connections.0.to/,
      /low.*한 번/, /ha.*한 번/, /plans.2.connections.0:.*같/, /plans.2.pros.0/,
    ]) expect(errors).toEqual(expect.arrayContaining([expect.stringMatching(pattern)]));
  });

  it.each([null, undefined, [], 1, "{}", {}, { plans: [null, { items: [null], connections: [null] }, []] }])(
    "구조가 잘못된 입력 %j도 throw하지 않고 오류를 반환한다",
    (raw) => { errorsFor(raw); },
  );

  it("모든 깊이의 추가 필드를 제거한다", () => {
    const expected = createOutput();
    const extras = { amount: 100, unitPrice: 10, currency: "CAD", url: "https://example.com", mermaid: "graph TD" };
    const raw = {
      ...expected, ...extras,
      plans: expected.plans.map((plan) => ({
        ...plan, ...extras,
        items: plan.items.map((item) => ({ ...item, ...extras })),
        connections: plan.connections.map((connection) => ({ ...connection, ...extras })),
      })),
    };
    expect(validateModelOutput(raw, catalog)).toEqual({ ok: true, output: expected });
    expect(raw).toHaveProperty("amount", 100);
  });

  it("단계를 정렬하고 동일 방향의 중복 연결만 합치며 원본과 카탈로그를 바꾸지 않는다", () => {
    const raw = createOutput();
    const plan = raw.plans[0];
    const original = structuredClone(plan.connections);
    const reverse = { from: original[1].to, to: original[1].from };
    plan.connections.push({ ...original[0] }, reverse, { ...original[1] });
    raw.plans = [raw.plans[2], raw.plans[0], raw.plans[1]];
    const rawBefore = structuredClone(raw);
    const catalogBefore = structuredClone(catalog);
    const result = validateModelOutput(raw, catalog);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.errors.join("\n"));
    expect(result.output.plans.map((entry) => entry.tier)).toEqual(["low", "balanced", "ha"]);
    expect(result.output.plans[0].connections).toEqual([...original, reverse]);
    expect(raw).toEqual(rawBefore);
    expect(catalog).toEqual(catalogBefore);
  });
});

it("영어 글의 한글 혼입을 필드 경로와 함께 알린다", () => {
  const raw = createOutput();
  raw.plans[0].pros[0].en = "English with 한글";
  expect(errorsFor(raw)).toContain("plans.0.pros.0.en: 영어 글에 한국어가 섞였습니다");
});
