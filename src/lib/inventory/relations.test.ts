import { describe, expect, it } from "vitest";
import type { InventoryResource, RelationType } from "@/types/inventory";
import { explicitNetworkResources, ids, resource } from "./fixtures.test-data";
import { splitSubnets } from "./split-subnets";
import { buildExplicitRelations } from "./relations";

const cases: [keyof typeof ids, keyof typeof ids, RelationType, string[]][] = [
  ["vnet", "subnet", "connects_to", ["vnet.subnets[].id"]],
  ["vnet", "peer", "connects_to", ["vnet.virtualNetworkPeerings[].remoteVirtualNetwork.id"]],
  ["nsg", "subnet", "secures", ["subnet.networkSecurityGroup.id", "nsg.subnets[].id"]],
  ["nsg", "nic", "secures", ["nsg.networkInterfaces[].id", "networkInterface.networkSecurityGroup.id"]],
  ["rt", "subnet", "routes", ["subnet.routeTable.id", "routeTable.subnets[].id"]],
  ["subnet", "nic", "connects_to", ["networkInterface.ipConfigurations[].subnet.id"]],
  ["pip", "nic", "connects_to", ["publicIPAddress.ipConfiguration.id", "networkInterface.ipConfigurations[].publicIPAddress.id"]],
  ["nic", "vm", "connects_to", ["vm.networkProfile.networkInterfaces[].id"]],
  ["lb", "nic", "connects_to", ["backendAddressPools[].backendIPConfigurations[].id"]],
  ["subnet", "lb", "connects_to", ["frontendIPConfigurations[].subnet.id"]],
  ["pip", "lb", "connects_to", ["frontendIPConfigurations[].publicIPAddress.id"]],
  ["appgw", "nic", "connects_to", ["backendAddressPools[].backendIPConfigurations[].id"]],
  ["subnet", "appgw", "connects_to", ["frontendIPConfigurations[].subnet.id"]],
  ["pip", "appgw", "connects_to", ["frontendIPConfigurations[].publicIPAddress.id"]],
  ["subnet", "pep", "connects_to", ["privateEndpoint.subnet.id"]],
  ["pep", "storage", "connects_to", ["privateEndpoint.privateLinkServiceConnections[].privateLinkServiceId"]],
];

