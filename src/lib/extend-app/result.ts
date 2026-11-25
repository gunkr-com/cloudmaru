import type { ExtensionCoreData } from "@/lib/extend/process";
import type { ExtensionResult } from "@/types/extension";
import type { Component, ReferenceArchitecture, Tier } from "@/types/catalog";
import type { LocalizedText } from "@/types/i18n";
import type { ScanInventory } from "@/types/scan";

export type ExtensionDisplay = {
  result: ExtensionResult;
  priceAsOf: string;
  region: LocalizedText;
  components: Record<string, Pick<Component, "name" | "unitLabel"> & {
    assumption: LocalizedText | null; hourly: boolean; free: boolean;
    sources: { title: string; url: string }[];
  }>;
  references: Record<string, Pick<ReferenceArchitecture, "name" | "sources">>;
  resources: Record<string, { name: string; type: string; addressPrefixes: string[] }>;
};

export function selectExtensionTier(value: unknown, recommended: Tier): Tier {
  return value === "low" || value === "balanced" || value === "ha" ? value : recommended;
}

/** 검증된 저장 결과와 그 사본만 투영한다. 최신 카탈로그/인벤토리 조회나 재계산은 하지 않는다. */
export function buildExtensionDisplay(result: ExtensionResult, core: ExtensionCoreData, inventory: ScanInventory): ExtensionDisplay {
  const missing = (): never => { throw Error("display-unavailable"); };
  const region = core.support.regions.find(r => r.id === result.input.region)?.label ?? missing();
  const componentIds = new Set(result.plans.flatMap(p => [...p.reusedResources, ...p.newItems, ...p.usageIncreases].map(i => i.componentId)));
  const components: ExtensionDisplay["components"] = Object.fromEntries([...componentIds].map(id => {
    const component = core.catalog.components.find(c => c.id === id) ?? missing();
    const regional = core.support.components.find(c => c.componentId === id)?.regions.find(r => r.regionId === result.input.region) ?? missing();
    return [id, { name: component.name, unitLabel: component.unitLabel, assumption: component.usage?.assumptionLabel ?? null,
      hourly: component.pricing.kind === "metered" && component.pricing.unitOfMeasure === "1 Hour", free: component.pricing.kind === "free",
      sources: regional.sources }];
  }));
  const references = Object.fromEntries(result.plans.map(plan => {
    const reference = core.catalog.architectures.find(r => r.id === plan.referenceArchitectureId) ?? missing();
    return [reference.id, { name: reference.name, sources: reference.sources }];
  }));
  const resourceIds = new Set(result.plans.flatMap(plan => [
    ...plan.reusedResources.map(r => r.resourceId), ...plan.checks.flatMap(c => [...c.resourceIds, ...c.evidence.map(e => e.resourceId)]),
  ]));
  const resources = Object.fromEntries([...resourceIds].map(id => {
    const resource = inventory.resources.find(r => r.id === id) ?? missing();
    const space = resource.type === "microsoft.network/virtualnetworks" ? resource.properties.addressSpace : null;
    const prefixes = space && typeof space === "object" && "addressPrefixes" in space ? space.addressPrefixes : [];
    return [id, { name: resource.name, type: resource.type,
      addressPrefixes: Array.isArray(prefixes) ? prefixes.filter((p): p is string => typeof p === "string") : [] }];
  }));
  return structuredClone({ result, priceAsOf: core.catalog.prices.asOf, region, components, references, resources });
}
