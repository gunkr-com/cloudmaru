import { describe, expect, it } from "vitest";
import { canonicalId, InventoryParseError, normalizeContainerRow, normalizeResourceRow } from "./normalize";

const subscriptionId = "00000000-0000-0000-0000-000000000000";
const row = {
  id: `/Subscriptions/${subscriptionId}/ResourceGroups/RG-Test/Providers/Microsoft.Network/virtualNetworks/VNet-Test/`,
  name: "VNet-Test", type: "Microsoft.Network/virtualNetworks", subscriptionId, resourceGroup: "RG-Test",
};

describe("인벤토리 정규화", () => {
  it("ID의 공백, 대소문자, 끝 슬래시를 정규화한다", () => {
    expect(canonicalId(" /Subscriptions/TEST/// ")).toBe("/subscriptions/test");
  });

  it("식별 필드만 정규화하고 속성과 이름을 보존한다", () => {
    const properties = { subnet: { id: "/Keep/Case/" }, value: [1, null] };
    const sku = { name: "TestSku" };
    expect(normalizeResourceRow({ ...row, location: "CanadaCentral", kind: "TestKind", sku,
      tags: { Keep: "Value", number: 1, flag: true, nil: null }, zones: ["1", 2, "3"],
      managedBy: "/Subscriptions/TEST/", properties })).toEqual({
      ...row, id: canonicalId(row.id), type: row.type.toLowerCase(), resourceGroup: "rg-test",
      location: "canadacentral", kind: "TestKind", sku, tags: { Keep: "Value" }, zones: ["1", "3"],
      managedBy: "/subscriptions/test", properties, parentId: null,
      // 부분적으로만 복구한 tags/zones는 완전한 관측으로 표시하지 않는다.
      observedFields: ["managedBy", "sku", "properties", "location", "kind"],
    });
    expect(normalizeResourceRow({ ...row, properties }).properties).toBe(properties);
  });

  it("선택 필드의 잘못된 값과 누락은 기본값으로 처리한다", () => {
    expect(normalizeResourceRow({ ...row, sku: [], properties: [], tags: [], zones: "1", kind: 2, location: 2, managedBy: 2 }))
      .toMatchObject({ sku: null, properties: {}, tags: {}, zones: [], kind: null, location: null, managedBy: null, parentId: null });
    expect(normalizeResourceRow(row)).toMatchObject({ sku: null, properties: {}, tags: {}, zones: [] });
  });

  it("명시적으로 제공한 유효한 필드만 기록하고 빈 값과 nullable 값을 보존한다", () => {
    const fields = ["tags", "zones", "managedBy", "sku", "properties", "location", "kind"];
    for (const values of [
      { tags: {}, zones: [], managedBy: "", sku: {}, properties: {}, location: "", kind: "" },
      { tags: null, zones: null, managedBy: null, sku: null, properties: {}, location: null, kind: null },
      { tags: { owner: "fixture" }, zones: ["1"], managedBy: "/Owner", sku: { name: "fixture" },
        properties: { enabled: false }, location: "CanadaCentral", kind: "app" },
    ]) {
      expect(normalizeResourceRow({ ...row, ...values })).toHaveProperty("observedFields", fields);
    }
    expect(normalizeResourceRow(row)).toHaveProperty("observedFields", []);
    expect(normalizeResourceRow({ ...row, observedFields: fields })).toHaveProperty("observedFields", []);
  });

  it.each([
    ["tags", [{ a: 1 }, { a: "valid", b: null }, [], "tags", 1, undefined]],
    ["zones", [["1", 2], {}, "1", 1, undefined]],
    ["managedBy", [1, false, {}, [], undefined]],
    ["sku", [1, false, "sku", [], undefined]],
    ["properties", [null, 1, false, "properties", [], undefined]],
    ["location", [1, false, {}, [], undefined]],
    ["kind", [1, false, {}, [], undefined]],
  ])("%s의 누락·잘못된 타입은 기본값을 관측한 것으로 만들지 않는다", (field, values) => {
    for (const value of values) {
      expect(normalizeResourceRow({ ...row, [field]: value })).toHaveProperty("observedFields", []);
    }
  });

  for (const field of ["id", "name", "type", "subscriptionId", "resourceGroup"]) {
    it.each([undefined, null, 1, "", "  "])(`${field} 필수 문자열 검증: %s`, (value) => {
      expect(() => normalizeResourceRow({ ...row, [field]: value })).toThrow(InventoryParseError);
    });
  }

  it.each([null, [], "text", 1])("객체가 아닌 행을 거부한다: %s", (value) => {
    expect(() => normalizeResourceRow(value)).toThrow(InventoryParseError);
    expect(() => normalizeContainerRow(value)).toThrow(InventoryParseError);
  });

  it.each([
    ["Microsoft.Resources/subscriptions", "subscription"],
    ["Microsoft.Resources/subscriptions/resourceGroups", "resourceGroup"],
  ])("컨테이너 종류 %s를 구분한다", (type, kind) => {
    expect(normalizeContainerRow({ id: " /Subscriptions/TEST/ ", name: "Test", type,
      subscriptionId: "TEST", location: "CanadaEast", tags: { test: "yes", ignored: 1 } })).toEqual({
      id: "/subscriptions/test", name: "Test", kind, subscriptionId: "test", location: "canadaeast", tags: { test: "yes" },
    });
  });

  it("컨테이너 필수 필드와 지원하지 않는 타입을 검증한다", () => {
    const container = { id: `/subscriptions/${subscriptionId}`, name: "Test", subscriptionId, type: "microsoft.resources/subscriptions" };
    expect(normalizeContainerRow(container)).toMatchObject({ location: null, tags: {} });
    for (const field of ["id", "name", "type", "subscriptionId"]) {
      expect(() => normalizeContainerRow({ ...container, [field]: undefined })).toThrow(InventoryParseError);
    }
    expect(() => normalizeContainerRow(row)).toThrow(InventoryParseError);
  });
});
