import { describe, expect, it } from "vitest";
import { networkEngineResultSchema } from "@/lib/completion/schema";
import { diagnosePath, analyzePath as analyzeSavedPath } from "./analyze-path";
import { completeSnapshot } from "@/lib/completion/fixtures.test-data";
import {
  resource,
  nsgResource,
  allowRule,
  denyRule,
  routeTableResource,
  routeEntry,
  blackholeRoute,
  APPGW_SUBNET_ID,
  BACKEND_SUBNET_ID,
  APPGW_ID,
  INTERNAL_LB_ID,
  BASE,
  VNET_ID,
  SUBNET_ID,
  NSG_ID,
  RT_ID,
  NIC_ID,
  VM_ID,
  PEP_ID,
  STORAGE_ID,
} from "./fixtures.test-data";
// ADR-024: legacy allow/deny fixtures describe explicit traffic; unresolved queries
// are covered separately in the NSG/route regressions and phase15 endpoint tests.
const analyzePath: typeof analyzeSavedPath = (resources, query) => analyzeSavedPath(resources, {
  protocol: "Tcp", sourceAddressPrefix: "10.0.1.4", destinationAddressPrefix: "10.0.2.4", ...query,
});

describe("TestAnalyzePath", () => {
  function baseResourcesWithNsgAllow() {
    return [
      resource(VNET_ID, "Microsoft.Network/virtualNetworks", {
        addressSpace: { addressPrefixes: ["10.0.0.0/16"] },
        subnets: [{ id: SUBNET_ID }],
      }),
      resource(SUBNET_ID, "Microsoft.Network/virtualNetworks/subnets", {
        networkSecurityGroup: { id: NSG_ID },
        routeTable: { id: RT_ID },
      }),
      nsgResource(NSG_ID, {
        securityRules: [allowRule()],
        subnets: [{ id: SUBNET_ID }],
      }),
      routeTableResource(RT_ID, {
        routes: [routeEntry()],
        subnets: [{ id: SUBNET_ID }],
      }),
      resource(NIC_ID, "Microsoft.Network/networkInterfaces", {
        networkSecurityGroup: { id: NSG_ID },
        ipConfigurations: [
          { name: "ipconfig1", properties: { subnet: { id: SUBNET_ID } } },
        ],
      }),
      resource(VM_ID, "Microsoft.Compute/virtualMachines", {
        networkProfile: { networkInterfaces: [{ id: NIC_ID }] },
      }),
    ];
  }
  it("test_path_found_with_nsg_allow_verdict", () => {
    const resources = baseResourcesWithNsgAllow();
    const result = analyzePath(resources, {
      sourceResourceId: VM_ID,
      destinationResourceId: SUBNET_ID,
    });
    expect(result.overallVerdict === "allowed").toBeTruthy();
    expect(result.pathCandidates.length >= 1).toBeTruthy();
  });
  it("test_virtual_network_default_rule_uses_owning_vnet_scope", () => {
    const resources = [
      resource(VNET_ID, "Microsoft.Network/virtualNetworks", {
        addressSpace: { addressPrefixes: ["10.0.0.0/16"] },
        subnets: [{ id: SUBNET_ID }],
      }),
      resource(SUBNET_ID, "Microsoft.Network/virtualNetworks/subnets", {
        networkSecurityGroup: { id: NSG_ID },
      }),
      nsgResource(NSG_ID, { subnets: [{ id: SUBNET_ID }] }),
      resource(NIC_ID, "Microsoft.Network/networkInterfaces", {
        ipConfigurations: [
          { name: "ipconfig1", properties: { subnet: { id: SUBNET_ID } } },
        ],
      }),
      resource(VM_ID, "Microsoft.Compute/virtualMachines", {
        networkProfile: { networkInterfaces: [{ id: NIC_ID }] },
      }),
    ];
    const result = analyzePath(resources, {
      sourceResourceId: VM_ID,
      destinationResourceId: SUBNET_ID,
      sourceAddressPrefix: "10.9.1.25/32",
      destinationAddressPrefix: "10.0.2.25/32",
    });
    expect(result.overallVerdict === "blocked").toBeTruthy();
    expect(
      result.pathCandidates[0].hops.at(-1)!.nsgRuleName === "DenyAllInBound",
    ).toBeTruthy();
  });
  it("test_path_found_with_nsg_deny_verdict", () => {
    const resources = [
      resource(VNET_ID, "Microsoft.Network/virtualNetworks", {
        addressSpace: { addressPrefixes: ["10.0.0.0/16"] },
        subnets: [{ id: SUBNET_ID }],
      }),
      resource(SUBNET_ID, "Microsoft.Network/virtualNetworks/subnets", {
        networkSecurityGroup: { id: NSG_ID },
      }),
      nsgResource(NSG_ID, {
        securityRules: [denyRule()],
        subnets: [{ id: SUBNET_ID }],
      }),
      resource(NIC_ID, "Microsoft.Network/networkInterfaces", {
        ipConfigurations: [
          { name: "ipconfig1", properties: { subnet: { id: SUBNET_ID } } },
        ],
      }),
      resource(VM_ID, "Microsoft.Compute/virtualMachines", {
        networkProfile: { networkInterfaces: [{ id: NIC_ID }] },
      }),
    ];
    const result = analyzePath(resources, {
      sourceResourceId: VM_ID,
      destinationResourceId: SUBNET_ID,
    });
    expect(result.overallVerdict === "blocked").toBeTruthy();
  });
  it("test_unknown_verdict_when_no_nsg_data", () => {
    const resources = [
      resource(VNET_ID, "Microsoft.Network/virtualNetworks", {
        addressSpace: { addressPrefixes: ["10.0.0.0/16"] },
        subnets: [{ id: SUBNET_ID }],
      }),
      resource(SUBNET_ID, "Microsoft.Network/virtualNetworks/subnets", {}),
      resource(NIC_ID, "Microsoft.Network/networkInterfaces", {
        ipConfigurations: [
          { name: "ipconfig1", properties: { subnet: { id: SUBNET_ID } } },
        ],
      }),
      resource(VM_ID, "Microsoft.Compute/virtualMachines", {
        networkProfile: { networkInterfaces: [{ id: NIC_ID }] },
      }),
    ];
    const result = analyzePath(resources, {
      sourceResourceId: VM_ID,
      destinationResourceId: SUBNET_ID,
    });
    expect(result.overallVerdict === "unknown").toBeTruthy();
    expect(
      result.pathCandidates[0].reason.toLowerCase().includes("insufficient") ||
        result.pathCandidates[0].reason.toLowerCase().includes("unknown"),
    ).toBeTruthy();
  });
  it("test_source_not_found_returns_unknown", () => {
    const resources = baseResourcesWithNsgAllow();
    const result = analyzePath(resources, {
      sourceResourceId: "/subscriptions/missing/resource",
      destinationResourceId: SUBNET_ID,
    });
    expect(result.overallVerdict === "unknown").toBeTruthy();
    expect(result.pathCandidates.length === 0).toBeTruthy();
    expect(
      result.warnings
        .map((w) => w.toLowerCase().includes("not found"))
        .some(Boolean),
    ).toBeTruthy();
  });
  it("test_destination_not_found_returns_unknown", () => {
    const resources = baseResourcesWithNsgAllow();
    const result = analyzePath(resources, {
      sourceResourceId: VM_ID,
      destinationResourceId: "/subscriptions/missing/resource",
    });
    expect(result.overallVerdict === "unknown").toBeTruthy();
    expect(
      result.warnings
        .map((w) => w.toLowerCase().includes("not found"))
        .some(Boolean),
    ).toBeTruthy();
  });
  it("test_no_path_returns_unknown", () => {
    const resources = [
      resource(
        (BASE + "/Microsoft.Compute/virtualMachines/vm-isolated").toLowerCase(),
        "Microsoft.Compute/virtualMachines",
      ),
      resource(
        (BASE + "/Microsoft.Storage/storageAccounts/stisolated").toLowerCase(),
        "Microsoft.Storage/storageAccounts",
      ),
    ];
    const result = analyzePath(resources, {
      sourceResourceId: (
        BASE + "/Microsoft.Compute/virtualMachines/vm-isolated"
      ).toLowerCase(),
      destinationResourceId: (
        BASE + "/Microsoft.Storage/storageAccounts/stisolated"
      ).toLowerCase(),
    });
    expect(result.overallVerdict === "unknown").toBeTruthy();
    expect(
      result.warnings
        .map((w) => w.toLowerCase().includes("no network path"))
        .some(Boolean),
    ).toBeTruthy();
  });
  it("test_path_candidate_contains_hops", () => {
    const resources = baseResourcesWithNsgAllow();
    const result = analyzePath(resources, {
      sourceResourceId: VM_ID,
      destinationResourceId: VNET_ID,
    });
    if (result.pathCandidates.length) {
      const candidate = result.pathCandidates[0];
      expect(candidate.hops.length >= 2).toBeTruthy();
      const hopResourceIds = candidate.hops.map((h) => h.resourceId);
      expect(hopResourceIds.includes(VM_ID)).toBeTruthy();
    }
  });
  it("test_nsg_verdict_on_subnet_hop", () => {
    const resources = baseResourcesWithNsgAllow();
    const result = analyzePath(resources, {
      sourceResourceId: VM_ID,
      destinationResourceId: VNET_ID,
    });
    if (result.pathCandidates.length) {
      const candidate = result.pathCandidates[0];
      const subnetHops = candidate.hops.filter((h) => h.hopType === "subnet");
      if (subnetHops.length) {
        expect(subnetHops[0].nsgVerdict != null).toBeTruthy();
        expect(subnetHops[0].nsgName != null).toBeTruthy();
      }
    }
  });
  it("test_route_verdict_on_subnet_hop", () => {
    const resources = baseResourcesWithNsgAllow();
    const result = analyzePath(resources, {
      sourceResourceId: VM_ID,
      destinationResourceId: VNET_ID,
    });
    if (result.pathCandidates.length) {
      const candidate = result.pathCandidates[0];
      const subnetHops = candidate.hops.filter((h) => h.hopType === "subnet");
      if (subnetHops.length) {
        expect(subnetHops[0].routeVerdict != null).toBeTruthy();
        expect(subnetHops[0].routeTableName != null).toBeTruthy();
      }
    }
  });
  it("test_private_endpoint_path", () => {
    const resources = [
      resource(VNET_ID, "Microsoft.Network/virtualNetworks", {
        addressSpace: { addressPrefixes: ["10.0.0.0/16"] },
        subnets: [{ id: SUBNET_ID }],
      }),
      resource(SUBNET_ID, "Microsoft.Network/virtualNetworks/subnets", {
        networkSecurityGroup: { id: NSG_ID },
      }),
      nsgResource(NSG_ID, {
        securityRules: [allowRule()],
        subnets: [{ id: SUBNET_ID }],
      }),
      resource(PEP_ID, "Microsoft.Network/privateEndpoints", {
        subnet: { id: SUBNET_ID },
        privateLinkServiceConnections: [
          { properties: { privateLinkServiceId: STORAGE_ID } },
        ],
      }),
      resource(STORAGE_ID, "Microsoft.Storage/storageAccounts"),
    ];
    const result = analyzePath(resources, {
      sourceResourceId: SUBNET_ID,
      destinationResourceId: STORAGE_ID,
    });
    // ADR-024: neither connection approval nor PE subnet policy was collected.
    expect(result.overallVerdict).toBe("unknown");
    expect(result.pathCandidates.length >= 1).toBeTruthy();
  });
  it("test_result_shape_fields", () => {
    const resources = baseResourcesWithNsgAllow();
    const result = analyzePath(resources, {
      sourceResourceId: VM_ID,
      destinationResourceId: VNET_ID,
    });
    expect(result.sourceResourceId === VM_ID).toBeTruthy();
    expect(result.destinationResourceId === VNET_ID).toBeTruthy();
    expect(
      ["allowed", "blocked", "unknown"].includes(result.overallVerdict),
    ).toBeTruthy();
    expect(Array.isArray(result.pathCandidates)).toBeTruthy();
    expect(Array.isArray(result.warnings)).toBeTruthy();
  });
});
describe("TestAnalyzePathEdgeCases", () => {
  it("test_same_source_and_destination", () => {
    const resources = baseResourcesWithNsgAllow();
    const result = analyzePath(resources, {
      sourceResourceId: VM_ID,
      destinationResourceId: VM_ID,
    });
    expect(
      ["allowed", "blocked", "unknown"].includes(result.overallVerdict),
    ).toBeTruthy();
  });
  function baseResourcesWithNsgAllow() {
    return [
      resource(VNET_ID, "Microsoft.Network/virtualNetworks", {
        addressSpace: { addressPrefixes: ["10.0.0.0/16"] },
        subnets: [{ id: SUBNET_ID }],
      }),
      resource(SUBNET_ID, "Microsoft.Network/virtualNetworks/subnets", {
        networkSecurityGroup: { id: NSG_ID },
        routeTable: { id: RT_ID },
      }),
      nsgResource(NSG_ID, {
        securityRules: [allowRule()],
        subnets: [{ id: SUBNET_ID }],
      }),
      routeTableResource(RT_ID, {
        routes: [routeEntry()],
        subnets: [{ id: SUBNET_ID }],
      }),
      resource(NIC_ID, "Microsoft.Network/networkInterfaces", {
        networkSecurityGroup: { id: NSG_ID },
        ipConfigurations: [
          { name: "ipconfig1", properties: { subnet: { id: SUBNET_ID } } },
        ],
      }),
      resource(VM_ID, "Microsoft.Compute/virtualMachines", {
        networkProfile: { networkInterfaces: [{ id: NIC_ID }] },
      }),
    ];
  }
  it("test_nsg_with_deny_overrides_allow_by_priority", () => {
    const resources = [
      resource(VNET_ID, "Microsoft.Network/virtualNetworks", {
        addressSpace: { addressPrefixes: ["10.0.0.0/16"] },
        subnets: [{ id: SUBNET_ID }],
      }),
      resource(SUBNET_ID, "Microsoft.Network/virtualNetworks/subnets", {
        networkSecurityGroup: { id: NSG_ID },
      }),
      nsgResource(NSG_ID, {
        securityRules: [
          denyRule("deny-all", { priority: 100 }),
          allowRule("allow-https", { priority: 200 }),
        ],
        subnets: [{ id: SUBNET_ID }],
      }),
      resource(NIC_ID, "Microsoft.Network/networkInterfaces", {
        ipConfigurations: [
          { name: "ipconfig1", properties: { subnet: { id: SUBNET_ID } } },
        ],
      }),
      resource(VM_ID, "Microsoft.Compute/virtualMachines", {
        networkProfile: { networkInterfaces: [{ id: NIC_ID }] },
      }),
    ];
    const result = analyzePath(resources, {
      sourceResourceId: VM_ID,
      destinationResourceId: SUBNET_ID,
    });
    expect(result.overallVerdict === "blocked").toBeTruthy();
  });
  it("test_route_table_with_blackhole_blocks_path", () => {
    const resources = [
      resource(VNET_ID, "Microsoft.Network/virtualNetworks", {
        addressSpace: { addressPrefixes: ["10.0.0.0/16"] },
        subnets: [{ id: SUBNET_ID }],
      }),
      resource(SUBNET_ID, "Microsoft.Network/virtualNetworks/subnets", {
        networkSecurityGroup: { id: NSG_ID },
        routeTable: { id: RT_ID },
      }),
      nsgResource(NSG_ID, {
        securityRules: [allowRule()],
        subnets: [{ id: SUBNET_ID }],
      }),
      routeTableResource(RT_ID, {
        routes: [blackholeRoute("blackhole-route", { addressPrefix: "10.0.0.0/16" })],
        subnets: [{ id: SUBNET_ID }],
      }),
      resource(NIC_ID, "Microsoft.Network/networkInterfaces", {
        ipConfigurations: [
          { name: "ipconfig1", properties: { subnet: { id: SUBNET_ID } } },
        ],
      }),
      resource(VM_ID, "Microsoft.Compute/virtualMachines", {
        networkProfile: { networkInterfaces: [{ id: NIC_ID }] },
      }),
    ];
    const result = analyzePath(resources, {
      sourceResourceId: VM_ID,
      destinationResourceId: SUBNET_ID,
    });
    expect(result.overallVerdict === "blocked").toBeTruthy();
  });
  it("test_route_name_reports_actual_winning_route", () => {
    const resources = [
      resource(VNET_ID, "Microsoft.Network/virtualNetworks", {
        addressSpace: { addressPrefixes: ["10.0.0.0/16"] },
        subnets: [{ id: SUBNET_ID }],
      }),
      resource(SUBNET_ID, "Microsoft.Network/virtualNetworks/subnets", {
        networkSecurityGroup: { id: NSG_ID },
        routeTable: { id: RT_ID },
      }),
      nsgResource(NSG_ID, {
        securityRules: [allowRule()],
        subnets: [{ id: SUBNET_ID }],
      }),
      routeTableResource(RT_ID, {
        routes: [
          routeEntry("non-matching-allow", {
            addressPrefix: "172.16.0.0/16",
            nextHopType: "Internet",
          }),
          blackholeRoute("drop-destination", { addressPrefix: "10.0.0.0/16" }),
        ],
        subnets: [{ id: SUBNET_ID }],
      }),
      resource(NIC_ID, "Microsoft.Network/networkInterfaces", {
        ipConfigurations: [
          { name: "ipconfig1", properties: { subnet: { id: SUBNET_ID } } },
        ],
      }),
      resource(VM_ID, "Microsoft.Compute/virtualMachines", {
        networkProfile: { networkInterfaces: [{ id: NIC_ID }] },
      }),
    ];
    const result = analyzePath(resources, {
      sourceResourceId: VM_ID,
      destinationResourceId: SUBNET_ID,
      destinationAddressPrefix: "10.0.1.25/32",
    });
    const subnetHop = result.pathCandidates[0].hops
      .filter((h) => h.resourceId === SUBNET_ID)
      .at(0)!;
    expect(result.overallVerdict === "blocked").toBeTruthy();
    expect(subnetHop.routeName === "drop-destination").toBeTruthy();
    expect(subnetHop.routeNextHopType === "None").toBeTruthy();
    expect(subnetHop.routeNextHopIp == null).toBeTruthy();
  });
  it("test_route_next_hop_ip_is_reported_for_ambiguous_appliance_routes", () => {
    const resources = [
      resource(VNET_ID, "Microsoft.Network/virtualNetworks", {
        addressSpace: { addressPrefixes: ["10.0.0.0/16"] },
        subnets: [{ id: SUBNET_ID }],
      }),
      resource(SUBNET_ID, "Microsoft.Network/virtualNetworks/subnets", {
        networkSecurityGroup: { id: NSG_ID },
        routeTable: { id: RT_ID },
      }),
      nsgResource(NSG_ID, {
        securityRules: [allowRule()],
        subnets: [{ id: SUBNET_ID }],
      }),
      routeTableResource(RT_ID, {
        routes: [
          routeEntry("to-firewall", {
            addressPrefix: "10.0.0.0/16",
            nextHopType: "VirtualAppliance",
            nextHopIp: "10.0.0.4",
          }),
        ],
        subnets: [{ id: SUBNET_ID }],
      }),
      resource(NIC_ID, "Microsoft.Network/networkInterfaces", {
        ipConfigurations: [
          { name: "ipconfig1", properties: { subnet: { id: SUBNET_ID } } },
        ],
      }),
      resource(VM_ID, "Microsoft.Compute/virtualMachines", {
        networkProfile: { networkInterfaces: [{ id: NIC_ID }] },
      }),
    ];
    const result = analyzePath(resources, {
      sourceResourceId: VM_ID,
      destinationResourceId: SUBNET_ID,
      destinationAddressPrefix: "10.0.1.25/32",
    });
    const subnetHop = result.pathCandidates[0].hops
      .filter((h) => h.resourceId === SUBNET_ID)
      .at(0)!;
    expect(result.overallVerdict === "unknown").toBeTruthy();
    expect(subnetHop.routeName === "to-firewall").toBeTruthy();
    expect(subnetHop.routeNextHopType === "VirtualAppliance").toBeTruthy();
    expect(subnetHop.routeNextHopIp === "10.0.0.4").toBeTruthy();
  });
  it("test_one_way_vnet_peering_does_not_create_reverse_path", () => {
    const remoteVnetId = (
      BASE + "/Microsoft.Network/virtualNetworks/vnet-remote"
    ).toLowerCase();
    const remoteSubnetId = (
      remoteVnetId + "/subnets/snet-remote"
    ).toLowerCase();
    const remoteNicId = (
      BASE + "/Microsoft.Network/networkInterfaces/nic-remote"
    ).toLowerCase();
    const remoteVmId = (
      BASE + "/Microsoft.Compute/virtualMachines/vm-remote"
    ).toLowerCase();
    const resources = [
      resource(VNET_ID, "Microsoft.Network/virtualNetworks", {
        subnets: [{ id: SUBNET_ID }],
        virtualNetworkPeerings: [
          { properties: { remoteVirtualNetwork: { id: remoteVnetId } } },
        ],
      }),
      resource(SUBNET_ID, "Microsoft.Network/virtualNetworks/subnets", {}),
      resource(remoteVnetId, "Microsoft.Network/virtualNetworks", {
        subnets: [{ id: remoteSubnetId }],
      }),
      resource(remoteSubnetId, "Microsoft.Network/virtualNetworks/subnets", {}),
      resource(remoteNicId, "Microsoft.Network/networkInterfaces", {
        ipConfigurations: [
          { name: "ipconfig1", properties: { subnet: { id: remoteSubnetId } } },
        ],
      }),
      resource(remoteVmId, "Microsoft.Compute/virtualMachines", {
        networkProfile: { networkInterfaces: [{ id: remoteNicId }] },
      }),
    ];
    const result = analyzePath(resources, {
      sourceResourceId: remoteVmId,
      destinationResourceId: SUBNET_ID,
    });
    expect(result.overallVerdict === "unknown").toBeTruthy();
    expect(result.pathCandidates).toEqual([]);
    expect(
      result.warnings.at(-1)!.includes("No network path found"),
    ).toBeTruthy();
  });
  it("test_missing_vnet_peering_state_does_not_create_path", () => {
    const remoteVnetId = (
      BASE + "/Microsoft.Network/virtualNetworks/vnet-remote"
    ).toLowerCase();
    const remoteSubnetId = (
      remoteVnetId + "/subnets/snet-remote"
    ).toLowerCase();
    const remoteNicId = (
      BASE + "/Microsoft.Network/networkInterfaces/nic-remote"
    ).toLowerCase();
    const remoteVmId = (
      BASE + "/Microsoft.Compute/virtualMachines/vm-remote"
    ).toLowerCase();
    const resources = [
      resource(VNET_ID, "Microsoft.Network/virtualNetworks", {
        subnets: [{ id: SUBNET_ID }],
        virtualNetworkPeerings: [
          { properties: { remoteVirtualNetwork: { id: remoteVnetId } } },
        ],
      }),
      resource(SUBNET_ID, "Microsoft.Network/virtualNetworks/subnets", {}),
      resource(remoteVnetId, "Microsoft.Network/virtualNetworks", {
        subnets: [{ id: remoteSubnetId }],
        virtualNetworkPeerings: [
          { properties: { remoteVirtualNetwork: { id: VNET_ID } } },
        ],
      }),
      resource(remoteSubnetId, "Microsoft.Network/virtualNetworks/subnets", {}),
      resource(remoteNicId, "Microsoft.Network/networkInterfaces", {
        ipConfigurations: [
          { name: "ipconfig1", properties: { subnet: { id: remoteSubnetId } } },
        ],
      }),
      resource(remoteVmId, "Microsoft.Compute/virtualMachines", {
        networkProfile: { networkInterfaces: [{ id: remoteNicId }] },
      }),
    ];
    const result = analyzePath(resources, {
      sourceResourceId: remoteVmId,
      destinationResourceId: SUBNET_ID,
    });
    expect(result.overallVerdict === "unknown").toBeTruthy();
    expect(result.pathCandidates).toEqual([]);
    expect(
      result.warnings.at(-1)!.includes("No network path found"),
    ).toBeTruthy();
  });
  it("test_initiated_vnet_peering_does_not_create_path", () => {
    const remoteVnetId = (
      BASE + "/Microsoft.Network/virtualNetworks/vnet-remote"
    ).toLowerCase();
    const remoteSubnetId = (
      remoteVnetId + "/subnets/snet-remote"
    ).toLowerCase();
    const remoteNicId = (
      BASE + "/Microsoft.Network/networkInterfaces/nic-remote"
    ).toLowerCase();
    const remoteVmId = (
      BASE + "/Microsoft.Compute/virtualMachines/vm-remote"
    ).toLowerCase();
    const resources = [
      resource(VNET_ID, "Microsoft.Network/virtualNetworks", {
        subnets: [{ id: SUBNET_ID }],
        virtualNetworkPeerings: [
          {
            properties: {
              remoteVirtualNetwork: { id: remoteVnetId },
              peeringState: "Initiated",
            },
          },
        ],
      }),
      resource(SUBNET_ID, "Microsoft.Network/virtualNetworks/subnets", {}),
      resource(remoteVnetId, "Microsoft.Network/virtualNetworks", {
        subnets: [{ id: remoteSubnetId }],
        virtualNetworkPeerings: [
          {
            properties: {
              remoteVirtualNetwork: { id: VNET_ID },
              peeringState: "Connected",
            },
          },
        ],
      }),
      resource(remoteSubnetId, "Microsoft.Network/virtualNetworks/subnets", {}),
      resource(remoteNicId, "Microsoft.Network/networkInterfaces", {
        ipConfigurations: [
          { name: "ipconfig1", properties: { subnet: { id: remoteSubnetId } } },
        ],
      }),
      resource(remoteVmId, "Microsoft.Compute/virtualMachines", {
        networkProfile: { networkInterfaces: [{ id: remoteNicId }] },
      }),
    ];
    const result = analyzePath(resources, {
      sourceResourceId: remoteVmId,
      destinationResourceId: SUBNET_ID,
    });
    expect(result.overallVerdict === "unknown").toBeTruthy();
    expect(result.pathCandidates).toEqual([]);
    expect(
      result.warnings.at(-1)!.includes("No network path found"),
    ).toBeTruthy();
  });
  it("test_disconnected_vnet_peering_does_not_create_path", () => {
    const remoteVnetId = (
      BASE + "/Microsoft.Network/virtualNetworks/vnet-remote"
    ).toLowerCase();
    const remoteSubnetId = (
      remoteVnetId + "/subnets/snet-remote"
    ).toLowerCase();
    const remoteNicId = (
      BASE + "/Microsoft.Network/networkInterfaces/nic-remote"
    ).toLowerCase();
    const remoteVmId = (
      BASE + "/Microsoft.Compute/virtualMachines/vm-remote"
    ).toLowerCase();
    const resources = [
      resource(VNET_ID, "Microsoft.Network/virtualNetworks", {
        subnets: [{ id: SUBNET_ID }],
        virtualNetworkPeerings: [
          {
            properties: {
              remoteVirtualNetwork: { id: remoteVnetId },
              peeringState: "Disconnected",
            },
          },
        ],
      }),
      resource(SUBNET_ID, "Microsoft.Network/virtualNetworks/subnets", {}),
      resource(remoteVnetId, "Microsoft.Network/virtualNetworks", {
        subnets: [{ id: remoteSubnetId }],
        virtualNetworkPeerings: [
          {
            properties: {
              remoteVirtualNetwork: { id: VNET_ID },
              peeringState: "Connected",
            },
          },
        ],
      }),
      resource(remoteSubnetId, "Microsoft.Network/virtualNetworks/subnets", {}),
      resource(remoteNicId, "Microsoft.Network/networkInterfaces", {
        ipConfigurations: [
          { name: "ipconfig1", properties: { subnet: { id: remoteSubnetId } } },
        ],
      }),
      resource(remoteVmId, "Microsoft.Compute/virtualMachines", {
        networkProfile: { networkInterfaces: [{ id: remoteNicId }] },
      }),
    ];
    const result = analyzePath(resources, {
      sourceResourceId: remoteVmId,
      destinationResourceId: SUBNET_ID,
    });
    expect(result.overallVerdict === "unknown").toBeTruthy();
    expect(result.pathCandidates).toEqual([]);
    expect(
      result.warnings.at(-1)!.includes("No network path found"),
    ).toBeTruthy();
  });
  it("test_reciprocal_vnet_peering_allows_path_traversal", () => {
    const remoteVnetId = (
      BASE + "/Microsoft.Network/virtualNetworks/vnet-remote"
    ).toLowerCase();
    const remoteSubnetId = (
      remoteVnetId + "/subnets/snet-remote"
    ).toLowerCase();
    const remoteNicId = (
      BASE + "/Microsoft.Network/networkInterfaces/nic-remote"
    ).toLowerCase();
    const remoteVmId = (
      BASE + "/Microsoft.Compute/virtualMachines/vm-remote"
    ).toLowerCase();
    const resources = [
      resource(VNET_ID, "Microsoft.Network/virtualNetworks", {
        subnets: [{ id: SUBNET_ID }],
        virtualNetworkPeerings: [
          {
            properties: {
              remoteVirtualNetwork: { id: remoteVnetId },
              peeringState: "Connected",
            },
          },
        ],
      }),
      resource(SUBNET_ID, "Microsoft.Network/virtualNetworks/subnets", {}),
      resource(remoteVnetId, "Microsoft.Network/virtualNetworks", {
        subnets: [{ id: remoteSubnetId }],
        virtualNetworkPeerings: [
          {
            properties: {
              remoteVirtualNetwork: { id: VNET_ID },
              peeringState: "Connected",
            },
          },
        ],
      }),
      resource(remoteSubnetId, "Microsoft.Network/virtualNetworks/subnets", {}),
      resource(remoteNicId, "Microsoft.Network/networkInterfaces", {
        ipConfigurations: [
          { name: "ipconfig1", properties: { subnet: { id: remoteSubnetId } } },
        ],
      }),
      resource(remoteVmId, "Microsoft.Compute/virtualMachines", {
        networkProfile: { networkInterfaces: [{ id: remoteNicId }] },
      }),
    ];
    const result = analyzePath(resources, {
      sourceResourceId: remoteVmId,
      destinationResourceId: SUBNET_ID,
    });
    expect(result.pathCandidates.length).toBeGreaterThan(0);
    expect(
      result.pathCandidates[0].hops.at(-1)!.resourceId === SUBNET_ID,
    ).toBeTruthy();
  });
  it("test_direct_vnet_peering_allows_path_when_forwarded_traffic_false", () => {
    const remoteVnetId = (
      BASE + "/Microsoft.Network/virtualNetworks/vnet-remote"
    ).toLowerCase();
    const remoteSubnetId = (
      remoteVnetId + "/subnets/snet-remote"
    ).toLowerCase();
    const remoteNicId = (
      BASE + "/Microsoft.Network/networkInterfaces/nic-remote"
    ).toLowerCase();
    const remoteVmId = (
      BASE + "/Microsoft.Compute/virtualMachines/vm-remote"
    ).toLowerCase();
    const resources = [
      resource(VNET_ID, "Microsoft.Network/virtualNetworks", {
        subnets: [{ id: SUBNET_ID }],
        virtualNetworkPeerings: [
          {
            properties: {
              remoteVirtualNetwork: { id: remoteVnetId },
              peeringState: "Connected",
              allowForwardedTraffic: false,
            },
          },
        ],
      }),
      resource(SUBNET_ID, "Microsoft.Network/virtualNetworks/subnets", {}),
      resource(remoteVnetId, "Microsoft.Network/virtualNetworks", {
        subnets: [{ id: remoteSubnetId }],
        virtualNetworkPeerings: [
          {
            properties: {
              remoteVirtualNetwork: { id: VNET_ID },
              peeringState: "Connected",
              allowForwardedTraffic: false,
            },
          },
        ],
      }),
      resource(remoteSubnetId, "Microsoft.Network/virtualNetworks/subnets", {}),
      resource(remoteNicId, "Microsoft.Network/networkInterfaces", {
        ipConfigurations: [
          { name: "ipconfig1", properties: { subnet: { id: remoteSubnetId } } },
        ],
      }),
      resource(remoteVmId, "Microsoft.Compute/virtualMachines", {
        networkProfile: { networkInterfaces: [{ id: remoteNicId }] },
      }),
    ];
    const result = analyzePath(resources, {
      sourceResourceId: remoteVmId,
      destinationResourceId: SUBNET_ID,
    });
    expect(result.pathCandidates.length).toBeGreaterThan(0);
    expect(
      result.pathCandidates[0].hops.at(-1)!.resourceId === SUBNET_ID,
    ).toBeTruthy();
  });
  function transitivePeeringResources({
    targetToHub = null,
    hubToTarget = null,
    hubToSpoke = null,
    spokeToHub = null,
  }: {
    targetToHub?: boolean | null;
    hubToTarget?: boolean | null;
    hubToSpoke?: boolean | null;
    spokeToHub?: boolean | null;
  } = {}): [ReturnType<typeof resource>[], string] {
    const hubVnetId = (
      BASE + "/Microsoft.Network/virtualNetworks/vnet-hub"
    ).toLowerCase();
    const spokeVnetId = (
      BASE + "/Microsoft.Network/virtualNetworks/vnet-spoke"
    ).toLowerCase();
    const hubSubnetId = (hubVnetId + "/subnets/snet-hub").toLowerCase();
    const spokeSubnetId = (spokeVnetId + "/subnets/snet-spoke").toLowerCase();
    const spokeNicId = (
      BASE + "/Microsoft.Network/networkInterfaces/nic-spoke"
    ).toLowerCase();
    const spokeVmId = (
      BASE + "/Microsoft.Compute/virtualMachines/vm-spoke"
    ).toLowerCase();
    function peering(remoteVnetId: string, allowForwarded: boolean | null) {
      const props: Record<string, unknown> = {
        remoteVirtualNetwork: { id: remoteVnetId },
        peeringState: "Connected",
      };
      if (allowForwarded != null) {
        props["allowForwardedTraffic"] = allowForwarded;
      }
      return { properties: props };
    }
    return [
      [
        resource(VNET_ID, "Microsoft.Network/virtualNetworks", {
          subnets: [{ id: SUBNET_ID }],
          virtualNetworkPeerings: [peering(hubVnetId, targetToHub)],
        }),
        resource(SUBNET_ID, "Microsoft.Network/virtualNetworks/subnets", {}),
        resource(hubVnetId, "Microsoft.Network/virtualNetworks", {
          subnets: [{ id: hubSubnetId }],
          virtualNetworkPeerings: [
            peering(VNET_ID, hubToTarget),
            peering(spokeVnetId, hubToSpoke),
          ],
        }),
        resource(hubSubnetId, "Microsoft.Network/virtualNetworks/subnets", {}),
        resource(spokeVnetId, "Microsoft.Network/virtualNetworks", {
          subnets: [{ id: spokeSubnetId }],
          virtualNetworkPeerings: [peering(hubVnetId, spokeToHub)],
        }),
        resource(
          spokeSubnetId,
          "Microsoft.Network/virtualNetworks/subnets",
          {},
        ),
        resource(spokeNicId, "Microsoft.Network/networkInterfaces", {
          ipConfigurations: [
            {
              name: "ipconfig1",
              properties: { subnet: { id: spokeSubnetId } },
            },
          ],
        }),
        resource(spokeVmId, "Microsoft.Compute/virtualMachines", {
          networkProfile: { networkInterfaces: [{ id: spokeNicId }] },
        }),
      ],
      spokeVmId,
    ];
  }
  it("test_transitive_vnet_peering_missing_allow_forwarded_does_not_create_path", () => {
    const [resources, spokeVmId] = transitivePeeringResources();
    const result = analyzePath(resources, {
      sourceResourceId: spokeVmId,
      destinationResourceId: SUBNET_ID,
    });
    expect(result.overallVerdict === "unknown").toBeTruthy();
    expect(result.pathCandidates).toEqual([]);
    expect(
      result.warnings.at(-1)!.includes("No network path found"),
    ).toBeTruthy();
  });
  it("test_transitive_vnet_peering_allow_forwarded_false_does_not_create_path", () => {
    const [resources, spokeVmId] = transitivePeeringResources({
      targetToHub: true,
      hubToTarget: false,
      hubToSpoke: true,
      spokeToHub: true,
    });
    const result = analyzePath(resources, {
      sourceResourceId: spokeVmId,
      destinationResourceId: SUBNET_ID,
    });
    expect(result.overallVerdict === "unknown").toBeTruthy();
    expect(result.pathCandidates).toEqual([]);
    expect(
      result.warnings.at(-1)!.includes("No network path found"),
    ).toBeTruthy();
  });
  it("test_transitive_vnet_peering_first_allow_forwarded_false_does_not_create_path", () => {
    const [resources, spokeVmId] = transitivePeeringResources({
      targetToHub: true,
      hubToTarget: true,
      hubToSpoke: true,
      spokeToHub: false,
    });
    const result = analyzePath(resources, {
      sourceResourceId: spokeVmId,
      destinationResourceId: SUBNET_ID,
    });
    expect(result.overallVerdict === "unknown").toBeTruthy();
    expect(result.pathCandidates).toEqual([]);
    expect(
      result.warnings.at(-1)!.includes("No network path found"),
    ).toBeTruthy();
  });
  it("test_transitive_vnet_peering_allows_path_when_forwarded_traffic_true", () => {
    const [resources, spokeVmId] = transitivePeeringResources({
      targetToHub: true,
      hubToTarget: true,
      hubToSpoke: true,
      spokeToHub: true,
    });
    const result = analyzePath(resources, {
      sourceResourceId: spokeVmId,
      destinationResourceId: SUBNET_ID,
    });
    expect(result.overallVerdict).toBe("unknown");
    expect(diagnosePath(resources, { sourceResourceId: spokeVmId, destinationResourceId: SUBNET_ID }).reasonCodes).toContain("transitive-peering-requires-forwarder");
    expect(result.pathCandidates.length).toBeGreaterThan(0);
    expect(
      result.pathCandidates[0].hops.at(-1)!.resourceId === SUBNET_ID,
    ).toBeTruthy();
  });
  it("test_path_trace_does_not_treat_nsg_attachment_as_traffic_path", () => {
    const resources = [
      resource(SUBNET_ID, "Microsoft.Network/virtualNetworks/subnets", {
        networkSecurityGroup: { id: NSG_ID },
      }),
      nsgResource(NSG_ID, {
        securityRules: [allowRule()],
        subnets: [{ id: SUBNET_ID }],
      }),
    ];
    const result = analyzePath(resources, {
      sourceResourceId: NSG_ID,
      destinationResourceId: SUBNET_ID,
    });
    expect(result.overallVerdict === "unknown").toBeTruthy();
    expect(result.pathCandidates).toEqual([]);
    expect(
      result.warnings
        .map((warning) => warning.toLowerCase().includes("no network path"))
        .some(Boolean),
    ).toBeTruthy();
  });
  it("test_path_trace_does_not_treat_route_table_attachment_as_traffic_path", () => {
    const resources = [
      resource(SUBNET_ID, "Microsoft.Network/virtualNetworks/subnets", {
        routeTable: { id: RT_ID },
      }),
      routeTableResource(RT_ID, {
        routes: [routeEntry()],
        subnets: [{ id: SUBNET_ID }],
      }),
    ];
    const result = analyzePath(resources, {
      sourceResourceId: RT_ID,
      destinationResourceId: SUBNET_ID,
    });
    expect(result.overallVerdict === "unknown").toBeTruthy();
    expect(result.pathCandidates).toEqual([]);
    expect(
      result.warnings
        .map((warning) => warning.toLowerCase().includes("no network path"))
        .some(Boolean),
    ).toBeTruthy();
  });
});

