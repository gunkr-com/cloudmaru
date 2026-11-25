import { formatCostNote } from "@/lib/cost/format";
import { describe, expect, it } from "vitest";
import { calculatePlanCost, calculateTieredAmount, roundToCents } from "@/lib/cost/calculate";
import type { Catalog, Component, PlanItem, PriceTier } from "@/types/catalog";

function createCatalog(): Catalog {
  const compute = {
    id: "test-compute",
    name: { en: "테스트 컴퓨팅", ko: "테스트 컴퓨팅" },
    category: "compute",
    description: { en: "시간 과금 계산용", ko: "시간 과금 계산용" },
    unitLabel: { en: "대", ko: "대" },
    bicepResourceTypes: ["Microsoft.Web/sites"],
    pricing: {
      kind: "metered",
      productName: "Test Compute",
      skuName: "Test SKU",
      meterName: "Compute",
      unitOfMeasure: "1 Hour",
      meterUnitsPerQuantity: 730,
    },
  } satisfies Component;

  return {
    components: [
      compute,
      {
        ...compute,
        id: "test-storage",
        name: { en: "테스트 저장소", ko: "테스트 저장소" },
        category: "storage",
        unitLabel: { en: "GB", ko: "GB" },
        pricing: {
          ...compute.pricing,
          unitOfMeasure: "1 GB/Month",
          meterUnitsPerQuantity: 1,
        },
      },
      {
        ...compute,
        id: "test-egress",
        name: { en: "테스트 데이터 송신", ko: "테스트 데이터 송신" },
        category: "network",
        unitLabel: { en: "GB", ko: "GB" },
        pricing: {
          ...compute.pricing,
          unitOfMeasure: "1 GB",
          meterUnitsPerQuantity: 1,
        },
        usage: { defaultQuantity: 100, assumptionLabel: { en: "월 {quantity}GB 전송", ko: "월 {quantity}GB 전송" } },
      },
      {
        id: "test-static",
        name: { en: "테스트 무료 앱", ko: "테스트 무료 앱" },
        category: "compute",
        description: { en: "무료 항목 계산용", ko: "무료 항목 계산용" },
        unitLabel: { en: "앱", ko: "앱" },
        bicepResourceTypes: [],
        pricing: { kind: "free" },
      },
    ],
    architectures: [],
    prices: {
      asOf: "2026-01-01",
      currency: "CAD",
      regions: ["canadacentral"],
      usdToCad: { rate: 1.4, pairs: 5 },
      prices: {
        "test-compute": { canadacentral: {
          meterId: "compute-meter",
          unitOfMeasure: "1 Hour",
          tiers: [{ minUnits: 0, unitPrice: 2.125 }],
        } },
        "test-storage": { canadacentral: {
          meterId: "storage-meter",
          unitOfMeasure: "1 GB/Month",
          tiers: [{ minUnits: 0, unitPrice: 1.25 }],
        } },
        "test-egress": { canadacentral: {
          meterId: "egress-meter",
          unitOfMeasure: "1 GB",
          tiers: [
            { minUnits: 0, unitPrice: 0 },
            { minUnits: 100, unitPrice: 150 },
          ],
        } },
      },
    },
  };
}

describe("calculateTieredAmount", () => {
  it("단일 구간의 단가에 미터 단위 수를 곱한다", () => {
    expect(calculateTieredAmount(10, [{ minUnits: 0, unitPrice: 2.5 }])).toBe(25);
  });

  it("소수 단위 수와 반올림 전 금액을 유지한다", () => {
    expect(calculateTieredAmount(0.25, [{ minUnits: 0, unitPrice: 2.5 }])).toBe(0.625);
  });

  const freeFirstTiers: PriceTier[] = [
    { minUnits: 0, unitPrice: 0 },
    { minUnits: 100, unitPrice: 150 },
  ];

  it.each([
    [0, 0],
    [50, 0],
    [100, 0],
    [250, 22500],
  ])("첫 구간이 무료일 때 %s단위의 금액은 %s원이다", (units, amount) => {
    expect(calculateTieredAmount(units, freeFirstTiers)).toBe(amount);
  });

  it.each([
    [100, 200],
    [200, 300],
    [250, 325],
  ])("여러 구간에서 %s단위를 누진 계산하면 %s원이다", (units, amount) => {
    expect(calculateTieredAmount(units, [
      { minUnits: 0, unitPrice: 2 },
      { minUnits: 100, unitPrice: 1 },
      { minUnits: 200, unitPrice: 0.5 },
    ])).toBe(amount);
  });
});

describe("roundToCents", () => {
  it.each([[2.135, 2.14], [4.015, 4.02], [10.005, 10.01], [1.005, 1.01], [2.675, 2.68], [0.125, 0.13], [0.124, 0.12], [3102.5, 3102.5], [0, 0], [123456.785, 123456.79]])(
    "%d → %d (반 센트는 올림)", (value, expected) => {
      expect(roundToCents(value)).toBe(expected);
    });
});

