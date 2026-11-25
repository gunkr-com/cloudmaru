import { catalogSchema } from "@/lib/catalog/schema";
import { extensionSupportCatalogSchema } from "@/lib/catalog/extension-support-schema";
import { componentSchema, extensionProposalSchema, incrementalCostSchema } from "@/lib/completion/schema";
import { calculateTieredAmount, roundToCents } from "@/lib/cost/calculate";
import type { Catalog, PriceTier } from "@/types/catalog";
import type { ComponentResult, CompletionReasonCode } from "@/types/completion";
import type { ExtensionProposal, IncrementalCost } from "@/types/extension";
import type { ExtensionSupportCatalog } from "@/types/extension-support";

const resultSchema = componentSchema(incrementalCostSchema);
const reasonOrder = ["unsupported-region", "price-unavailable"] as const;
function invalid(): never { throw new Error("validation-failed"); }
function cents(amount: number): number {
  const value = Math.round(amount * 100);
  if (!Number.isFinite(amount) || amount < 0 || !Number.isSafeInteger(value)) invalid();
  return value;
}

/** 기존 환경의 무료 한도 잔량은 알 수 없다. 계량 신규 항목과 증가분에 무료 구간을 다시 부여하지 않는다. */
function incrementalTiers(tiers: PriceTier[]): PriceTier[] {
  const firstPaid = tiers.findIndex(tier => tier.unitPrice > 0);
  if (firstPaid < 0) return [];
  const offset = tiers[firstPaid].minUnits;
  return tiers.slice(firstPaid).map(tier => ({ ...tier, minUnits: tier.minUnits - offset }));
}

/**
 * validateExtensionProposal을 통과한 저장 ID의 안을 받는 순수 계산이다.
 * 재사용 적격성·용량은 별도 검사하며 실제 청구·기존 기본 요금을 입력받지 않는다.
 * priceRegion은 조회 미터의 명시적 매핑이다. 스냅샷은 선택 지역 키로 저장돼 있다.
 */
export function calculateExtensionIncrementalCost(
  rawPlan: ExtensionProposal["plans"][number], rawCatalog: Catalog,
  options: { support: ExtensionSupportCatalog; region: string },
): ComponentResult<IncrementalCost> {
  try {
    const plan = extensionProposalSchema.shape.plans.element.parse(rawPlan);
    // 완전한 가격표를 요구하는 validateCatalog와 달리 구조를 검증하고 가격 누락은 부분 상태로 남긴다.
    const catalog = catalogSchema.parse(rawCatalog);
    const support = extensionSupportCatalogSchema.parse(options.support);
    const components = new Map(catalog.components.map(c => [c.id, c]));
    if (components.size !== catalog.components.length) invalid();
    const expected: IncrementalCost["lines"] = [
      ...plan.newItems.map(({ componentId, quantity }) => ({ componentId, quantity, kind: "new" as const, resourceId: null, amount: 0 })),
      ...plan.usageIncreases.map(item => ({ ...item, kind: "usage-increase" as const, amount: 0 })),
    ];
    expected.sort((a, b) => {
      for (const field of ["kind", "componentId", "resourceId"] as const) {
        const left = a[field] ?? "";
        const right = b[field] ?? "";
        if (left !== right) return left < right ? -1 : 1;
      }
      return 0;
    });
    const lines: IncrementalCost["lines"] = [];
    const missing = new Set<CompletionReasonCode>();
    let totalCents = 0;
    for (const item of expected) {
      const component = components.get(item.componentId);
      const entry = support.components.find(c => c.componentId === item.componentId);
      if (!component || !entry) invalid();
      const pair = entry.regions.find(r => r.regionId === options.region);
      if (!support.regions.some(r => r.id === options.region) || !pair || pair.status !== "supported") {
        missing.add("unsupported-region");
        continue;
      }
      let amount = 0;
      const pricing = component.pricing;
      if (pricing.kind === "free") {
        if (pair.priceRegion !== undefined || item.kind !== "new") invalid();
      } else {
        if (pair.priceRegion !== (pricing.priceRegion ?? options.region)) invalid();
        const rows = Object.hasOwn(catalog.prices.prices, component.id) ? catalog.prices.prices[component.id] : undefined;
        const price = rows && Object.hasOwn(rows, options.region) ? rows[options.region] : undefined;
        if (!catalog.prices.regions.includes(options.region) || !price || price.unitOfMeasure !== pricing.unitOfMeasure) {
          missing.add("price-unavailable");
          continue;
        }
        const units = item.quantity * pricing.meterUnitsPerQuantity;
        if (!Number.isFinite(units) || units <= 0) invalid();
        const tiers = item.kind === "usage-increase" || component.usage !== undefined
          ? incrementalTiers(price.tiers) : price.tiers;
        if (!tiers.length) { missing.add("price-unavailable"); continue; }
        const unrounded = calculateTieredAmount(units, tiers);
        cents(unrounded); // 반올림의 중간 곱셈까지 안전해야 한다.
        amount = roundToCents(unrounded);
      }
      totalCents += cents(amount);
      if (!Number.isSafeInteger(totalCents)) invalid();
      lines.push({ ...item, amount });
    }
    const reasons = reasonOrder.filter(reason => missing.has(reason));
    // 단일 unavailable.reason은 지역 불확실성을 우선한다. 부분 결과에는 모든 이유를 보존한다.
    if (!lines.length) return resultSchema.parse({ state: "unavailable", reason: reasons[0] ?? "price-unavailable" });
    const data: IncrementalCost = { currency: catalog.prices.currency, priceAsOf: catalog.prices.asOf, lines, total: totalCents / 100 };
    return resultSchema.parse(reasons.length ? { state: "partial", data, reasons } : { state: "available", data });
  } catch { return invalid(); }
}