describe("명시적 ARM 관계", () => {
  it.each(cases)("%s → %s (%s)의 방향과 evidence를 보존한다", (source, target, type, evidence) => {
    const relations = buildExplicitRelations(explicitNetworkResources());
    expect(relations).toHaveLength(cases.length);
    const relation = relations.find((r) => r.sourceId === ids[source] && r.targetId === ids[target] && r.type === type);
    expect(relation).toEqual({ sourceId: ids[source], targetId: ids[target], type, evidence: expect.any(Array) });
    expect(relation!.evidence.toSorted()).toEqual(evidence.toSorted());
  });

  it("대상이 없으면 관계를 만들지 않고 이름이나 그룹으로 추정하지 않는다", () => {
    expect(buildExplicitRelations([
      resource(ids.nic, { ipConfigurations: [{ properties: { subnet: { id: ids.subnet } } }] }),
      resource(ids.vm), resource(ids.nsg), resource(ids.rt),
    ])).toEqual([]);
    expect(buildExplicitRelations([])).toEqual([]);
  });

  it("서브넷 참조는 VNet으로 축약하지 않고 분리된 레코드에 연결한다", () => {
    const vnet = resource(ids.vnet, { subnets: [{ id: ids.subnet, name: "snet-app" }] });
    const nic = resource(ids.nic, { ipConfigurations: [{ properties: { subnet: { id: ids.subnet } } }] });
    expect(buildExplicitRelations([vnet, nic])).toEqual([]);
    expect(buildExplicitRelations(splitSubnets([vnet, nic]))).toEqual([
      { sourceId: ids.vnet, targetId: ids.subnet, type: "connects_to", evidence: ["vnet.subnets[].id"] },
      { sourceId: ids.subnet, targetId: ids.nic, type: "connects_to", evidence: ["networkInterface.ipConfigurations[].subnet.id"] },
    ]);
  });

  // 가져오기 파일에서 서브넷 id가 빠져도 splitSubnets는 `<vnet>/subnets/<name>` 레코드를 만든다. 관계도 같은 ID로 잇는다.
  it("id 없는 서브넷도 splitSubnets와 같은 ID로 VNet에 연결한다", () => {
    const vnet = resource(ids.vnet, { subnets: [{ name: "snet-app" }, { name: "  " }, {}] });
    expect(buildExplicitRelations(splitSubnets([vnet]))).toEqual([
      { sourceId: ids.vnet, targetId: `${ids.vnet}/subnets/snet-app`, type: "connects_to", evidence: ["vnet.subnets[].id"] },
    ]);
  });

  it.each(["ipConfigurations", "backendAddressPools", "frontendIPConfigurations", "privateEndpointConnections"])(
    "%s 하위 ID는 부모에 연결하고 대소문자와 끝 슬래시를 무시한다", (segment) => {
      const pip = resource(ids.pip, { ipConfiguration: `${ids.nic.toUpperCase()}/${segment}/child/` });
      expect(buildExplicitRelations([pip, resource(ids.nic)])).toEqual([
        { sourceId: ids.pip, targetId: ids.nic, type: "connects_to", evidence: ["publicIPAddress.ipConfiguration.id"] },
      ]);
    },
  );

  it("하위 레코드가 실제로 있으면 부모보다 먼저 찾는다", () => {
    const child = resource(`${ids.nic}/ipconfigurations/child`);
    const pip = resource(ids.pip, { ipConfiguration: { id: child.id } });
    expect(buildExplicitRelations([pip, resource(ids.nic), child])[0].targetId).toBe(child.id);
  });

  it("자기 참조와 중복 evidence를 제거하고 관계 type은 구분한다", () => {
    const nsg = resource(ids.nsg, { networkInterfaces: [{ id: ids.nic }, { id: ids.nic }, { id: ids.nsg }] });
    const pip = { ...resource(ids.nsg, { ipConfiguration: ids.nic }), type: "microsoft.network/publicipaddresses" };
    expect(buildExplicitRelations([nsg, pip, resource(ids.nic)])).toEqual([
      { sourceId: ids.nsg, targetId: ids.nic, type: "secures", evidence: ["nsg.networkInterfaces[].id"] },
      { sourceId: ids.nsg, targetId: ids.nic, type: "connects_to", evidence: ["publicIPAddress.ipConfiguration.id"] },
    ]);
  });

  it("누락되거나 잘못된 중첩 속성을 건너뛴다", () => {
    const resources = explicitNetworkResources().map((r) => ({ ...r, properties: {
      networkProfile: [], networkInterfaces: [null, [], { id: 1 }],
      networkSecurityGroup: { id: false }, subnets: {}, ipConfigurations: [null, { properties: [] }],
      virtualNetworkPeerings: [null, {}], privateLinkServiceConnections: [{ properties: null }],
      backendAddressPools: [{ properties: { backendIPConfigurations: [null, { id: {} }] } }],
      frontendIPConfigurations: [{ properties: null }],
    } }));
    expect(buildExplicitRelations(resources)).toEqual([]);
    expect(buildExplicitRelations(resources.map((r) => ({ ...r, properties: undefined })) as unknown as InventoryResource[])).toEqual([]);
  });

  it("입력을 변경하지 않고 매번 독립적인 동일 결과를 만든다", () => {
    const resources = Object.freeze(explicitNetworkResources());
    const before = structuredClone(resources);
    const first = buildExplicitRelations(resources);
    const second = buildExplicitRelations(resources);
    expect(first).toEqual(second);
    first[0].evidence.push("changed");
    expect(buildExplicitRelations(resources)).toEqual(second);
    expect(resources).toEqual(before);
  });
});

describe("App Service plan references", () => {
  const base = "/subscriptions/00000000-0000-0000-0000-000000000001/resourcegroups/rg-web/providers";
  const plan = `${base}/microsoft.web/serverfarms/plan-web`;
  const app = `${base}/microsoft.web/sites/app-web`;
  it("links a web app to its plan when both ends are in the saved scan", () => {
    expect(buildExplicitRelations([resource(plan), resource(app, { serverFarmId: plan.toUpperCase() })])).toEqual([
      { sourceId: plan, targetId: app, type: "hosts", evidence: ["site.serverFarmId"] },
    ]);
  });
  it("draws no link when the referenced plan is missing from the scan", () => {
    expect(buildExplicitRelations([resource(app, { serverFarmId: plan })])).toEqual([]);
    expect(buildExplicitRelations([resource(plan), resource(app, { serverFarmId: "" })])).toEqual([]);
  });
  it("requires the exact saved App Service plan, not another type, a child path or a malformed value", () => {
    const storage = `${base}/microsoft.storage/storageaccounts/stweb`;
    for (const serverFarmId of [storage, `${plan}/privateendpointconnections/x`, { id: plan }, 42, ["x"], null]) {
      expect(buildExplicitRelations([resource(plan), resource(storage), resource(app, { serverFarmId })])).toEqual([]);
    }
    const mislabeled = { ...resource(plan), type: "microsoft.storage/storageaccounts" };
    expect(buildExplicitRelations([mislabeled, resource(app, { serverFarmId: plan })])).toEqual([]);
  });
});