describe("Inventory integration boundaries", () => {
  const query = { sourceResourceId: VM_ID, destinationResourceId: SUBNET_ID };
  function inventory(
    options: {
      missingNsg?: boolean;
      missingRoute?: boolean;
      embeddedOnly?: boolean;
    } = {},
  ) {
    const subnet = resource(
      SUBNET_ID,
      "microsoft.network/virtualnetworks/subnets",
      {
        networkSecurityGroup: { id: NSG_ID },
        routeTable: { id: RT_ID },
      },
    );
    return [
      resource(VNET_ID, "microsoft.network/virtualnetworks", {
        addressSpace: { addressPrefixes: ["10.0.0.0/16"] },
        subnets: [
          {
            id: SUBNET_ID.toUpperCase() + "/",
            name: "snet-app",
            properties: subnet.properties,
          },
        ],
      }),
      ...(!options.embeddedOnly ? [subnet] : []),
      ...(!options.missingNsg
        ? [nsgResource(NSG_ID, { securityRules: [allowRule()] })]
        : []),
      ...(!options.missingRoute
        ? [routeTableResource(RT_ID, { routes: [routeEntry()] })]
        : []),
      resource(NIC_ID, "microsoft.network/networkinterfaces", {
        ipConfigurations: [{ properties: { subnet: { id: SUBNET_ID } } }],
      }),
      resource(VM_ID, "microsoft.compute/virtualmachines", {
        networkProfile: {
          networkInterfaces: [{ id: NIC_ID.toUpperCase() + "/" }],
        },
      }),
    ];
  }
  it("uses canonical IDs and preserves the query IDs in the result", () => {
    const mixedQuery = {
      sourceResourceId: ` ${VM_ID.toUpperCase()}/ `,
      destinationResourceId: SUBNET_ID.toUpperCase() + "/",
    };
    const result = analyzePath(inventory(), mixedQuery);
    expect(result.overallVerdict).toBe("allowed");
    expect(result.sourceResourceId).toBe(mixedQuery.sourceResourceId);
    expect(result.pathCandidates[0].hops.map((hop) => hop.resourceId)).toEqual([
      VM_ID,
      NIC_ID,
      SUBNET_ID,
    ]);
  });
  it("does not duplicate embedded and separate subnet records or mutate the inventory", () => {
    const resources = inventory();
    const before = structuredClone(resources);
    const result = analyzePath(Object.freeze(resources), query);
    expect(resources).toEqual(before);
    expect(result.overallVerdict).toBe("allowed");
    expect(
      result.pathCandidates[0].hops.filter(
        (hop) => hop.resourceId === SUBNET_ID,
      ),
    ).toHaveLength(1);
  });
  it("supports embedded subnets without a separate inventory record", () => {
    expect(
      analyzePath(inventory({ embeddedOnly: true }), query).overallVerdict,
    ).toBe("allowed");
  });
  it("keeps a missing referenced NSG unknown despite an allowed route", () => {
    expect(
      analyzePath(inventory({ missingNsg: true }), query).overallVerdict,
    ).toBe("unknown");
  });
  it("keeps a missing referenced route table unknown despite an allowed NSG", () => {
    expect(
      analyzePath(inventory({ missingRoute: true }), query).overallVerdict,
    ).toBe("unknown");
  });
  it("keeps an unknown service tag unknown through the full path", () => {
    const resources = inventory().map((item) =>
      item.id === NSG_ID
        ? nsgResource(NSG_ID, {
            securityRules: [
              allowRule("allow-out", { direction: "outbound", protocol: "*" }),
              allowRule("unresolved-service", {
                sourcePrefix: "FutureService",
              }),
            ],
          })
        : item,
    );
    expect(
      analyzePath(resources, {
        ...query,
        sourceAddressPrefix: "8.8.8.8",
        destinationAddressPrefix: "10.0.0.4",
      }).overallVerdict,
    ).toBe("unknown");
  });
});

