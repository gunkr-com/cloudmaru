import { describe, expect, it } from "vitest";
import { summarizeInventory } from "./summarize";
import { normalizeContainerRow } from "./normalize";
import { ids, resource } from "./fixtures.test-data";

describe("인벤토리 요약", () => {
  it("빈 인벤토리를 요약한다", () => {
    expect(summarizeInventory([], [])).toEqual({ resourceCount: 0, resourceGroupCount: 0, subscriptionIds: [], byType: {}, byLocation: {}, byResourceGroup: {}, byFamily: {}, untaggedCount: 0 });
  });
  it("서브넷을 집계하되 태그 누락에서 제외하고 빈 구독도 포함한다", () => {
    const resources = Object.freeze([
      { ...resource(ids.vnet), location: "canadacentral", tags: { owner: "gun" } },
      { ...resource(ids.subnet), location: "canadacentral", parentId: ids.vnet },
      resource(ids.vm),
      { ...resource(ids.vm + "2"), subscriptionId: "sub-b", resourceGroup: "rg-b" },
    ]);
    const containers = [normalizeContainerRow({ id: "/subscriptions/sub-c", name: "Empty", type: "microsoft.resources/subscriptions", subscriptionId: "sub-c" })];
    const before = structuredClone({ resources, containers });
    expect(summarizeInventory(resources, containers)).toEqual({
      resourceCount: 4, resourceGroupCount: 2, subscriptionIds: [resources[0].subscriptionId, "sub-b", "sub-c"],
      byType: { "microsoft.network/virtualnetworks": 1, "microsoft.network/virtualnetworks/subnets": 1, "microsoft.compute/virtualmachines": 2 },
      byLocation: { canadacentral: 2, global: 2 }, byResourceGroup: { "rg-network": 3, "rg-b": 1 },
      byFamily: { network: 2, compute: 2 }, untaggedCount: 2,
    });
    expect({ resources, containers }).toEqual(before);
  });
  it("구독 ID는 중복 없이 정렬하고 임의의 집계 키도 안전하게 처리한다", () => {
    const item = { ...resource(ids.vm), resourceGroup: "__proto__", subscriptionId: "z" };
    expect(summarizeInventory([item, { ...item, subscriptionId: "a" }, item], [])).toMatchObject({
      subscriptionIds: ["a", "z"], byResourceGroup: JSON.parse('{"__proto__":3}'),
    });
  });
});

it("구독별 동명 그룹과 빈 그룹을 대소문자 중복 없이 센다", () => {
  const item = { ...resource(ids.vm), subscriptionId: "sub-a", resourceGroup: "RG-App" };
  const containers = [
    { id: "/subscriptions/sub-a/resourceGroups/rg-app", kind: "resourceGroup" as const, name: "rg-app", subscriptionId: "SUB-A", location: null, tags: {} },
    { id: "/subscriptions/sub-a/resourceGroups/empty", kind: "resourceGroup" as const, name: "empty", subscriptionId: "sub-a", location: null, tags: {} },
    { id: "/subscriptions/sub-c", kind: "subscription" as const, name: "sub-c", subscriptionId: "sub-c", location: null, tags: {} },
  ];
  expect(summarizeInventory([item, { ...item, subscriptionId: "sub-b" }], containers).resourceGroupCount).toBe(3);
});
