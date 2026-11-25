import { describe, expect, it } from "vitest";
import { CONTAINERS_QUERY, RESOURCES_QUERY } from "./arg-query";

describe("Resource Graph 쿼리", () => {
  it("리소스 필드와 안정적인 ID 정렬을 포함한다", () => {
    expect(RESOURCES_QUERY).toBe(`resources
| project id, name, type, kind, location, resourceGroup, subscriptionId, sku, tags, zones, managedBy, properties
| order by id asc`);
  });

  it("구독과 리소스 그룹만 조회하고 ID로 정렬한다", () => {
    expect(CONTAINERS_QUERY).toBe(`resourcecontainers
| where type in~ ('microsoft.resources/subscriptions', 'microsoft.resources/subscriptions/resourcegroups')
| project id, name, type, location, subscriptionId, resourceGroup, tags
| order by id asc`);
  });
});