describe("NSG direction by path side", () => {
  const SUBNET_B_ID = `${VNET_ID}/subnets/snet-db`;
  const NSG_B_ID = `${BASE}/microsoft.network/networksecuritygroups/nsg-db`;
  const NIC_B_ID = `${BASE}/microsoft.network/networkinterfaces/nic-db`;
  const VM_B_ID = `${BASE}/microsoft.compute/virtualmachines/vm-db`;
  const NIC_A2_ID = `${BASE}/microsoft.network/networkinterfaces/nic-app2`;
  const VM_A2_ID = `${BASE}/microsoft.compute/virtualmachines/vm-app2`;
  type Rules = readonly Record<string, unknown>[];

  function vm(vmId: string, nicId: string, subnetId: string) {
    return [
      resource(nicId, "Microsoft.Network/networkInterfaces", {
        ipConfigurations: [
          { name: "ipconfig1", properties: { subnet: { id: subnetId } } },
        ],
      }),
      resource(vmId, "Microsoft.Compute/virtualMachines", {
        networkProfile: { networkInterfaces: [{ id: nicId }] },
      }),
    ];
  }
  function twoSubnets(sourceRules: Rules, destinationRules: Rules) {
    return [
      resource(VNET_ID, "Microsoft.Network/virtualNetworks", {
        addressSpace: { addressPrefixes: ["10.0.0.0/16"] },
        subnets: [{ id: SUBNET_ID }, { id: SUBNET_B_ID }],
      }),
      resource(SUBNET_ID, "Microsoft.Network/virtualNetworks/subnets", {
        addressPrefix: "10.0.1.0/24",
        networkSecurityGroup: { id: NSG_ID },
      }),
      resource(SUBNET_B_ID, "Microsoft.Network/virtualNetworks/subnets", {
        addressPrefix: "10.0.2.0/24",
        networkSecurityGroup: { id: NSG_B_ID },
      }),
      nsgResource(NSG_ID, {
        securityRules: sourceRules,
        subnets: [{ id: SUBNET_ID }],
      }),
      nsgResource(NSG_B_ID, {
        securityRules: destinationRules,
        subnets: [{ id: SUBNET_B_ID }],
      }),
      ...vm(VM_ID, NIC_ID, SUBNET_ID),
      ...vm(VM_B_ID, NIC_B_ID, SUBNET_B_ID),
    ];
  }
  const rdp = {
    sourceResourceId: VM_ID,
    destinationResourceId: VM_B_ID,
    protocol: "Tcp",
    sourceAddressPrefix: "10.0.1.4",
    destinationAddressPrefix: "10.0.2.4",
    destinationPort: 3389,
  };
  const inbound = { direction: "inbound", priority: 100 };
  const outbound = { direction: "outbound", priority: 100 };

  it("ignores the source subnet's inbound rules", () => {
    const result = analyzePath(
      twoSubnets([denyRule("deny-rdp-in", inbound)], []),
      rdp,
    );
    expect(result.overallVerdict).toBe("allowed");
  });

  it("ignores the destination subnet's outbound rules", () => {
    const result = analyzePath(
      twoSubnets([], [denyRule("deny-all-out", outbound)]),
      rdp,
    );
    expect(result.overallVerdict).toBe("allowed");
  });

  it("blocks on the source subnet's outbound rules", () => {
    const result = analyzePath(
      twoSubnets([denyRule("deny-out", outbound)], []),
      rdp,
    );
    expect(result.overallVerdict).toBe("blocked");
    const blocked = result.pathCandidates[0].hops.find(
      (hop) => hop.resourceId === SUBNET_ID,
    )!;
    expect(blocked.nsgDirection).toBe("outbound");
    expect(blocked.nsgRuleName).toBe("deny-out");
  });

  it("blocks on the destination subnet's inbound rules", () => {
    const result = analyzePath(
      twoSubnets([], [denyRule("deny-rdp-in", inbound)]),
      rdp,
    );
    expect(result.overallVerdict).toBe("blocked");
    const blocked = result.pathCandidates[0].hops.find(
      (hop) => hop.resourceId === SUBNET_B_ID,
    )!;
    expect(blocked.nsgDirection).toBe("inbound");
    expect(blocked.nsgRuleName).toBe("deny-rdp-in");
  });

  it("evaluates both directions when source and destination share a subnet", () => {
    const sameSubnet = (rules: Rules) => [
      resource(VNET_ID, "Microsoft.Network/virtualNetworks", {
        addressSpace: { addressPrefixes: ["10.0.0.0/16"] },
        subnets: [{ id: SUBNET_ID }],
      }),
      resource(SUBNET_ID, "Microsoft.Network/virtualNetworks/subnets", {
        addressPrefix: "10.0.1.0/24",
        networkSecurityGroup: { id: NSG_ID },
      }),
      nsgResource(NSG_ID, { securityRules: rules, subnets: [{ id: SUBNET_ID }] }),
      ...vm(VM_ID, NIC_ID, SUBNET_ID),
      ...vm(VM_A2_ID, NIC_A2_ID, SUBNET_ID),
    ];
    const query = {
      ...rdp,
      destinationResourceId: VM_A2_ID,
      destinationAddressPrefix: "10.0.1.5",
    };
    expect(analyzePath(sameSubnet([]), query).overallVerdict).toBe("allowed");
    expect(
      analyzePath(sameSubnet([denyRule("deny-in", inbound)]), query)
        .overallVerdict,
    ).toBe("blocked");
    expect(
      analyzePath(sameSubnet([denyRule("deny-out", outbound)]), query)
        .overallVerdict,
    ).toBe("blocked");
  });

  it("labels a source-side NSG block as outbound in the reason", () => {
    const result = analyzePath(
      twoSubnets([denyRule("deny-out", outbound)], []),
      rdp,
    );
    const reason = result.pathCandidates[0].reason;
    expect(reason).toContain("snet-app (outNSG=blocked)");
    expect(reason).not.toContain("inNSG=");
  });

  describe("route tables apply to traffic leaving the source side", () => {
    const RT_B_ID = `${BASE}/microsoft.network/routetables/rt-db`;
    type Resources = ReturnType<typeof resource>[];
    function withRoutes(
      resources: Resources,
      subnetId: string,
      rtId: string,
      routes: Rules,
    ): Resources {
      return [
        ...resources.map((item) =>
          item.id === subnetId.toLowerCase()
            ? {
                ...item,
                properties: { ...item.properties, routeTable: { id: rtId } },
              }
            : item,
        ),
        routeTableResource(rtId, { routes, subnets: [{ id: subnetId }] }),
      ];
    }
    const allowAllInbound = [allowRule("allow-in", inbound)];
    const dropAll = blackholeRoute("drop-all", { addressPrefix: "0.0.0.0/0" });
    const sourceSubnetHop = (resources: Resources, query = rdp) =>
      analyzePath(resources, query).pathCandidates[0].hops.find(
        (hop) => hop.resourceId === SUBNET_ID,
      )!;

    it("ignores the destination subnet's route table", () => {
      const result = analyzePath(
        withRoutes(twoSubnets([], []), SUBNET_B_ID, RT_B_ID, [dropAll]),
        rdp,
      );
      expect(result.overallVerdict).toBe("allowed");
      expect(
        result.pathCandidates[0].hops.every((hop) => hop.routeVerdict == null),
      ).toBe(true);
    });

    it("keeps traffic inside the VNet on the VnetLocal system route", () => {
      const hop = sourceSubnetHop(
        withRoutes(twoSubnets([], []), SUBNET_ID, RT_ID, [dropAll]),
      );
      expect(hop.routeVerdict).toBe("allowed");
      expect(hop.routeNextHopType).toBe("VnetLocal");
    });

    it("applies a route more specific than the VNet over the system route", () => {
      const hop = sourceSubnetHop(
        withRoutes(twoSubnets([], []), SUBNET_ID, RT_ID, [
          routeEntry("to-firewall", {
            addressPrefix: "10.0.2.0/24",
            nextHopType: "VirtualAppliance",
            nextHopIp: "10.0.0.4",
          }),
        ]),
      );
      expect(hop.routeVerdict).toBe("unknown");
      expect(hop.routeName).toBe("to-firewall");
    });

    it("lets a route equal to the VNet prefix override the system route", () => {
      const hop = sourceSubnetHop(
        withRoutes(twoSubnets([], []), SUBNET_ID, RT_ID, [
          blackholeRoute("drop-vnet", { addressPrefix: "10.0.0.0/16" }),
        ]),
      );
      expect(hop.routeVerdict).toBe("blocked");
      expect(hop.routeName).toBe("drop-vnet");
    });

    it("drops traffic leaving the VNet on a source default black hole", () => {
      const hop = sourceSubnetHop(
        withRoutes(twoSubnets([], allowAllInbound), SUBNET_ID, RT_ID, [dropAll]),
        { ...rdp, destinationAddressPrefix: "52.1.2.3" },
      );
      expect(hop.routeVerdict).toBe("blocked");
      expect(hop.routeName).toBe("drop-all");
    });

    it("reaches a peered VNet on the VNetPeering system route", () => {
      const HUB_VNET_ID = `${BASE}/microsoft.network/virtualnetworks/vnet-hub`;
      const HUB_SUBNET_ID = `${HUB_VNET_ID}/subnets/snet-hub`;
      const HUB_NIC_ID = `${BASE}/microsoft.network/networkinterfaces/nic-hub`;
      const HUB_VM_ID = `${BASE}/microsoft.compute/virtualmachines/vm-hub`;
      const peering = (remoteId: string) => ({
        name: "peer",
        properties: {
          remoteVirtualNetwork: { id: remoteId },
          peeringState: "Connected",
          allowVirtualNetworkAccess: true,
        },
      });
      const resources = [
        resource(VNET_ID, "Microsoft.Network/virtualNetworks", {
          addressSpace: { addressPrefixes: ["10.0.0.0/16"] },
          subnets: [{ id: SUBNET_ID }],
          virtualNetworkPeerings: [peering(HUB_VNET_ID)],
        }),
        resource(SUBNET_ID, "Microsoft.Network/virtualNetworks/subnets", {
          addressPrefix: "10.0.1.0/24",
          routeTable: { id: RT_ID },
        }),
        routeTableResource(RT_ID, {
          routes: [dropAll],
          subnets: [{ id: SUBNET_ID }],
        }),
        resource(HUB_VNET_ID, "Microsoft.Network/virtualNetworks", {
          addressSpace: { addressPrefixes: ["10.1.0.0/16"] },
          subnets: [{ id: HUB_SUBNET_ID }],
          virtualNetworkPeerings: [peering(VNET_ID)],
        }),
        resource(HUB_SUBNET_ID, "Microsoft.Network/virtualNetworks/subnets", {
          addressPrefix: "10.1.1.0/24",
        }),
        ...vm(VM_ID, NIC_ID, SUBNET_ID),
        ...vm(HUB_VM_ID, HUB_NIC_ID, HUB_SUBNET_ID),
      ];
      const hop = sourceSubnetHop(resources, {
        ...rdp,
        destinationResourceId: HUB_VM_ID,
        destinationAddressPrefix: "10.1.1.4",
      });
      expect(hop.routeVerdict).toBe("allowed");
      expect(hop.routeNextHopType).toBe("VNetPeering");
    });
  });
});

