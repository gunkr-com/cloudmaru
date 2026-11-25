import type { Catalog, PlanItem, PriceTier } from "@/types/catalog";
import type { CostLine, PlanCost } from "@/types/cost";

// 카탈로그 스키마로 검증된, 0부터 시작하는 오름차순 구간을 사용한다.
// 여기서는 반올림하지 않고 항목의 전체 금액을 구한 뒤 반올림한다.
// 센트로 반올림한다(반 센트는 올림). x * 100의 이진 오차(2.135 * 100 = 213.49999…)를 12자리로 걷어낸 뒤 반올림한다.
export function roundToCents(value: number): number {
  return Math.round(Number((value * 100).toPrecision(12))) / 100;
}

export function calculateTieredAmount(units: number, tiers: PriceTier[]): number {
  let amount = 0;
  for (let index = 0; index < tiers.length; index += 1) {
    const tier = tiers[index];
    if (units <= tier.minUnits) break;
    const upperBound = tiers[index + 1]?.minUnits ?? units;
    amount += (Math.min(units, upperBound) - tier.minUnits) * tier.unitPrice;
  }
  return amount;
}

export function calculatePlanCost(
  items: PlanItem[],
  catalog: Catalog,
  options: { region: string; monthlyBudget?: number },
): PlanCost {
  const components = new Map(catalog.components.map((component) => [component.id, component]));
  const lines: CostLine[] = items.map(({ componentId, quantity }) => {
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new Error(`구성요소 "${componentId}"의 수량은 0보다 큰 유한한 값이어야 합니다.`);
    }
    const component = components.get(componentId);
    if (!component) {
      throw new Error(`구성요소 "${componentId}"가 카탈로그에 없습니다.`);
    }

    const { pricing, usage } = component;
    let amount = 0;

    if (pricing.kind === "metered") {
      const regionalPrices = Object.hasOwn(catalog.prices.prices, componentId)
        ? catalog.prices.prices[componentId]
        : undefined;
      const price = regionalPrices && Object.hasOwn(regionalPrices, options.region)
        ? regionalPrices[options.region]
        : undefined;
      if (!price) {
        throw new Error(`구성요소 "${componentId}"의 가격 스냅샷이 없습니다.`);
      }
      const units = quantity * pricing.meterUnitsPerQuantity;
      amount = roundToCents(calculateTieredAmount(units, price.tiers));
    }

    return {
      componentId,
      name: component.name,
      quantity,
      unitLabel: component.unitLabel,
      assumptionLabel: pricing.kind === "metered" ? usage?.assumptionLabel ?? null : null,
      hourly: pricing.kind === "metered" && pricing.unitOfMeasure === "1 Hour",
      isAssumption: usage !== undefined,
      amount,
    };
  });

  // 표시된 항목 금액을 더하면 합계와 정확히 같아야 한다.
  const total = lines.reduce((sum, line) => sum + Math.round(line.amount * 100), 0) / 100;
  return {
    currency: "CAD",
    lines,
    total,
    budgetRatio: options.monthlyBudget === undefined ? null : total / options.monthlyBudget,
  };
}
