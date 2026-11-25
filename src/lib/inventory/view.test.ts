import { describe, expect, it } from "vitest";
import { ids, resource } from "./fixtures.test-data";
import { summarizeInventory } from "./summarize";
import { familiesByStage, inventoryFacts, unreadSubscriptions } from "./view";

describe("인벤토리 화면 요약", () => {
  it("빈 요약과 목록을 처리한다", () => {
    const summary = summarizeInventory([], []);
    expect(inventoryFacts(summary)).toEqual({ resources: 0, subscriptions: 0, resourceGroups: 0, regions: 0, untagged: 0 });
    expect(unreadSubscriptions([], summary)).toEqual([]);
    expect(familiesByStage([])).toEqual([]);
  });
  it("그룹과 지역은 리소스 합계가 아닌 키 수를 센다", () => {
    const summary = Object.freeze({ resourceCount: 12, subscriptionIds: ["sub-a", "sub-b"], byType: {}, byLocation: { global: 8, canadacentral: 4 }, byResourceGroup: { first: 6, second: 6 }, byFamily: {}, untaggedCount: 5 });
    expect(inventoryFacts(summary)).toEqual({ resources: 12, subscriptions: 2, resourceGroups: 2, regions: 2, untagged: 5 });
  });
  it("구독은 대소문자를 무시하고 요청 순서와 표기를 유지한다", () => {
    const requested = Object.freeze(["Sub-Z", "SUB-A", "sub-b", "Sub-C"]);
    const summary = summarizeInventory([], []);
    summary.subscriptionIds = ["sub-a", "SUB-C"];
    expect(unreadSubscriptions(requested, summary)).toEqual(["Sub-Z", "sub-b"]);
    expect(summary.subscriptionIds).toEqual(["sub-a", "SUB-C"]);
    expect(requested).toEqual(["Sub-Z", "SUB-A", "sub-b", "Sub-C"]);
  });
  it("단계 순서, 계열 수 내림차순과 동률 이름순으로 분류하며 원본을 바꾸지 않는다", () => {
    const types = ["unknown/type", "microsoft.web/sites", "microsoft.compute/virtualmachines", "microsoft.databricks/workspaces", "microsoft.network/virtualnetworks", "microsoft.storage/storageaccounts", "microsoft.web/staticsites", "microsoft.datafactory/factories", "microsoft.app/containerapps", "microsoft.compute/virtualmachines", "microsoft.keyvault/vaults", "microsoft.network/networkinterfaces"];
    const resources = Object.freeze(types.map(type => ({ ...resource(ids.vm), type })));
    const before = structuredClone(resources);
    expect(familiesByStage(resources)).toEqual([
      { stage: "source", families: [{ family: "static-web", count: 1 }] },
      { stage: "ingest", families: [{ family: "data-factory", count: 1 }] },
      { stage: "process", families: [{ family: "compute", count: 2 }, { family: "container-compute", count: 1 }, { family: "databricks", count: 1 }] },
      { stage: "store", families: [{ family: "storage", count: 1 }] },
      { stage: "serve", families: [{ family: "web-app", count: 1 }] },
      { stage: "infra", families: [{ family: "network", count: 2 }, { family: "key-vault", count: 1 }] },
      { stage: "unclassified", families: [{ family: "other", count: 1 }] },
    ]);
    expect(resources).toEqual(before);
    expect(familiesByStage([resource(ids.vm)])).toEqual([{ stage: "process", families: [{ family: "compute", count: 1 }] }]);
  });
});

it("새 그룹 수를 우선 사용하고 옛 요약은 그룹 키 수로 표시한다", () => {
  const summary = { ...summarizeInventory([], []), byResourceGroup: { "rg-app": 4 } };
  expect(inventoryFacts({ ...summary, resourceGroupCount: 3 }).resourceGroups).toBe(3);
  expect(inventoryFacts({ ...summary, resourceGroupCount: 0 }).resourceGroups).toBe(0);
  const { resourceGroupCount: omitted, ...legacy } = summary;
  expect(omitted).toBe(0);
  expect(inventoryFacts(legacy).resourceGroups).toBe(1);
});
