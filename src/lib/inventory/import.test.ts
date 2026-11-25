import { describe, expect, it } from "vitest";
import { parseImportedInventory } from "./import";

describe("인벤토리 파일 형식 검증", () => {
  it("명시적인 resources/containers 묶음은 행 검증 없이 보존한다", () => {
    const rows = { resources: [null, { type: "test" }], containers: [{}] };
    expect(parseImportedInventory(rows)).toEqual({ ok: true, rows });
    expect(parseImportedInventory({ resources: [], containers: [] })).toEqual({ ok: true, rows: { resources: [], containers: [] } });
  });

  it.each(["array", "data"])("%s 형식은 type으로 컨테이너를 분리한다", (format) => {
    const resources = [{ type: "Microsoft.Network/virtualNetworks" }, null, { type: 1 }];
    const containers = [{ type: "Microsoft.Resources/subscriptions" }, { type: "MICROSOFT.RESOURCES/SUBSCRIPTIONS/RESOURCEGROUPS" }];
    const data = [resources[0], containers[0], resources[1], containers[1], resources[2]];
    expect(parseImportedInventory(format === "data" ? { data } : data)).toEqual({ ok: true, rows: { resources, containers } });
  });

  it.each([null, 1, "{}", {}, { data: {} }, { resources: [] }, { resources: [], containers: null }])("잘못된 최상위 형식을 거부한다: %s", (input) => {
    const result = parseImportedInventory(input);
    expect(result.ok).toBe(false);
    expect(result).toEqual({ ok: false, code: "import-invalid" });
  });

  it("모든 형식에서 합계 50,000행까지 허용하고 초과는 거부한다", () => {
    const rows = Array.from({ length: 50_000 }, () => ({}));
    expect(parseImportedInventory(rows).ok).toBe(true);
    expect(parseImportedInventory({ data: rows }).ok).toBe(true);
    expect(parseImportedInventory({ resources: rows, containers: [] }).ok).toBe(true);
    expect(parseImportedInventory([...rows, {}])).toEqual({ ok: false, code: "import-too-many-rows" });
    expect(parseImportedInventory({ data: [...rows, {}] })).toEqual({ ok: false, code: "import-too-many-rows" });
    expect(parseImportedInventory({ resources: rows, containers: [{}] })).toEqual({ ok: false, code: "import-too-many-rows" });
  });
});
