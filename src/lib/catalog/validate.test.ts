import { describe, expect, it } from "vitest";
import { createCatalog } from "@/lib/catalog/fixtures.test-data";
import { validateCatalog } from "@/lib/catalog/validate";
import type { Catalog, Tier } from "@/types/catalog";

function errorsFor(raw: Parameters<typeof validateCatalog>[0]) {
  const result = validateCatalog(raw);
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("검증 실패가 필요합니다.");
  return result.errors;
}

describe("validateCatalog", () => {
  it("상호 참조가 맞는 카탈로그를 반환하며 입력을 바꾸지 않는다", () => {
    const catalog = createCatalog();
    catalog.architectures[0].tiers.low.items.push({ componentId: "test-static", quantity: 1 });
    catalog.architectures[0].tiers.low.connections.push({ from: "test-compute", to: "test-static" });
    const before = structuredClone(catalog);
    expect(validateCatalog(catalog)).toEqual({ ok: true, catalog });
    expect(catalog).toEqual(before);
  });

  it("빈 카탈로그를 허용한다", () => {
    const catalog = { components: [], architectures: [], prices: { asOf: "2026-10-08", currency: "CAD", regions: ["canadacentral"], usdToCad: { rate: 1.4, pairs: 5 }, prices: {} } };
    expect(validateCatalog(catalog)).toEqual({ ok: true, catalog });
  });

  it.each([
    ["구성요소 중복", (catalog: Catalog) => { catalog.components.push(catalog.components[0]); }, /components.*중복/],
    ["참조 아키텍처 중복", (catalog: Catalog) => { catalog.architectures.push(catalog.architectures[0]); }, /architectures.*중복/],
    ["미터 과금 가격 누락", (catalog: Catalog) => { delete catalog.prices.prices["test-compute"]; }, /test-compute.*가격.*없/],
    ["미터 단위 불일치", (catalog: Catalog) => { catalog.prices.prices["test-compute"].canadacentral.unitOfMeasure = "1 GB"; }, /test-compute.*unitOfMeasure.*일치/],
    ["없는 구성요소 가격", (catalog: Catalog) => { catalog.prices.prices["unknown-component"] = catalog.prices.prices["test-compute"]; }, /unknown-component.*구성요소.*없/],
    ["무료 구성요소 가격", (catalog: Catalog) => { catalog.prices.prices["test-static"] = catalog.prices.prices["test-compute"]; }, /test-static.*무료/],
  ] as const)("%s를 보고한다", (_name, mutate, error) => {
    const catalog = createCatalog();
    mutate(catalog);
    expect(errorsFor(catalog)).toEqual(expect.arrayContaining([expect.stringMatching(error)]));
  });

  it.each<Tier>(["low", "balanced", "ha"])("%s 단계의 모든 참조 오류를 보고한다", (tier) => {
    const catalog = createCatalog();
    const plan = catalog.architectures[0].tiers[tier];
    plan.items.push({ componentId: "unknown-component", quantity: 1 }, plan.items[0]);
    plan.connections.push(
      { from: "test-static", to: "test-compute" },
      { from: "test-compute", to: "test-static" },
      { from: "test-compute", to: "user" },
      { from: "test-compute", to: "test-compute" },
    );
    const errors = errorsFor(catalog);
    expect(errors).toHaveLength(6);
    for (const field of ["items.1.componentId", "items.2.componentId", "connections.1.from", "connections.2.to", "connections.3.to", "connections.4"]) {
      expect(errors).toEqual(expect.arrayContaining([expect.stringContaining(`architectures.0.tiers.${tier}.${field}`)]));
    }
  });

  it.each([
    [[], /tiers/],
    [[{ minUnits: 1, unitPrice: 1 }], /첫.*0/],
    [[{ minUnits: 0, unitPrice: 1 }, { minUnits: 100, unitPrice: 1 }, { minUnits: 50, unitPrice: 1 }], /오름차순/],
    [[{ minUnits: 0, unitPrice: 1 }, { minUnits: 10, unitPrice: 1 }, { minUnits: 0, unitPrice: 1 }], /중복/],
  ] as const)("잘못된 가격 구간 %j를 보고한다", (tiers, error) => {
    const catalog = createCatalog();
    catalog.prices.prices["test-compute"].canadacentral.tiers = [...tiers];
    expect(errorsFor(catalog)).toEqual(expect.arrayContaining([expect.stringMatching(error)]));
  });

  it("각 파일의 스키마 오류를 모두 보고하며 throw하지 않는다", () => {
    const errors = errorsFor({ components: null, architectures: {}, prices: { asOf: "bad", currency: "USD", prices: [] } });
    for (const field of ["components", "architectures", "prices.asOf", "prices.currency", "prices.prices"]) {
      expect(errors).toEqual(expect.arrayContaining([expect.stringContaining(field)]));
    }
  });

  it("스키마 오류와 독립적인 상호 참조 오류를 함께 보고한다", () => {
    const catalog = createCatalog();
    catalog.components.push(catalog.components[0]);
    catalog.architectures.push(catalog.architectures[0]);
    catalog.architectures[0].tiers.low.items[0].quantity = -1;
    catalog.architectures[0].tiers.balanced.items.push({ componentId: "unknown-component", quantity: 1 });
    catalog.architectures[0].tiers.ha.connections.push({ from: "test-static", to: "user" });
    catalog.prices.asOf = "bad";
    catalog.prices.prices["test-compute"].canadacentral.meterId = "wrong-meter";
    catalog.prices.prices["test-compute"].canadacentral.unitOfMeasure = "wrong-unit";
    catalog.prices.prices["test-compute"].canadacentral.tiers = [{ minUnits: 1, unitPrice: 1 }, { minUnits: 1, unitPrice: 1 }];
    catalog.prices.prices["unknown-component"] = catalog.prices.prices["test-compute"];
    catalog.prices.prices["test-static"] = catalog.prices.prices["test-compute"];

    const errors = errorsFor({ ...catalog, components: catalog.components.map((component) => ({ ...component, name: undefined })) });
    for (const pattern of [
      /components.0.name/, /components.*중복/, /architectures.*중복/,
      /low.items.0.quantity/, /balanced.items.1.componentId/, /ha.connections.1.from/, /ha.connections.1.to/,
      /prices.asOf/, /test-compute.*unitOfMeasure.*일치/,
      /첫.*0/, /중복/, /unknown-component.*구성요소.*없/, /test-static.*무료/,
    ]) {
      expect(errors).toEqual(expect.arrayContaining([expect.stringMatching(pattern)]));
    }
  });

  it("특수 객체 속성 이름을 구성요소로 오인하지 않는다", () => {
    const catalog = createCatalog();
    catalog.prices.prices = JSON.parse('{"constructor":{"meterId":"test-meter","unitOfMeasure":"1 Hour","tiers":[{"minUnits":0,"unitPrice":0}]}}');
    expect(errorsFor(catalog)).toEqual(expect.arrayContaining([
      expect.stringMatching(/constructor.*구성요소.*없/),
      expect.stringMatching(/test-compute.*가격.*없/),
    ]));
  });

  it("가격 필드 형식 오류가 있어도 읽을 수 있는 구간 오류를 모두 보고한다", () => {
    const catalog = createCatalog();
    const errors = errorsFor({
      ...catalog,
      prices: {
        ...catalog.prices,
        prices: {
          "test-compute": { canadacentral: {
            ...catalog.prices.prices["test-compute"].canadacentral,
            tiers: [
              { minUnits: 5, unitPrice: undefined },
              null,
              { minUnits: 5, unitPrice: 1 },
              { minUnits: 2, unitPrice: 1 },
            ],
          } },
        },
      },
    });
    for (const pattern of [/tiers.0.unitPrice/, /tiers.1/, /첫.*0/, /중복/, /오름차순/]) {
      expect(errors).toEqual(expect.arrayContaining([expect.stringMatching(pattern)]));
    }
  });
});

it("requires every region and rejects undeclared regional prices", () => {
  const catalog = createCatalog();
  catalog.prices.regions.push("canadaeast");
  expect(errorsFor(catalog).join("\n")).toMatch(/canadaeast.*가격.*없/);
  catalog.prices.regions.pop();
  catalog.prices.prices["test-compute"].canadaeast = catalog.prices.prices["test-compute"].canadacentral;
  expect(errorsFor(catalog).join("\n")).toMatch(/canadaeast.*지역.*없/);
});
