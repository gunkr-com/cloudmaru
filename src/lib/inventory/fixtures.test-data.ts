import type { InventoryResource } from "@/types/inventory";
import { normalizeResourceRow } from "./normalize";

const subscriptionId = "00000000-0000-0000-0000-000000000001";
const base = `/subscriptions/${subscriptionId}/resourcegroups/rg-network/providers`;
export const ids = {
  vnet: `${base}/microsoft.network/virtualnetworks/vnet-app`,
  peer: `${base}/microsoft.network/virtualnetworks/vnet-peer`,
  subnet: `${base}/microsoft.network/virtualnetworks/vnet-app/subnets/snet-app`,
  nsg: `${base}/microsoft.network/networksecuritygroups/nsg-app`,
  rt: `${base}/microsoft.network/routetables/rt-app`,
  nic: `${base}/microsoft.network/networkinterfaces/nic-app`,
  pip: `${base}/microsoft.network/publicipaddresses/pip-app`,
  lb: `${base}/microsoft.network/loadbalancers/lb-app`,
  appgw: `${base}/microsoft.network/applicationgateways/agw-app`,
  vm: `${base}/microsoft.compute/virtualmachines/vm-app`,
  pep: `${base}/microsoft.network/privateendpoints/pep-storage`,
  storage: `${base}/microsoft.storage/storageaccounts/stapp`,
} as const;

export function resource(id: string, properties: Record<string, unknown> = {}): InventoryResource {
  return normalizeResourceRow({
    id, name: id.split("/").at(-1),
    type: id.slice(id.indexOf("/providers/") + 11).split("/").filter((_, i) => i === 0 || i % 2 === 1).join("/"),
    subscriptionId, resourceGroup: "rg-network", properties,
  });
}

export function explicitNetworkResources(): InventoryResource[] {
  const frontend = [{ properties: { subnet: { id: ids.subnet }, publicIPAddress: { id: ids.pip } } }];
  const backend = [{ properties: { backendIPConfigurations: [{ id: `${ids.nic}/ipConfigurations/ipconfig1` }] } }];
  return [
    resource(ids.vnet, { subnets: [{ id: ids.subnet, name: "snet-app" }],
      virtualNetworkPeerings: [{ properties: { remoteVirtualNetwork: { id: ids.peer } } }] }),
    resource(ids.peer),
    resource(ids.subnet, { networkSecurityGroup: { id: ids.nsg }, routeTable: { id: ids.rt } }),
    resource(ids.nsg, { subnets: [{ id: ids.subnet }], networkInterfaces: [{ id: ids.nic }] }),
    resource(ids.rt, { subnets: [{ id: ids.subnet }] }),
    resource(ids.pip, { ipConfiguration: { id: `${ids.nic}/ipConfigurations/ipconfig1` } }),
    resource(ids.nic, { networkSecurityGroup: { id: ids.nsg }, ipConfigurations: [
      { properties: { subnet: { id: ids.subnet }, publicIPAddress: { id: ids.pip } } },
    ] }),
    resource(ids.lb, { frontendIPConfigurations: frontend, backendAddressPools: backend }),
    resource(ids.appgw, { frontendIPConfigurations: frontend, backendAddressPools: backend }),
    resource(ids.vm, { networkProfile: { networkInterfaces: [{ id: ids.nic }] } }),
    resource(ids.storage),
    resource(ids.pep, { subnet: { id: ids.subnet }, privateLinkServiceConnections: [
      { properties: { privateLinkServiceId: ids.storage } },
    ] }),
  ];
}
