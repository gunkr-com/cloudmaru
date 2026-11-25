import type { InventoryResource } from "@/types/inventory";

export const SUBSCRIPTION = "00000000-0000-0000-0000-000000000001";
export const RG = "rg-network";
export const BASE = `/subscriptions/${SUBSCRIPTION}/resourcegroups/${RG}/providers`;
export const VNET_ID = `${BASE}/microsoft.network/virtualnetworks/vnet-app`;
export const SUBNET_ID = `${VNET_ID}/subnets/snet-app`;
export const APPGW_SUBNET_ID = `${VNET_ID}/subnets/snet-gateway`;
export const BACKEND_SUBNET_ID = `${VNET_ID}/subnets/snet-backend`;
export const APPGW_ID = `${BASE}/microsoft.network/applicationgateways/appgw`;
export const INTERNAL_LB_ID = `${BASE}/microsoft.network/loadbalancers/lb-internal`;
export const NSG_ID = `${BASE}/microsoft.network/networksecuritygroups/nsg-app`;
export const RT_ID = `${BASE}/microsoft.network/routetables/rt-app`;
export const NIC_ID = `${BASE}/microsoft.network/networkinterfaces/nic-app`;
export const PIP_ID = `${BASE}/microsoft.network/publicipaddresses/pip-app`;
export const VM_ID = `${BASE}/microsoft.compute/virtualmachines/vm-app`;
export const PEP_ID = `${BASE}/microsoft.network/privateendpoints/pep-storage`;
export const STORAGE_ID = `${BASE}/microsoft.storage/storageaccounts/stapp`;

export function resource(resourceId: string, resourceType: string, properties: Record<string, unknown> = {}): InventoryResource {
  return {
    id: resourceId.toLowerCase(), type: resourceType.toLowerCase(),
    name: resourceId.replace(/\/+$/, "").split("/").at(-1)!,
    subscriptionId: SUBSCRIPTION, resourceGroup: RG, properties,
    kind: null, location: null, sku: null, tags: {}, zones: [], managedBy: null, parentId: null,
  };
}

export function nsgResource(nsgId = NSG_ID, options: {
  securityRules?: readonly Record<string, unknown>[];
  defaultRules?: readonly Record<string, unknown>[];
  subnets?: readonly Record<string, unknown>[];
  networkInterfaces?: readonly Record<string, unknown>[];
} = {}) {
  return resource(nsgId, "Microsoft.Network/networkSecurityGroups", {
    securityRules: options.securityRules ?? [], defaultSecurityRules: options.defaultRules ?? [],
    subnets: options.subnets ?? [], networkInterfaces: options.networkInterfaces ?? [],
  });
}

type RuleOptions = { priority?: number; direction?: string; sourcePrefix?: string; destPrefix?: string; protocol?: string };
export function allowRule(name = "allow-rule", options: RuleOptions = {}) {
  return { name, properties: {
    direction: options.direction ?? "inbound", access: "Allow", priority: options.priority ?? 100,
    sourceAddressPrefix: options.sourcePrefix ?? "*", destinationAddressPrefix: options.destPrefix ?? "*",
    sourcePortRange: "*", destinationPortRange: "*", protocol: options.protocol ?? "Tcp",
  } };
}
export function denyRule(name = "deny-rule", options: RuleOptions = {}) {
  const rule = allowRule(name, { ...options, priority: options.priority ?? 200 });
  return { ...rule, properties: { ...rule.properties, access: "Deny" } };
}

export function routeTableResource(rtId = RT_ID, options: {
  routes?: readonly Record<string, unknown>[]; subnets?: readonly Record<string, unknown>[];
} = {}) {
  return resource(rtId, "Microsoft.Network/routeTables", { routes: options.routes ?? [], subnets: options.subnets ?? [] });
}
export function routeEntry(name = "route-to-hub", options: {
  addressPrefix?: string; nextHopType?: string; nextHopIp?: string | null;
} = {}) {
  return { name, properties: {
    addressPrefix: options.addressPrefix ?? "10.0.0.0/8", nextHopType: options.nextHopType ?? "Internet",
    ...(options.nextHopIp ? { nextHopIpAddress: options.nextHopIp } : {}),
  } };
}
export function blackholeRoute(name = "blackhole-route", options: { addressPrefix?: string } = {}) {
  return routeEntry(name, { ...options, nextHopType: "None" });
}
