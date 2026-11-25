import type { InventoryRelation, InventoryResource, RelationType } from "@/types/inventory";
import { canonicalId } from "./normalize";

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

function objects(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item) => item !== null && typeof item === "object" && !Array.isArray(item)) : [];
}

function idFromRef(value: unknown): string | null {
  const id = typeof value === "string" ? value : object(value).id;
  return typeof id === "string" && id.trim() ? canonicalId(id) : null;
}

/** ADR-020: 이름 추정 없이 현재 인벤토리의 ARM 참조만 연결한다. */
export function buildExplicitRelations(resources: readonly InventoryResource[]): InventoryRelation[] {
  const resourceIds = new Map(resources.map((resource) => [canonicalId(resource.id), resource.id]));
  const relations = new Map<string, InventoryRelation>();
  // 타입을 확인해야 하는 참조(App Service plan)는 하위 경로를 부모로 바꾸지 않고 정확한 저장 레코드만 쓴다.
  const resourceTypes = new Map(resources.map((resource) => [canonicalId(resource.id), resource.type.trim().toLowerCase()]));

  function resolve(value: unknown): string | undefined {
    const id = idFromRef(value);
    if (!id) return undefined;
    const exact = resourceIds.get(id);
    if (exact) return exact;
    // CloudSight는 서브넷을 별도 레코드로 보존한다. 누락된 서브넷을 VNet으로 대체하지 않는다.
    const parts = id.split("/");
    const childIndex = parts.findIndex((part) => [
      "subnets", "ipconfigurations", "backendaddresspools", "frontendipconfigurations", "privateendpointconnections",
    ].includes(part));
    if (childIndex < 0 || parts[childIndex] === "subnets") return undefined;
    return resourceIds.get(parts.slice(0, childIndex).join("/"));
  }

  function add(source: unknown, target: unknown, type: RelationType, evidence: string): void {
    const sourceId = resolve(source);
    const targetId = resolve(target);
    if (!sourceId || !targetId || canonicalId(sourceId) === canonicalId(targetId)) return;
    const key = JSON.stringify([sourceId, targetId, type]);
    const existing = relations.get(key);
    if (existing) {
      if (!existing.evidence.includes(evidence)) existing.evidence.push(evidence);
    } else {
      relations.set(key, { sourceId, targetId, type, evidence: [evidence] });
    }
  }

  for (const resource of resources) {
    const current = resource.id;
    const props = object(resource.properties);
    switch (resource.type.toLowerCase()) {
      case "microsoft.compute/virtualmachines":
        for (const nic of objects(object(props.networkProfile).networkInterfaces)) {
          add(nic, current, "connects_to", "vm.networkProfile.networkInterfaces[].id");
        }
        break;
      case "microsoft.network/networkinterfaces":
        add(props.networkSecurityGroup, current, "secures", "networkInterface.networkSecurityGroup.id");
        for (const config of objects(props.ipConfigurations)) {
          const ipProps = object(config.properties);
          add(ipProps.subnet, current, "connects_to", "networkInterface.ipConfigurations[].subnet.id");
          add(ipProps.publicIPAddress, current, "connects_to", "networkInterface.ipConfigurations[].publicIPAddress.id");
        }
        break;
      case "microsoft.network/virtualnetworks":
        for (const subnet of objects(props.subnets)) {
          // id가 없으면 splitSubnets가 만드는 레코드 ID(`<vnet>/subnets/<name>`)와 같은 규칙으로 잇는다.
          const ref = idFromRef(subnet) ?? (typeof subnet.name === "string" && subnet.name.trim()
            ? `${current}/subnets/${subnet.name}` : null);
          add(current, ref, "connects_to", "vnet.subnets[].id");
        }
        for (const peering of objects(props.virtualNetworkPeerings)) {
          add(current, object(peering.properties).remoteVirtualNetwork, "connects_to", "vnet.virtualNetworkPeerings[].remoteVirtualNetwork.id");
        }
        break;
      case "microsoft.network/networksecuritygroups":
        for (const subnet of objects(props.subnets)) add(current, subnet, "secures", "nsg.subnets[].id");
        for (const nic of objects(props.networkInterfaces)) add(current, nic, "secures", "nsg.networkInterfaces[].id");
        break;
      case "microsoft.network/routetables":
        for (const subnet of objects(props.subnets)) add(current, subnet, "routes", "routeTable.subnets[].id");
        break;
      case "microsoft.network/virtualnetworks/subnets":
        add(props.networkSecurityGroup, current, "secures", "subnet.networkSecurityGroup.id");
        add(props.routeTable, current, "routes", "subnet.routeTable.id");
        break;
      case "microsoft.network/privateendpoints":
        add(props.subnet, current, "connects_to", "privateEndpoint.subnet.id");
        for (const connection of objects(props.privateLinkServiceConnections)) {
          add(current, object(connection.properties).privateLinkServiceId, "connects_to", "privateEndpoint.privateLinkServiceConnections[].privateLinkServiceId");
        }
        break;
      case "microsoft.web/sites":
        // 앱이 기록한 App Service plan 참조만 잇는다. 같은 스캔에 plan이 없으면 연결하지 않는다.
        if (typeof props.serverFarmId === "string" && resourceTypes.get(canonicalId(props.serverFarmId)) === "microsoft.web/serverfarms") {
          add(props.serverFarmId, current, "hosts", "site.serverFarmId");
        }
        break;
      case "microsoft.network/publicipaddresses":
        add(current, props.ipConfiguration, "connects_to", "publicIPAddress.ipConfiguration.id");
        break;
      case "microsoft.network/loadbalancers":
      case "microsoft.network/applicationgateways":
        for (const pool of objects(props.backendAddressPools)) {
          for (const config of objects(object(pool.properties).backendIPConfigurations)) {
            add(current, config, "connects_to", "backendAddressPools[].backendIPConfigurations[].id");
          }
        }
        for (const frontend of objects(props.frontendIPConfigurations)) {
          const frontendProps = object(frontend.properties);
          add(frontendProps.subnet, current, "connects_to", "frontendIPConfigurations[].subnet.id");
          add(frontendProps.publicIPAddress, current, "connects_to", "frontendIPConfigurations[].publicIPAddress.id");
        }
        break;
    }
  }
  return [...relations.values()];
}