describe("calculatePlanCost", () => {
  it("시간 과금 수량을 730시간으로 환산하고 항목 금액을 센트 단위로 반올림한다", () => {
    const result = calculatePlanCost([{ componentId: "test-compute", quantity: 2 }], createCatalog(), { region: "canadacentral" });
    expect(result.lines).toEqual([{
      componentId: "test-compute",
      name: { en: "테스트 컴퓨팅", ko: "테스트 컴퓨팅" },
      quantity: 2,
      unitLabel: { en: "대", ko: "대" },
      assumptionLabel: null, hourly: true,
      isAssumption: false,
      amount: 3102.5,
    }]);
    expect(result.total).toBe(3102.5);
  });

  it("사용량 기반 항목은 실제 수량의 가정 문구와 누진 금액을 반환한다", () => {
    const result = calculatePlanCost([{ componentId: "test-egress", quantity: 250 }], createCatalog(), { region: "canadacentral" });
    expect(result.lines).toEqual([{
      componentId: "test-egress",
      name: { en: "테스트 데이터 송신", ko: "테스트 데이터 송신" },
      quantity: 250,
      unitLabel: { en: "GB", ko: "GB" },
      assumptionLabel: { en: "월 {quantity}GB 전송", ko: "월 {quantity}GB 전송" }, hourly: false,
      isAssumption: true,
      amount: 22500,
    }]);
  });

  it("수량을 미터 단위로 환산한 뒤 가격 구간에 적용한다", () => {
    const catalog = createCatalog();
    const component = catalog.components[2];
    if (component.pricing.kind !== "metered") throw new Error("테스트 구성 오류");
    component.pricing.meterUnitsPerQuantity = 1000;
    expect(calculatePlanCost([{ componentId: component.id, quantity: 0.25 }], catalog, { region: "canadacentral" }).lines[0])
      .toMatchObject({ amount: 22500, assumptionLabel: { en: "월 {quantity}GB 전송", ko: "월 {quantity}GB 전송" } });
  });

  it.each([
    ["test-compute", 1000, "1,000대 · 730시간"],
    ["test-storage", 128, "128GB"],
    ["test-storage", 1234.56789, "1,234.56789GB"],
    ["test-egress", 1250, "가정: 월 1,250GB 전송"],
    ["test-egress", 0.00001, "가정: 월 0.00001GB 전송"],
  ])("%s 수량 %s의 단위와 천 단위 구분을 표기한다", (componentId, quantity, note) => {
    expect(formatCostNote(calculatePlanCost([{ componentId, quantity }], createCatalog(), { region: "canadacentral" }).lines[0], "ko")).toBe(note);
  });

  it.each([
    ["test-storage", "10회", 3, "3 × 10회"],
    ["test-storage", "상시 할당 GiB", 0.5, "0.5 상시 할당 GiB"],
    ["test-compute", "상시 실행 vCPU", 2, "2 상시 실행 vCPU · 730시간"],
  ])("%s의 단위 %s도 카드와 같은 공용 수량 표기를 쓴다", (componentId, unitLabel, quantity, note) => {
    const catalog = createCatalog();
    catalog.components.find(({ id }) => id === componentId)!.unitLabel = { en: unitLabel, ko: unitLabel };
    expect(formatCostNote(calculatePlanCost([{ componentId, quantity }], catalog, { region: "canadacentral" }).lines[0], "ko")).toBe(note);
  });

  it("시간 과금 항목에도 usage가 있으면 가정 문구를 우선하고 모든 수량 자리를 치환한다", () => {
    const catalog = createCatalog();
    catalog.components[0].usage = {
      defaultQuantity: 1,
      assumptionLabel: { en: "월 {quantity}대 실행 (동시 {quantity}대)", ko: "월 {quantity}대 실행 (동시 {quantity}대)" },
    };
    expect(calculatePlanCost([{ componentId: "test-compute", quantity: 2 }], catalog, { region: "canadacentral" }).lines[0])
      .toMatchObject({ assumptionLabel: { en: "월 {quantity}대 실행 (동시 {quantity}대)", ko: "월 {quantity}대 실행 (동시 {quantity}대)" }, hourly: true, isAssumption: true, amount: 3102.5 });
  });

  it("무료 항목은 가격 스냅샷 없이 0원과 무료 문구를 반환한다", () => {
    expect(calculatePlanCost([{ componentId: "test-static", quantity: 1 }], createCatalog(), { region: "canadacentral" }).lines)
      .toEqual([{
        componentId: "test-static",
        name: { en: "테스트 무료 앱", ko: "테스트 무료 앱" },
        quantity: 1,
        unitLabel: { en: "앱", ko: "앱" },
        assumptionLabel: null, hourly: false,
        isAssumption: false,
        amount: 0,
      }]);
  });

  it("무료 항목의 note는 무료를 유지하고 isAssumption은 usage 존재 여부를 따른다", () => {
    const catalog = createCatalog();
    catalog.components[3].usage = { defaultQuantity: 1, assumptionLabel: { en: "월 {quantity}앱 실행", ko: "월 {quantity}앱 실행" } };
    expect(calculatePlanCost([{ componentId: "test-static", quantity: 1 }], catalog, { region: "canadacentral" }).lines[0])
      .toMatchObject({ assumptionLabel: null, hourly: false, isAssumption: true, amount: 0 });
  });

  it("입력 순서를 보존하고 반올림한 항목 금액의 합을 합계로 사용한다", () => {
    const items: PlanItem[] = [
      { componentId: "test-storage", quantity: 1 },
      { componentId: "test-static", quantity: 1 },
      { componentId: "test-compute", quantity: 1 },
    ];
    const result = calculatePlanCost(items, createCatalog(), { region: "canadacentral" });
    expect(result.lines.map(({ componentId }) => componentId)).toEqual(items.map(({ componentId }) => componentId));
    expect(result.lines.map(({ amount }) => amount)).toEqual([1.25, 0, 1551.25]);
    // 센트로 반올림한 항목 합계를 그대로 보존한다.
    expect(result.total).toBe(1552.5);
    expect(result.total).toBe(result.lines.reduce((sum, line) => sum + line.amount, 0));
  });

  it("항목 내 가격 구간을 모두 더한 다음 한 번 반올림한다", () => {
    const catalog = createCatalog();
    catalog.prices.prices["test-storage"].canadacentral.tiers = [
      { minUnits: 0, unitPrice: 0.6 },
      { minUnits: 1, unitPrice: 0.6 },
    ];
    expect(calculatePlanCost([{ componentId: "test-storage", quantity: 2 }], catalog, { region: "canadacentral" }).total).toBe(1.2);
  });

  it("반올림된 합계를 월 예산으로 나눈 비율을 반환한다", () => {
    const result = calculatePlanCost([{ componentId: "test-compute", quantity: 2 }], createCatalog(), { region: "canadacentral", monthlyBudget: 3000 });
    expect(result.budgetRatio).toBe(3102.5 / 3000);
  });

  it("예산이 없으면 비율은 null이다", () => {
    expect(calculatePlanCost([{ componentId: "test-compute", quantity: 1 }], createCatalog(), { region: "canadacentral" }).budgetRatio).toBeNull();
  });

  it("무료 구성도 예산이 있으면 비율 0을 반환한다", () => {
    expect(calculatePlanCost([{ componentId: "test-static", quantity: 1 }], createCatalog(), { region: "canadacentral", monthlyBudget: 3000 }).budgetRatio).toBe(0);
  });

  it("빈 목록의 합계는 0이다", () => {
    expect(calculatePlanCost([], createCatalog(), { region: "canadacentral" })).toEqual({ currency: "CAD", lines: [], total: 0, budgetRatio: null });
  });

  it("입력 목록과 카탈로그를 변경하지 않고 반복 호출에 같은 결과를 반환한다", () => {
    const items: PlanItem[] = [{ componentId: "test-egress", quantity: 250 }];
    const catalog = createCatalog();
    const original = structuredClone({ items, catalog });
    const result = calculatePlanCost(items, catalog, { region: "canadacentral", monthlyBudget: 30000 });
    expect(calculatePlanCost(items, catalog, { region: "canadacentral", monthlyBudget: 30000 })).toEqual(result);
    expect({ items, catalog }).toEqual(original);
  });

  it("카탈로그에 없는 구성요소는 오류를 던진다", () => {
    expect(() => calculatePlanCost([{ componentId: "missing", quantity: 1 }], createCatalog(), { region: "canadacentral" }))
      .toThrow(/missing.*카탈로그/);
  });

  it("미터 과금 구성요소에 가격 스냅샷이 없으면 오류를 던진다", () => {
    const catalog = createCatalog();
    delete catalog.prices.prices["test-compute"];
    expect(() => calculatePlanCost([{ componentId: "test-compute", quantity: 1 }], catalog, { region: "canadacentral" }))
      .toThrow(/test-compute.*가격/);
  });

  it.each([0, -1, NaN, Infinity, -Infinity])("유효하지 않은 수량 %s는 무료·유료 모두 오류를 던진다", (quantity) => {
    for (const componentId of ["test-compute", "test-static"]) {
      expect(() => calculatePlanCost([{ componentId, quantity }], createCatalog(), { region: "canadacentral" })).toThrow(/수량/);
    }
  });
});

it("rejects a missing regional price and sums rounded cents", () => {
  const catalog = createCatalog();
  expect(() => calculatePlanCost([{ componentId: "test-compute", quantity: 1 }], catalog, { region: "canadaeast" })).toThrow(/가격/);
  const result = calculatePlanCost([{ componentId: "test-storage", quantity: 0.084 }, { componentId: "test-egress", quantity: 100.00072 }], catalog, { region: "canadacentral" });
  expect(result.currency).toBe("CAD");
  expect(result.lines.map(line => line.amount)).toEqual([0.11, 0.11]);
  expect(result.total).toBe(0.22);
});
it.each(["constructor", "toString", "__proto__"])("treats inherited regional property %s as missing", region => {
  expect(() => calculatePlanCost([{ componentId: "test-compute", quantity: 1 }], createCatalog(), { region })).toThrow(/가격 스냅샷/);
});