describe("NSG direction on paths without a subnet hop", () => {
  const PIP = `${BASE}/microsoft.network/publicipaddresses/pip-app`;
  const NIC_NSG_ID = `${BASE}/microsoft.network/networksecuritygroups/nsg-nic`;
  function publicVm(rules: readonly Record<string, unknown>[]) {
    return [
      resource(VNET_ID, "Microsoft.Network/virtualNetworks", {
        addressSpace: { addressPrefixes: ["10.0.0.0/16"] },
        subnets: [{ id: SUBNET_ID }],
      }),
      resource(SUBNET_ID, "Microsoft.Network/virtualNetworks/subnets", {
        addressPrefix: "10.0.1.0/24",
      }),
      nsgResource(NIC_NSG_ID, {
        securityRules: rules,
        networkInterfaces: [{ id: NIC_ID }],
      }),
      resource(NIC_ID, "Microsoft.Network/networkInterfaces", {
        networkSecurityGroup: { id: NIC_NSG_ID },
        ipConfigurations: [
          {
            name: "ipconfig1",
            id: `${NIC_ID}/ipConfigurations/ipconfig1`,
            properties: {
              subnet: { id: SUBNET_ID },
              publicIPAddress: { id: PIP },
            },
          },
        ],
      }),
      resource(PIP, "Microsoft.Network/publicIPAddresses", {
        ipAddress: "203.0.113.10",
        ipConfiguration: { id: `${NIC_ID}/ipConfigurations/ipconfig1` },
      }),
      resource(VM_ID, "Microsoft.Compute/virtualMachines", {
        networkProfile: { networkInterfaces: [{ id: NIC_ID }] },
      }),
    ];
  }
  const nicHop = (result: ReturnType<typeof analyzePath>) =>
    result.pathCandidates[0].hops.find((hop) => hop.resourceId === NIC_ID)!;

  it("applies only inbound rules to the VM's NIC for traffic arriving on its public IP", () => {
    const result = analyzePath(
      publicVm([
        allowRule("allow-rdp", { direction: "inbound", priority: 100 }),
      ]),
      {
        sourceResourceId: PIP,
        destinationResourceId: VM_ID,
        protocol: "Tcp",
        sourceAddressPrefix: "198.51.100.7",
        destinationAddressPrefix: "10.0.1.4",
        destinationPort: 3389,
      },
    );
    expect(result.pathCandidates[0].hops.map((hop) => hop.hopType)).toEqual([
      "public_ip",
      "nic",
      "vm",
    ]);
    expect(result.overallVerdict).toBe("allowed");
    expect(nicHop(result).nsgDirection).toBe("inbound");
    expect(nicHop(result).nsgOutboundVerdict).toBeNull();
  });

  it("applies only outbound rules to the VM's NIC for traffic leaving through its public IP", () => {
    const result = analyzePath(
      publicVm([denyRule("deny-all-in", { direction: "inbound", priority: 100 })]),
      {
        sourceResourceId: VM_ID,
        destinationResourceId: PIP,
        protocol: "Tcp",
        sourceAddressPrefix: "10.0.1.4",
        destinationAddressPrefix: "8.8.8.8",
        destinationPort: 443,
      },
    );
    expect(result.overallVerdict).toBe("allowed");
    expect(nicHop(result).nsgDirection).toBe("outbound");
  });
});

