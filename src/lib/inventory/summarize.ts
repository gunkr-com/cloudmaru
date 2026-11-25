import type { InventoryContainer, InventoryResource, InventorySummary } from "@/types/inventory";
import { classifyResourceType } from "./classify";

export type { InventorySummary } from "@/types/inventory";

function count(values: readonly string[]): Record<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return Object.fromEntries(counts);
}

export function summarizeInventory(resources: readonly InventoryResource[], containers: readonly InventoryContainer[]): InventorySummary {
  return {
    resourceCount: resources.length,
    resourceGroupCount: new Set([
      ...resources.map(resource => JSON.stringify([resource.subscriptionId.toLowerCase(), resource.resourceGroup.toLowerCase()])),
      ...containers.filter(container => container.kind === "resourceGroup")
        .map(container => JSON.stringify([container.subscriptionId.toLowerCase(), container.name.toLowerCase()])),
    ]).size,
    subscriptionIds: [...new Set([...resources, ...containers].map((item) => item.subscriptionId))].sort(),
    byType: count(resources.map((resource) => resource.type)),
    byLocation: count(resources.map((resource) => resource.location ?? "global")),
    byResourceGroup: count(resources.map((resource) => resource.resourceGroup)),
    byFamily: count(resources.map((resource) => classifyResourceType(resource.type).family)),
    untaggedCount: resources.filter((resource) => resource.parentId === null && Object.keys(resource.tags).length === 0).length,
  };
}
