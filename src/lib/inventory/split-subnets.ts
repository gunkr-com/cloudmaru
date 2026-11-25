import type { InventoryResource } from "@/types/inventory";
import { canonicalId, normalizeResourceRow } from "./normalize";

export function splitSubnets(resources: readonly InventoryResource[]): InventoryResource[] {
  const seen = new Set(resources.map((resource) => canonicalId(resource.id)));
  const result: InventoryResource[] = [];

  for (const resource of resources) {
    result.push(resource);
    if (resource.type !== "microsoft.network/virtualnetworks" || !Array.isArray(resource.properties.subnets)) continue;

    for (const subnet of resource.properties.subnets) {
      if (!subnet || typeof subnet !== "object" || Array.isArray(subnet)
        || typeof subnet.name !== "string" || !subnet.name.trim()) continue;

      const id = canonicalId(typeof subnet.id === "string" && subnet.id.trim()
        ? subnet.id : `${resource.id}/subnets/${subnet.name}`);
      if (seen.has(id)) continue;
      seen.add(id);
      result.push({
        ...normalizeResourceRow({
          id,
          name: subnet.name,
          type: "microsoft.network/virtualnetworks/subnets",
          ...(resource.observedFields?.includes("location") ? { location: resource.location } : {}),
          subscriptionId: resource.subscriptionId,
          resourceGroup: resource.resourceGroup,
          properties: subnet.properties,
        }),
        // 지역 표시는 기존처럼 상속하되 구형 부모의 기본값을 관측으로 승격하지 않는다.
        location: resource.location,
        parentId: resource.id,
      });
    }
  }

  return result;
}