describe("NSG direction for hops outside both endpoints", () => {
  const NIC_B_ID = `${BASE}/microsoft.network/networkinterfaces/nic-b`;
  const VM_B_ID = `${BASE}/microsoft.compute/virtualmachines/vm-b`;
  const PIP_B_ID = `${BASE}/microsoft.network/publicipaddresses/pip-b`;
  const NSG_B_ID = `${BASE}/microsoft.network/networksecuritygroups/nsg-b`;
  function vmToNeighbourPublicIp(rules: readonly Record<string, unknown>[]) {
    return [
      resource(VNET_ID, "Microsoft.Network/virtualNetworks", {
        addressSpace: { addressPrefixes: ["10.0.0.0/16"] },
        subnets: [{ id: SUBNET_ID }],
      }),
      resource(SUBNET_ID, "Microsoft.Network/virtualNetworks/subnets", {
        addressPrefix: "10.0.1.0/24",
      }),
      resource(NIC_ID, "Microsoft.Network/networkInterfaces", {
        ipConfigurations: [
          { name: "ipconfig1", properties: { subnet: { id: SUBNET_ID } } },
        ],
      }),
      resource(VM_ID, "Microsoft.Compute/virtualMachines", {
        networkProfile: { networkInterfaces: [{ id: NIC_ID }] },
      }),
      nsgResource(NSG_B_ID, {
        securityRules: rules,
        networkInterfaces: [{ id: NIC_B_ID }],
      }),
      resource(NIC_B_ID, "Microsoft.Network/networkInterfaces", {
        networkSecurityGroup: { id: NSG_B_ID },
        ipConfigurations: [
          {
            name: "ipconfig1",
            properties: {
              subnet: { id: SUBNET_ID },
              publicIPAddress: { id: PIP_B_ID },
            },
          },
        ],
      }),
      resource(PIP_B_ID, "Microsoft.Network/publicIPAddresses", {
        ipAddress: "20.30.40.50",
      }),
      resource(VM_B_ID, "Microsoft.Compute/virtualMachines", {
        networkProfile: { networkInterfaces: [{ id: NIC_B_ID }] },
      }),
    ];
  }
  const query = {
    sourceResourceId: VM_ID,
    destinationResourceId: PIP_B_ID,
    protocol: "Tcp",
    sourceAddressPrefix: "10.0.1.4",
    destinationAddressPrefix: "20.30.40.50",
    destinationPort: 3389,
  };

  it("applies inbound rules to the NIC behind the destination public IP", () => {
    const result = analyzePath(
      vmToNeighbourPublicIp([
        denyRule("deny-rdp-in", { direction: "inbound", priority: 100 }),
      ]),
      query,
    );
    const hops = result.pathCandidates[0].hops;
    expect(hops.map((hop) => hop.hopType)).toEqual([
      "vm",
      "nic",
      "subnet",
      "nic",
      "public_ip",
    ]);
    expect(result.overallVerdict).toBe("blocked");
    const nicB = hops.find((hop) => hop.resourceId === NIC_B_ID)!;
    expect(nicB.nsgDirection).toBe("inbound");
    expect(nicB.nsgRuleName).toBe("deny-rdp-in");
    expect(nicB.nsgOutboundVerdict).toBeNull();
  });

  it("allows when that NIC's inbound rules allow", () => {
    const result = analyzePath(
      vmToNeighbourPublicIp([
        allowRule("allow-rdp-in", { direction: "inbound", priority: 100 }),
      ]),
      query,
    );
    expect(result.overallVerdict).toBe("allowed");
  });
});


