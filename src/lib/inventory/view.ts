import type { InventoryFacts, InventoryResource, InventoryStageFamilies, InventorySummary } from "@/types/inventory";
import { classifyResourceType, STAGE_ORDER, type ResourceFamily, type ResourceStage } from "./classify";

export function inventoryFacts(summary: InventorySummary): InventoryFacts {
  return {
    resources: summary.resourceCount,
    subscriptions: summary.subscriptionIds.length,
    resourceGroups: typeof summary.resourceGroupCount === "number" ? summary.resourceGroupCount : Object.keys(summary.byResourceGroup).length,
    regions: Object.keys(summary.byLocation).length,
    untagged: summary.untaggedCount,
  };
}

export function unreadSubscriptions(requested: readonly string[], summary: InventorySummary): string[] {
  const read = new Set(summary.subscriptionIds.map(id => id.toLowerCase()));
  return requested.filter(id => !read.has(id.toLowerCase()));
}

export function familiesByStage(resources: readonly InventoryResource[]): InventoryStageFamilies[] {
  const stages = new Map<ResourceStage, Map<ResourceFamily, number>>();
  for (const resource of resources) {
    const { stage, family } = classifyResourceType(resource.type);
    const families = stages.get(stage) ?? new Map<ResourceFamily, number>();
    families.set(family, (families.get(family) ?? 0) + 1);
    stages.set(stage, families);
  }
  return STAGE_ORDER.flatMap(stage => {
    const counts = stages.get(stage);
    if (!counts) return [];
    const families = [...counts].map(([family, count]) => ({ family, count }))
      .sort((a, b) => b.count - a.count || a.family.localeCompare(b.family));
    return [{ stage, families }];
  });
}
