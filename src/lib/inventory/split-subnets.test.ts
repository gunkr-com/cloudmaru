import { describe, expect, it } from "vitest";
import { normalizeResourceRow } from "./normalize";
import { splitSubnets } from "./split-subnets";

const vnet = normalizeResourceRow({
  id: "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg-test/providers/Microsoft.Network/virtualNetworks/test",
  name: "TestVNet", type: "Microsoft.Network/virtualNetworks", location: "CanadaCentral",
  subscriptionId: "00000000-0000-0000-0000-000000000000", resourceGroup: "rg-test",
});

describe("서브넷 분리", () => {
  it("부모 바로 뒤에 서브넷을 추가하고 원래 순서와 속성을 보존한다", () => {
    const properties = { networkSecurityGroup: { id: "/Keep/Case" } };
    const parent = { ...vnet, properties: { subnets: [
      { id: `${vnet.id}/subnets/First/`, name: "First", properties },
      { name: "Second", properties: null },
    ] } };
    const other = { ...vnet, id: "/other", type: "microsoft.web/sites" };
    const input = Object.freeze([parent, other]);
    const before = structuredClone(input);
    const result = splitSubnets(input);
    expect(result.map((item) => item.id)).toEqual([vnet.id, `${vnet.id}/subnets/first`, `${vnet.id}/subnets/second`, "/other"]);
    expect(result[1]).toEqual({ ...vnet, id: `${vnet.id}/subnets/first`, name: "First",
      type: "microsoft.network/virtualnetworks/subnets", kind: null, sku: null, zones: [], managedBy: null,
      properties, parentId: vnet.id, tags: {}, observedFields: ["properties", "location"] });
    expect(result[2].properties).toEqual({});
    expect(result[0]).toBe(parent);
    expect(input).toEqual(before);
  });

  it("기존 서브넷과 중복 항목을 다시 추가하지 않고 재실행해도 같다", () => {
    const subnet = { ...vnet, id: `${vnet.id}/subnets/exists`, type: "microsoft.network/virtualnetworks/subnets" };
    const parent = { ...vnet, properties: { subnets: [
      { id: `${subnet.id.toUpperCase()}/`, name: "Exists" }, { name: "New" }, { name: "New" },
    ] } };
    const result = splitSubnets([parent, subnet]);
    expect(result.map((item) => item.id)).toEqual([vnet.id, `${vnet.id}/subnets/new`, subnet.id]);
    expect(splitSubnets(result)).toEqual(result);
  });

  it("합성 서브넷은 실제 제공된 속성과 관측된 부모 지역만 기록한다", () => {
    const parent = { ...vnet, properties: { subnets: [
      { name: "valid", properties: {} }, { name: "missing" }, { name: "invalid", properties: null },
    ] } };
    const result = splitSubnets([parent]);
    expect(result.slice(1).map(r => r.observedFields)).toEqual([["properties", "location"], ["location"], ["location"]]);
    const { observedFields: omitted, ...legacyParent } = parent;
    expect(omitted).toEqual(["location"]);
    const legacyResult = splitSubnets([legacyParent]);
    expect(legacyResult.slice(1).map(r => r.observedFields)).toEqual([["properties"], [], []]);
    expect(legacyResult[1].location).toBe(parent.location);
    const missingLocation = normalizeResourceRow({ id: vnet.id, name: vnet.name, type: vnet.type,
      subscriptionId: vnet.subscriptionId, resourceGroup: vnet.resourceGroup, properties: parent.properties });
    expect(splitSubnets([missingLocation])[1]).toMatchObject({ location: null, observedFields: ["properties"] });
  });

  it("이름 없는 항목과 잘못된 서브넷 목록은 건너뛴다", () => {
    const parent = { ...vnet, properties: { subnets: [null, [], {}, { id: "/test" }, { name: " " }, { name: 1 }] } };
    expect(splitSubnets([parent])).toEqual([parent]);
    expect(splitSubnets([vnet, { ...vnet, properties: { subnets: {} } }])).toHaveLength(2);
    expect(splitSubnets([])).toEqual([]);
  });
});