describe("Gateway endpoint subnet direction", () => {
  function inventory(
    sourceId: string,
    rules: readonly Record<string, unknown>[] = [],
    routes: readonly Record<string, unknown>[] = [],
  ) {
    return [
      resource(VNET_ID, "Microsoft.Network/virtualNetworks", {
        addressSpace: { addressPrefixes: ["10.0.0.0/16"] },
        subnets: [{ id: APPGW_SUBNET_ID }, { id: BACKEND_SUBNET_ID }],
      }),
      resource(APPGW_SUBNET_ID, "Microsoft.Network/virtualNetworks/subnets", {
        addressPrefix: "10.0.1.0/24",
        networkSecurityGroup: { id: NSG_ID },
        ...(routes.length ? { routeTable: { id: RT_ID } } : {}),
      }),
      resource(BACKEND_SUBNET_ID, "Microsoft.Network/virtualNetworks/subnets", {
        addressPrefix: "10.0.2.0/24",
      }),
      nsgResource(NSG_ID, { securityRules: rules }),
      routeTableResource(RT_ID, { routes }),
      resource(sourceId, sourceId === APPGW_ID
        ? "Microsoft.Network/applicationGateways"
        : "Microsoft.Network/loadBalancers", {
        gatewayIPConfigurations: sourceId === APPGW_ID
          ? [{ properties: { subnet: { id: APPGW_SUBNET_ID } } }]
          : [],
        frontendIPConfigurations: [
          { properties: { subnet: { id: APPGW_SUBNET_ID }, privateIPAddress: "10.0.1.4" } },
        ],
      }),
      resource(NIC_ID, "Microsoft.Network/networkInterfaces", {
        ipConfigurations: [{ properties: { subnet: { id: BACKEND_SUBNET_ID } } }],
      }),
      resource(VM_ID, "Microsoft.Compute/virtualMachines", {
        networkProfile: { networkInterfaces: [{ id: NIC_ID }] },
      }),
    ];
  }
  const query = {
    sourceResourceId: APPGW_ID,
    destinationResourceId: VM_ID,
    protocol: "Tcp",
    sourceAddressPrefix: "10.0.1.4",
    destinationAddressPrefix: "10.0.2.4",
    destinationPort: 443,
  };
  function deny(direction: string) {
    const rule = denyRule(`deny-https-${direction}`, { direction, priority: 100 });
    return { ...rule, properties: { ...rule.properties, destinationPortRange: "443" } };
  }

  it.each(["gatewayIPConfigurations", "frontendIPConfigurations"])(
    "applies AppGW outbound denies through %s attachments",
    (configuration) => {
      const resources = inventory(APPGW_ID, [deny("outbound")]);
      if (configuration === "gatewayIPConfigurations") {
        // Usual AppGW layout: the gateway subnet holds only the gateway, and the backend
        // pool points at a NIC in another subnet. The pool relation skips the gateway
        // subnet, so the path must still include it on the source side.
        const gateway = resources.find((item) => item.id === APPGW_ID)!;
        gateway.properties.frontendIPConfigurations = [];
        gateway.properties.backendAddressPools = [
          { properties: { backendIPConfigurations: [{ id: `${NIC_ID}/ipconfigurations/ipconfig1` }] } },
        ];
      } else {
        resources.find((item) => item.id === APPGW_ID)!.properties.gatewayIPConfigurations = [];
      }
      const result = analyzePath(resources, query);
      expect(result.overallVerdict).toBe("blocked");
      const subnet = result.pathCandidates[0].hops.find((hop) => hop.resourceId === APPGW_SUBNET_ID)!;
      expect(subnet.nsgOutboundVerdict).toBe("blocked");
      expect(subnet.nsgDirection).toBe("outbound");
    },
  );

  it("puts the gateway subnet right after the gateway on a backend pool path", () => {
    const resources = inventory(APPGW_ID, [deny("outbound")]);
    const gateway = resources.find((item) => item.id === APPGW_ID)!;
    gateway.properties.frontendIPConfigurations = [];
    gateway.properties.backendAddressPools = [
      { properties: { backendIPConfigurations: [{ id: `${NIC_ID}/ipconfigurations/ipconfig1` }] } },
    ];
    const result = analyzePath(resources, query);
    const hops = result.pathCandidates[0].hops;
    expect(hops.map((hop) => hop.resourceId).slice(0, 2)).toEqual([APPGW_ID, APPGW_SUBNET_ID]);
    expect(hops.filter((hop) => hop.resourceId === APPGW_SUBNET_ID)).toHaveLength(1);
    expect(result.overallVerdict).toBe("blocked");
  });

  it("ignores inbound denies when leaving the AppGW subnet", () => {
    const result = analyzePath(inventory(APPGW_ID, [deny("inbound")]), query);
    expect(result.overallVerdict).not.toBe("blocked");
    const subnet = result.pathCandidates[0].hops.find((hop) => hop.resourceId === APPGW_SUBNET_ID)!;
    expect(subnet.nsgDirection).toBe("outbound");
  });

  it("applies the AppGW subnet route table and prefers VnetLocal for its backend", () => {
    const resources = inventory(APPGW_ID, [], [blackholeRoute("drop-default", { addressPrefix: "0.0.0.0/0" })]);
    const local = analyzePath(resources, query);
    expect(local.overallVerdict).not.toBe("blocked");
    const subnet = local.pathCandidates[0].hops.find((hop) => hop.resourceId === APPGW_SUBNET_ID)!;
    expect(subnet.routeNextHopType).toBe("VnetLocal");
    expect(subnet.routeVerdict).toBe("allowed");
    const outside = analyzePath(resources, { ...query, destinationAddressPrefix: "10.1.2.4" });
    expect(outside.overallVerdict).toBe("blocked");
    expect(outside.pathCandidates[0].hops.find((hop) => hop.resourceId === APPGW_SUBNET_ID)!.routeNextHopType).toBe("None");
  });

  it("does not apply the frontend subnet's outbound rules when an internal LB is the source", () => {
    // Load Balancer is pass-through; its frontend subnet NSG does not filter LB traffic.
    const result = analyzePath(inventory(INTERNAL_LB_ID, [deny("outbound")]), {
      ...query, sourceResourceId: INTERNAL_LB_ID,
    });
    expect(result.overallVerdict).not.toBe("blocked");
    const frontend = result.pathCandidates[0].hops.find((hop) => hop.resourceId === APPGW_SUBNET_ID)!;
    expect(frontend.nsgOutboundVerdict).toBeNull();
    expect(frontend.nsgVerdict).toBeNull();
  });

  it("keeps the frontend subnet's inbound rules when an internal LB is the destination", () => {
    // The path ends at the LB, so its backends are not on it; the frontend subnet is the only inbound check.
    const result = analyzePath(inventory(INTERNAL_LB_ID, [deny("inbound")]), {
      ...query,
      sourceResourceId: VM_ID,
      destinationResourceId: INTERNAL_LB_ID,
      sourceAddressPrefix: "10.0.2.4",
      destinationAddressPrefix: "10.0.1.4",
    });
    expect(result.overallVerdict).toBe("blocked");
    const frontend = result.pathCandidates[0].hops.find((hop) => hop.resourceId === APPGW_SUBNET_ID)!;
    expect(frontend.nsgVerdict).toBe("blocked");
  });

  it("keeps the frontend subnet's inbound rules when the source shares the destination LB's subnet", () => {
    const resources = inventory(INTERNAL_LB_ID, [deny("inbound")]);
    resources.find((item) => item.id === NIC_ID)!.properties.ipConfigurations = [
      { properties: { subnet: { id: APPGW_SUBNET_ID } } },
    ];
    const result = analyzePath(resources, {
      ...query,
      sourceResourceId: VM_ID,
      destinationResourceId: INTERNAL_LB_ID,
      sourceAddressPrefix: "10.0.1.5",
      destinationAddressPrefix: "10.0.1.4",
    });
    expect(result.overallVerdict).toBe("blocked");
    expect(result.pathCandidates[0].hops.find((hop) => hop.resourceId === APPGW_SUBNET_ID)!.nsgVerdict).toBe("blocked");
  });

  it("does not apply the frontend subnet's inbound rules when an internal LB is the source", () => {
    const result = analyzePath(inventory(INTERNAL_LB_ID, [deny("inbound")]), {
      ...query, sourceResourceId: INTERNAL_LB_ID,
    });
    expect(result.overallVerdict).not.toBe("blocked");
    const frontend = result.pathCandidates[0].hops.find((hop) => hop.resourceId === APPGW_SUBNET_ID)!;
    expect(frontend.nsgVerdict).toBeNull();
    expect(frontend.nsgOutboundVerdict).toBeNull();
  });
});

