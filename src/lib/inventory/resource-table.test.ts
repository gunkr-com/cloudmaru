import { describe, expect, it } from "vitest";
import { ids, resource } from "./fixtures.test-data";
import type { ScanInventory } from "@/types/scan";
import { parseResourceTableQuery, queryInventoryResources, RESOURCE_TABLE_PAGE_SIZE } from "./resource-table";

const inventory: ScanInventory = {
  resources: [
    { ...resource(ids.vm), name: "app-Z", type: "b/type", tags: { env: "dev" } },
    { ...resource(ids.storage), name: "app-a", type: "a/type" },
    { ...resource(ids.nic), name: "App-A", type: "a/type", subscriptionId: "unknown" },
  ],
  containers: [{ id: "/subscriptions/sub", kind: "subscription", name: "Company", subscriptionId: resource(ids.vm).subscriptionId, location: null, tags: {} }],
  relations: [], skippedRows: 0,
};
const query = (params = {}) => parseResourceTableQuery(params);

describe("리소스 표 검색과 페이지", () => {
  it("uses first values, trims and limits search, and normalizes types", () => {
    expect(query({ q: ["  APP  ", "ignored"], type: ["B/TYPE", "a/type"], page: ["2", "3"] })).toEqual({ q: "APP", type: "b/type", page: 2 });
    expect(query({ q: " " + "x".repeat(220) + " " }).q).toHaveLength(200);
    expect(query()).toEqual({ q: "", type: null, page: 1 });
  });
  it.each(["0", "-3", "abc", "1.5", "Infinity", "", "2abc"])("defaults invalid page %s to one", page => {
    expect(query({ page }).page).toBe(1);
  });
  it("matches name and ID case insensitively and ignores unknown types", () => {
    expect(queryInventoryResources(inventory, query({ q: "APP-A" })).matched).toBe(2);
    expect(queryInventoryResources(inventory, query({ q: "STAPP" })).rows[0].id).toBe(ids.storage);
    expect(queryInventoryResources(inventory, query({ type: "missing/type" })).matched).toBe(3);
    expect(queryInventoryResources(inventory, query({ type: "B/TYPE", q: "app" })).matched).toBe(1);
    expect(queryInventoryResources(inventory, query({ type: "B/TYPE" })).appliedType).toBe("b/type");
    expect(queryInventoryResources(inventory, query({ type: "missing/type" })).appliedType).toBeNull();
    expect(queryInventoryResources(inventory, query()).appliedType).toBeNull();
  });
  it("sorts by code point type, name and ID without mutating the inventory", () => {
    const original = structuredClone(inventory);
    const result = queryInventoryResources(inventory, query());
    expect(result.rows.map(row => row.id)).toEqual([ids.nic, ids.storage, ids.vm]);
    const tied = { ...inventory, resources: inventory.resources.map(row => ({ ...row, type: "same/type", name: "same" })) };
    expect(queryInventoryResources(tied, query()).rows.map(row => row.id)).toEqual([ids.vm, ids.nic, ids.storage]);
    expect(inventory).toEqual(original);
    expect(result.types).toEqual([{ type: "a/type", count: 2 }, { type: "b/type", count: 1 }]);
    expect(queryInventoryResources(inventory, query({ q: "app-Z" })).types).toEqual(result.types);
  });
  it("returns display fields only, subscription names and tag counts", () => {
    const rows = queryInventoryResources(inventory, query()).rows;
    expect(rows[0].subscriptionName).toBeNull();
    expect(rows[2]).toEqual({ id: ids.vm, name: "app-Z", type: "b/type", resourceGroup: "rg-network", location: null, subscriptionId: resource(ids.vm).subscriptionId, subscriptionName: "Company", tagCount: 1 });
    expect(rows[2]).not.toHaveProperty("properties");
  });
  it("clamps pages and exposes one-based ranges and total before filtering", () => {
    const result = queryInventoryResources(inventory, query({ page: "999" }), 2);
    expect(result).toMatchObject({ total: 3, matched: 3, page: 2, pageCount: 2, from: 3, to: 3 });
    expect(result.rows).toHaveLength(1);
    expect(queryInventoryResources(inventory, query({ type: "a/type" }), 2)).toMatchObject({ total: 3, matched: 2, page: 1, pageCount: 1, from: 1, to: 2 });
    expect(RESOURCE_TABLE_PAGE_SIZE).toBe(50);
    const many = { ...inventory, resources: Array.from({ length: 51 }, (_, i) => ({ ...resource(ids.vm), id: String(i) })) };
    expect(queryInventoryResources(many, query()).rows).toHaveLength(50);
  });
  it("handles empty inventory and no matches", () => {
    for (const data of [inventory, { ...inventory, resources: [] }]) {
      expect(queryInventoryResources(data, query({ q: "nothing", page: "9" }))).toMatchObject({ rows: [], matched: 0, page: 1, pageCount: 1, from: 0, to: 0 });
    }
  });
});
