import { expect, it } from "vitest";
import { RowParseError } from "@/lib/db/pg-rows";
import { buildInventory } from "@/lib/inventory/build-inventory";
import { parseScanInventory, parseScanRow } from "./rows";

const inventory = buildInventory({ source: "import", collectedAt: new Date("2026-01-01Z"), resourceRows: [{ id: "/subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/rg/providers/Microsoft.Storage/storageAccounts/fake", name: "fake", type: "Microsoft.Storage/storageAccounts", subscriptionId: "00000000-0000-0000-0000-000000000001", resourceGroup: "rg", properties: {} }], containerRows: [] });
const row = { id: "00000000-0000-0000-0000-000000000001", workspace_id: "00000000-0000-0000-0000-000000000002", source: "live", status: "pending", subscription_ids: [], summary: null, collected_at: null, error_code: null, created_at: new Date("2026-01-01Z"), completed_at: null };
it("parses ISO timestamps, summaries and unknown error codes", () => {
  expect(parseScanRow(row)).toMatchObject({ createdAt: "2026-01-01T00:00:00.000Z", errorCode: null, summary: null });
  expect(parseScanRow({ ...row, source: "import", status: "succeeded", summary: inventory.summary, collected_at: "2026-01-01T01:00:00+01:00", completed_at: row.created_at, error_code: "future" })).toMatchObject({ summary: inventory.summary, collectedAt: "2026-01-01T00:00:00.000Z", errorCode: "internal" });
  expect(parseScanInventory(inventory)).toEqual({ resources: inventory.resources, containers: [], relations: [], skippedRows: 0 });
});
it("rejects malformed rows, summaries, nested inventory and timestamps", () => {
  for (const bad of [null, {}, { ...row, status: "other" }, { ...row, source: "other" }, { ...row, subscription_ids: [1] }, { ...row, created_at: new Date(NaN) }, { ...row, completed_at: "bad" }, { ...row, summary: {} }, { ...row, summary: { ...inventory.summary, byType: { bad: -1 } } }]) expect(() => parseScanRow(bad)).toThrow(RowParseError);
  for (const bad of [null, {}, { ...inventory, skippedRows: -1 }, { ...inventory, resources: [{}] }, { ...inventory, containers: [{}] }, { ...inventory, relations: [{ sourceId: "a", targetId: "b", type: "guess", evidence: [] }] }]) expect(() => parseScanInventory(bad)).toThrow(RowParseError);
});

it("새 그룹 수와 필드가 없는 옛 요약을 읽고 잘못된 수는 거절한다", () => {
  const { resourceGroupCount: omitted, ...legacy } = inventory.summary;
  expect(omitted).toBe(1);
  expect(parseScanRow({ ...row, summary: legacy }).summary).toEqual(legacy);
  expect(parseScanRow({ ...row, summary: { ...legacy, resourceGroupCount: 3 } }).summary).toHaveProperty("resourceGroupCount", 3);
  for (const resourceGroupCount of [-1, 1.5, "3"]) {
    expect(() => parseScanRow({ ...row, summary: { ...legacy, resourceGroupCount } })).toThrow(RowParseError);
  }
});

it("검증된 존재 정보는 저장 왕복 시 보존하며 구형 기본값에서 추정하지 않는다", () => {
  for (const observedFields of [[], ["tags", "zones", "managedBy", "sku", "properties", "location", "kind"]]) {
    const resources = [{ ...inventory.resources[0], observedFields }];
    expect(parseScanInventory(JSON.parse(JSON.stringify({ ...inventory, resources }))).resources).toEqual(resources);
  }
  const { observedFields: omitted, ...legacy } = { ...inventory.resources[0], observedFields: ["properties"] };
  expect(omitted).toEqual(["properties"]);
  const parsed = parseScanInventory({ ...inventory, resources: [legacy] }).resources[0];
  expect(parsed).toEqual(legacy);
  expect(parsed).not.toHaveProperty("observedFields");
});

it.each([null, "tags", {}, [1], [null], ["Tags"], ["parentId"], ["unknown"], ["tags", "tags"]]
  .map(observedFields => ({ observedFields })))(
  "잘못된·중복·허용 목록 밖 필드 존재 정보를 거절한다: $observedFields", ({ observedFields }) => {
    expect(() => parseScanInventory({ ...inventory, resources: [{ ...inventory.resources[0], observedFields }] }))
      .toThrow(RowParseError);
  },
);

it("reads saved App Service plan links alongside the older relation types", () => {
  const relations = (["connects_to", "secures", "routes", "hosts"] as const).map(type => ({ sourceId: "a", targetId: "b", type, evidence: ["site.serverFarmId"] }));
  expect(parseScanInventory({ ...inventory, relations }).relations).toEqual(relations);
});