it("ADR-024: a resource-only query cannot bypass an unresolved address constraint", () => {
  const resources = [
    resource(VNET_ID, "microsoft.network/virtualnetworks", { addressSpace: { addressPrefixes: ["10.0.0.0/16"] }, subnets: [{ id: SUBNET_ID }] }),
    resource(SUBNET_ID, "microsoft.network/virtualnetworks/subnets", { networkSecurityGroup: { id: NSG_ID } }),
    resource(NIC_ID, "microsoft.network/networkinterfaces", { ipConfigurations: [{ properties: { subnet: { id: SUBNET_ID } } }] }),
    resource(VM_ID, "microsoft.compute/virtualmachines", { networkProfile: { networkInterfaces: [{ id: NIC_ID }] } }),
    nsgResource(NSG_ID, { securityRules: [allowRule("restricted", { sourcePrefix: "203.0.113.5/32" }), denyRule()] }),
  ];
  expect(analyzeSavedPath(resources, { sourceResourceId: VM_ID, destinationResourceId: SUBNET_ID, protocol: "tcp", destinationPort: 22 }).overallVerdict).toBe("unknown");
});

describe("saved topology/address evidence (ADR-024)", () => {
  const destNic = `${BASE}/microsoft.network/networkinterfaces/dest`;
  const destVm = `${BASE}/microsoft.compute/virtualmachines/dest`;
  const query = { sourceResourceId: VM_ID, destinationResourceId: destVm, protocol: "tcp", destinationPort: 443 };
  function inventory(ip = "10.0.1.4", dest = "10.0.1.5") {
    return [
      resource(VNET_ID, "microsoft.network/virtualnetworks", { addressSpace: { addressPrefixes: [ip.includes(":") ? "fd00::/64" : "10.0.0.0/16"] }, subnets: [{ id: SUBNET_ID }] }),
      resource(SUBNET_ID, "microsoft.network/virtualnetworks/subnets", { networkSecurityGroup: { id: NSG_ID }, routeTable: null }),
      nsgResource(NSG_ID, { securityRules: [allowRule("in"), allowRule("out", { direction: "outbound" })] }),
      ...[[VM_ID, NIC_ID, ip], [destVm, destNic, dest]].flatMap(([vm, nic, address]) => [
        resource(vm, "microsoft.compute/virtualmachines", { networkProfile: { networkInterfaces: [{ id: nic }] } }),
        resource(nic, "microsoft.network/networkinterfaces", { networkSecurityGroup: null, ipConfigurations: [{ properties: { privateIPAddress: address, subnet: { id: SUBNET_ID } } }] }),
      ]),
    ];
  }
  it("interprets omitted optional associations only with complete live provenance and observed properties", () => {
    const rows = inventory();
    for (const row of rows) {
      row.observedFields = ["properties"];
      delete row.properties.networkSecurityGroup;
      delete row.properties.routeTable;
    }
    const source = {...completeSnapshot.sourceScan, subscriptionIds: [rows[0].subscriptionId]};
    expect(diagnosePath(rows, query, source).verdict).toBe("allowed");
    expect(diagnosePath(rows, query).verdict).toBe("unknown");
    expect(diagnosePath(rows, query, {...source, source: "import", completeness: {state:"unknown", reasons:["import-scope-unverified"]}}).verdict).toBe("unknown");
    expect(diagnosePath(rows, query, {...source, completeness: {state:"partial", reasons:["collection-partial"]}}).verdict).toBe("unknown");
    delete rows.find(r => r.id === NIC_ID)!.observedFields;
    expect(diagnosePath(rows, query, source).verdict).toBe("unknown");
  });
  it.each([["10.0.1.4", "10.0.1.5"], ["fd00::4", "fd00::5"]])("resolves saved addresses and emits W0 evidence (%s)", (ip, dest) => {
    const result = diagnosePath(inventory(ip, dest), query);
    expect(result.verdict).toBe("allowed");
    expect(networkEngineResultSchema.safeParse(result).success).toBe(true);
    expect(result.paths[0].hops.flatMap(h => h.reasonCodes)).toContain("nsg-rule-decisive-allow");
    expect(result.paths[0].hops.flatMap(h => h.evidence).some(e => e.propertyPath.includes("securityRules/0/properties/access"))).toBe(true);
    expect(result.reasonCodes).toContain("single-candidate");
    expect(result.reasonCodes).toContain("effective-routes-not-collected");
    expect(result.paths[0].hops.flatMap(h => h.evidence).some(e => e.propertyPath.endsWith("privateIPAddress") && e.observation.state === "present" && e.observation.value === ip)).toBe(true);
  });
  it("resource-only legacy entry also resolves the saved source address", () => {
    const rows = inventory();
    rows.find(r => r.id === NSG_ID)!.properties.securityRules = [denyRule("deny-source", { direction: "outbound", priority: 100, sourcePrefix: "10.0.1.4" })];
    expect(analyzeSavedPath(rows, query).overallVerdict).toBe("blocked");
  });
  it.each(["missing", "mismatch", "family"])("never confirms an %s address", kind => {
    const rows = inventory();
    if (kind === "missing") rows.find(r => r.id === NIC_ID)!.properties.ipConfigurations = [{ properties: { subnet: { id: SUBNET_ID } } }];
    if (kind === "family") rows.find(r => r.id === destNic)!.properties.ipConfigurations = [{ properties: { subnet: { id: SUBNET_ID }, privateIPAddress: "fd00::5" } }];
    const result = diagnosePath(rows, { ...query, ...(kind === "mismatch" ? { sourceAddressPrefix: "203.0.113.9" } : {}) });
    expect(result.verdict).toBe("unknown");
    expect(result.reasonCodes).toContain(kind === "missing" ? "endpoint-address-unresolved" : kind === "mismatch" ? "endpoint-address-mismatch" : "address-family-mismatch");
  });
  it("preserves malformed associations and unsupported NVA evidence", () => {
    const rows = inventory();
    rows.find(r => r.id === SUBNET_ID)!.properties.routeTable = { id: RT_ID };
    rows.push(routeTableResource(RT_ID, { routes: [routeEntry("nva", { addressPrefix: "10.0.1.5/32", nextHopType: "VirtualAppliance", nextHopIp: "10.0.1.8" })] }));
    const result = diagnosePath(rows, query);
    expect(result.verdict).toBe("unknown");
    expect(result.reasonCodes).toContain("route-next-hop-virtual-appliance");
    expect(result.paths[0].hops.flatMap(h => h.evidence).some(e => e.propertyPath.endsWith("nextHopIpAddress"))).toBe(true);
    rows.find(r => r.id === SUBNET_ID)!.properties.networkSecurityGroup = { bad: "ref" };
    expect(diagnosePath(rows, query).reasonCodes).toContain("nsg-association-mismatch");
  });
  it("does not classify arbitrary children as routing nodes", () => {
    const child = resource(`${VNET_ID}/virtualnetworkpeerings/child`, "microsoft.network/virtualnetworks/virtualnetworkpeerings");
    const result = diagnosePath([child], { sourceResourceId: child.id, destinationResourceId: child.id });
    expect(result.paths[0].hops[0].hopType).toBe("other");
  });
  it.each([STORAGE_ID, INTERNAL_LB_ID, APPGW_ID])("does not bridge unpeered subnets through %s", bridge => {
    const rows = inventory();
    const vnet2 = `${VNET_ID}-other`, subnet2 = `${vnet2}/subnets/other`;
    rows.push(resource(vnet2, "microsoft.network/virtualnetworks", { subnets: [{ id: subnet2 }] }), resource(subnet2, "microsoft.network/virtualnetworks/subnets", { networkSecurityGroup: { id: NSG_ID }, routeTable: null }));
    rows.find(r => r.id === destNic)!.properties.ipConfigurations = [{ properties: { subnet: { id: subnet2 }, privateIPAddress: "10.1.1.5" } }];
    if (bridge === STORAGE_ID) {
      rows.push(resource(bridge, "microsoft.storage/storageaccounts"));
      for (const [id, subnet] of [[PEP_ID, SUBNET_ID], [`${PEP_ID}-other`, subnet2]]) rows.push(resource(id, "microsoft.network/privateendpoints", { subnet: { id: subnet }, privateLinkServiceConnections: [{ properties: { privateLinkServiceId: bridge } }] }));
    } else rows.push(resource(bridge, bridge === APPGW_ID ? "microsoft.network/applicationgateways" : "microsoft.network/loadbalancers", { frontendIPConfigurations: [{ properties: { subnet: { id: SUBNET_ID } } }], backendAddressPools: [{ properties: { backendIPConfigurations: [{ id: `${destNic}/ipconfigurations/default` }] } }] }));
    expect(diagnosePath(rows, query).verdict).toBe("unknown");
    expect(analyzeSavedPath(rows, { ...query, sourceAddressPrefix: "10.0.1.4", destinationAddressPrefix: "10.1.1.5" }).overallVerdict).toBe("unknown");
  });
  it.each(["Pending", "Rejected", "Approved"])("preserves private link %s and missing policy uncertainty", status => {
    const rows = inventory();
    rows.push(resource(PEP_ID, "microsoft.network/privateendpoints", { subnet: { id: SUBNET_ID }, customDnsConfigs: [{ ipAddresses: ["10.0.1.8"] }], privateLinkServiceConnections: [{ properties: { privateLinkServiceId: STORAGE_ID, privateLinkServiceConnectionState: { status } } }] }), resource(STORAGE_ID, "microsoft.storage/storageaccounts"));
    const q = { ...query, destinationResourceId: STORAGE_ID };
    const result = diagnosePath(rows, q);
    expect(result.verdict).toBe("unknown");
    expect(result.reasonCodes).toContain(status === "Approved" ? "missing-data" : "private-link-connection-not-approved");
    if (status === "Approved") {
      rows.find(r => r.id === SUBNET_ID)!.properties.privateEndpointNetworkPolicies = "Disabled";
      const disabled = diagnosePath(rows, q);
      expect(disabled.reasonCodes).toContain("nsg-not-applied-private-endpoint-policy");
      expect(disabled.paths[0].hops.flatMap(h => h.evidence).some(e => e.propertyPath.endsWith("privateEndpointNetworkPolicies"))).toBe(true);
    }
  });
  it("keeps reverse-only NSG associations unknown", () => {
    const rows = inventory();
    rows.find(r => r.id === SUBNET_ID)!.properties.networkSecurityGroup = null;
    rows.find(r => r.id === NSG_ID)!.properties.subnets = [{ id: SUBNET_ID }];
    const result = diagnosePath(rows, query);
    expect(result.verdict).toBe("unknown");
    expect(result.reasonCodes).toContain("nsg-association-mismatch");
  });
  it.each([[false, true], [true, false], [undefined, true], [true, undefined], [true, true]])(
    "includes peer NSG tag prefixes only with bidirectional access (%s, %s)", (forward, reverse) => {
      const rows = inventory();
      const peerId = `${VNET_ID}-peer`;
      const peering = (id: string, access: boolean | undefined) => ({ properties: {
        remoteVirtualNetwork: { id }, peeringState: "Connected", allowVirtualNetworkAccess: access,
      } });
      rows.find(r => r.id === VNET_ID)!.properties.virtualNetworkPeerings = [peering(peerId, forward)];
      rows.push(resource(peerId, "microsoft.network/virtualnetworks", {
        addressSpace: {addressPrefixes: ["172.16.0.0/16"]}, virtualNetworkPeerings: [peering(VNET_ID, reverse)],
      }));
      rows.find(r => r.id === NSG_ID)!.properties.securityRules = [allowRule("vnet", { sourcePrefix: "VirtualNetwork" })];
      // Legacy explicit traffic input isolates NSG tag membership from topology routing.
      const result = analyzeSavedPath(rows, { ...query, sourceAddressPrefix: "172.16.1.4", destinationAddressPrefix: "10.0.1.5" });
      const nsgHops = result.pathCandidates[0].hops.filter(hop => hop.nsgDirection === "inbound");
      expect(nsgHops.length).toBeGreaterThan(0);
      expect(nsgHops.every(hop => hop.nsgRuleName === "vnet")).toBe(forward === true && reverse === true);
    },
  );
  it("retains known own-VNet NSG membership when another peer lacks address space", () => {
    const rows = inventory();
    const peerId = `${VNET_ID}-peer`;
    const peering = (id: string) => ({ properties: { remoteVirtualNetwork: { id }, peeringState: "Connected", allowVirtualNetworkAccess: true } });
    rows.find(r => r.id === VNET_ID)!.properties.virtualNetworkPeerings = [peering(peerId)];
    rows.push(resource(peerId, "microsoft.network/virtualnetworks", { virtualNetworkPeerings: [peering(VNET_ID)] }));
    rows.find(r => r.id === NSG_ID)!.properties.securityRules = [allowRule("vnet", { sourcePrefix: "VirtualNetwork" })];
    const result = diagnosePath(rows, query);
    expect(result.verdict).toBe("allowed");
    expect(result.reasonCodes).not.toContain("virtual-network-scope-incomplete");
  });
  it.each(["Enabled", "Disabled", undefined])("applies PE inbound NSG only under collected policy %s", policy => {
    const rows = inventory();
    const subnet = rows.find(r => r.id === SUBNET_ID)!;
    if (policy) subnet.properties.privateEndpointNetworkPolicies = policy;
    rows.find(r => r.id === NSG_ID)!.properties.securityRules = [denyRule("deny-in", { direction: "inbound", priority: 100 }), allowRule("out", { direction: "outbound" })];
    rows.push(resource(PEP_ID, "microsoft.network/privateendpoints", { subnet: { id: SUBNET_ID }, customDnsConfigs: [{ ipAddresses: ["10.0.1.8"] }], privateLinkServiceConnections: [{ properties: { privateLinkServiceId: STORAGE_ID, privateLinkServiceConnectionState: { status: "Approved" } } }] }), resource(STORAGE_ID, "microsoft.storage/storageaccounts"));
    const result = diagnosePath(rows, { ...query, destinationResourceId: STORAGE_ID });
    expect(result.verdict).toBe(policy === "Enabled" ? "blocked" : policy === "Disabled" ? "allowed" : "unknown");
  });
  it("malformed route-table association cannot fall through to allowed", () => {
    const rows = inventory();
    rows.find(r => r.id === SUBNET_ID)!.properties.routeTable = {};
    expect(diagnosePath(rows, query).verdict).toBe("unknown");
  });

  it.each(["malformed", "tag", "missing-ref"])("stores %s as a coded unknown", kind => {
    const rows = inventory();
    const nsg = rows.find(r => r.id === NSG_ID)!;
    if (kind === "missing-ref") rows.splice(rows.indexOf(nsg), 1);
    else nsg.properties.securityRules = kind === "tag" ? [allowRule("tag", { sourcePrefix: "Storage.CanadaCentral" }), denyRule("otherwise-deny")]
      : [{ ...denyRule("bad", { priority: 100 }), properties: { ...denyRule().properties, priority: 100, destinationPortRange: 443 } }, allowRule("later", { priority: 200 })];
    const result = diagnosePath(rows, query);
    expect(result.verdict).toBe("unknown");
    expect(result.reasonCodes).toContain(kind === "malformed" ? "nsg-rule-malformed" : kind === "tag" ? "service-tag-unsupported" : "nsg-reference-missing");
    expect(networkEngineResultSchema.safeParse(result).success).toBe(true);
  });
  it.each([true, false])("retains both directions of peering access=%s", access => {
    const rows = inventory();
    const peerId = `${VNET_ID}-peer`, subnetId = `${peerId}/subnets/dest`;
    const peering = (id: string, allowed: boolean) => ({ properties: { remoteVirtualNetwork: { id }, peeringState: "Connected", allowVirtualNetworkAccess: allowed, allowForwardedTraffic: false } });
    rows.find(r => r.id === VNET_ID)!.properties.virtualNetworkPeerings = [peering(peerId, true)];
    rows.push(resource(peerId, "microsoft.network/virtualnetworks", { addressSpace: { addressPrefixes: ["10.1.0.0/16"] }, subnets: [{ id: subnetId }], virtualNetworkPeerings: [peering(VNET_ID, access)] }), resource(subnetId, "microsoft.network/virtualnetworks/subnets", { networkSecurityGroup: { id: NSG_ID }, routeTable: null }));
    rows.find(r => r.id === destNic)!.properties.ipConfigurations = [{ properties: { subnet: { id: subnetId }, privateIPAddress: "10.1.1.5" } }];
    const result = diagnosePath(rows, query);
    expect(result.verdict).toBe(access ? "allowed" : "unknown");
    if (access) {
      const evidence = result.paths[0].hops.flatMap(h => h.evidence).filter(e => e.propertyPath.endsWith("allowVirtualNetworkAccess"));
      expect(new Set(evidence.map(e => e.resourceId))).toEqual(new Set([VNET_ID, peerId]));
    } else expect(result.reasonCodes).toContain("peering-access-disabled");
    expect(networkEngineResultSchema.safeParse(result).success).toBe(true);
  });

});
