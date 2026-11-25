import { describe, expect, it } from "vitest";
import { buildInventory } from "./build-inventory";
import { explicitNetworkResources, ids } from "./fixtures.test-data";
import { summarizeInventory } from "./summarize";

describe("인벤토리 조립", () => {
  const collectedAt = new Date("2026-11-05T12:00:00Z");
  it.each(["live", "import"] as const)("%s 출처와 주어진 수집 시각을 보존한다", (source) => {
    expect(buildInventory({ source, collectedAt, resourceRows: [], containerRows: [] })).toEqual({
      source, collectedAt: collectedAt.toISOString(), resources: [], containers: [], relations: [], skippedRows: 0,
      summary: summarizeInventory([], []),
    });
  });
  it("정규화 실패만 세고 ID 중복 제거 후 서브넷·관계·요약을 만든다", () => {
    const rows = explicitNetworkResources().filter((r) => r.id !== ids.subnet);
    const vnet = rows[0];
    const container = { id: "/subscriptions/TEST/", name: "First", type: "Microsoft.Resources/subscriptions", subscriptionId: "TEST" };
    const input = Object.freeze({ source: "import" as const, collectedAt,
      resourceRows: Object.freeze([null, ...rows, { ...vnet, id: vnet.id.toUpperCase() + "/", name: "Duplicate", properties: {} }, {}]),
      containerRows: Object.freeze([container, { ...container, id: "/subscriptions/test", name: "Duplicate" }, false]),
    });
    const before = structuredClone(input);
    const result = buildInventory(input);
    expect(result.skippedRows).toBe(3);
    expect(result.resources).toHaveLength(rows.length + 1);
    expect(result.resources[0].name).toBe(vnet.name);
    expect(result.resources[1]).toMatchObject({ id: ids.subnet, parentId: ids.vnet });
    expect(result.containers).toHaveLength(1);
    expect(result.containers[0]).toMatchObject({ id: "/subscriptions/test", name: "First" });
    expect(result.relations).toContainEqual({ sourceId: ids.vnet, targetId: ids.subnet, type: "connects_to", evidence: ["vnet.subnets[].id"] });
    expect(result.summary).toEqual(summarizeInventory(result.resources, result.containers));
    expect(result.summary.resourceCount).toBe(rows.length + 1);
    expect(buildInventory(input)).toEqual(result);
    expect(input).toEqual(before);
  });
});
