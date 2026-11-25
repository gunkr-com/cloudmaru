import { describe, expect, it } from "vitest";
import { analyzePath as analyzeSavedPath } from "./analyze-path";
import { classifyNsgVerdict } from "./nsg";
import { classifyRouteVerdict } from "./routes";
import {
  resource,
  nsgResource,
  allowRule,
  denyRule,
  routeTableResource,
  routeEntry,
  blackholeRoute,
  BASE,
  VNET_ID,
  SUBNET_ID,
  NSG_ID,
  RT_ID,
  NIC_ID,
  VM_ID,
} from "./fixtures.test-data";

// ADR-024: legacy allow/deny fixtures describe explicit traffic; unresolved queries
// are covered separately in the NSG/route regressions and phase15 endpoint tests.
const analyzePath: typeof analyzeSavedPath = (resources, query) => analyzeSavedPath(resources, {
  protocol: "Tcp", sourceAddressPrefix: "10.0.1.4", destinationAddressPrefix: "10.0.2.4", ...query,
});

describe("TestOutboundNSGDirection", () => {
  function resourcesWithSeparateNsgs() {
    const SOURCE_SUBNET_ID = `${BASE}/microsoft.network/virtualnetworks/vnet-app/subnets/snet-source`;
    const DEST_SUBNET_ID = `${BASE}/microsoft.network/virtualnetworks/vnet-app/subnets/snet-dest`;
    const SOURCE_NSG_ID = `${BASE}/microsoft.network/networksecuritygroups/nsg-source`;
    const DEST_NSG_ID = `${BASE}/microsoft.network/networksecuritygroups/nsg-dest`;
    const SOURCE_NIC_ID = `${BASE}/microsoft.network/networkinterfaces/nic-source`;
    const DEST_NIC_ID = `${BASE}/microsoft.network/networkinterfaces/nic-dest`;
    const SOURCE_VM_ID = `${BASE}/microsoft.compute/virtualmachines/vm-source`;
    const DEST_VM_ID = `${BASE}/microsoft.compute/virtualmachines/vm-dest`;
    return [
      resource(VNET_ID, "Microsoft.Network/virtualNetworks", {
        addressSpace: { addressPrefixes: ["10.0.0.0/16"] },
        subnets: [{ id: SOURCE_SUBNET_ID }, { id: DEST_SUBNET_ID }],
      }),
      resource(SOURCE_SUBNET_ID, "Microsoft.Network/virtualNetworks/subnets", {
        networkSecurityGroup: { id: SOURCE_NSG_ID },
      }),
      resource(DEST_SUBNET_ID, "Microsoft.Network/virtualNetworks/subnets", {
        networkSecurityGroup: { id: DEST_NSG_ID },
      }),
      nsgResource(SOURCE_NSG_ID, {
        securityRules: [
          denyRule("deny-outbound-all", {
            priority: 100,
            direction: "outbound",
          }),
        ],
      }),
      nsgResource(DEST_NSG_ID, {
        securityRules: [
          allowRule("allow-inbound-all", {
            priority: 100,
            direction: "inbound",
          }),
        ],
      }),
      resource(SOURCE_NIC_ID, "Microsoft.Network/networkInterfaces", {
        ipConfigurations: [
          {
            name: "ipconfig1",
            properties: { subnet: { id: SOURCE_SUBNET_ID } },
          },
        ],
      }),
      resource(DEST_NIC_ID, "Microsoft.Network/networkInterfaces", {
        ipConfigurations: [
          { name: "ipconfig1", properties: { subnet: { id: DEST_SUBNET_ID } } },
        ],
      }),
      resource(SOURCE_VM_ID, "Microsoft.Compute/virtualMachines", {
        networkProfile: { networkInterfaces: [{ id: SOURCE_NIC_ID }] },
      }),
      resource(DEST_VM_ID, "Microsoft.Compute/virtualMachines", {
        networkProfile: { networkInterfaces: [{ id: DEST_NIC_ID }] },
      }),
    ];
  }
  it("test_source_hop_evaluates_outbound_nsg", () => {
    const resources = resourcesWithSeparateNsgs();
    const result = analyzePath(resources, {
      sourceResourceId: `${BASE}/microsoft.compute/virtualmachines/vm-source`,
      destinationResourceId: `${BASE}/microsoft.compute/virtualmachines/vm-dest`,
    });
    expect(result.overallVerdict === "blocked").toBeTruthy();
  });
  it("test_outbound_deny_overrides_inbound_allow", () => {
    const resources = resourcesWithSeparateNsgs();
    const result = analyzePath(resources, {
      sourceResourceId: `${BASE}/microsoft.compute/virtualmachines/vm-source`,
      destinationResourceId: `${BASE}/microsoft.compute/virtualmachines/vm-dest`,
    });
    expect(result.overallVerdict === "blocked").toBeTruthy();
  });
  it("test_hop_has_outbound_verdict_fields", () => {
    const resources = resourcesWithSeparateNsgs();
    const result = analyzePath(resources, {
      sourceResourceId: `${BASE}/microsoft.compute/virtualmachines/vm-source`,
      destinationResourceId: `${BASE}/microsoft.compute/virtualmachines/vm-dest`,
    });
    if (result.pathCandidates.length > 0) {
      const candidate = result.pathCandidates[0];
      const hopsWithOutbound = candidate.hops.filter(
        (h) => h.nsgOutboundVerdict != null,
      );
      expect(hopsWithOutbound.length > 0).toBeTruthy();
    }
  });
  it("test_inbound_allow_with_outbound_allow", () => {
    const SOURCE_SUBNET_ID = `${BASE}/microsoft.network/virtualnetworks/vnet-app/subnets/snet-source`;
    const DEST_SUBNET_ID = `${BASE}/microsoft.network/virtualnetworks/vnet-app/subnets/snet-dest`;
    const NSG_ID_SHARED = `${BASE}/microsoft.network/networksecuritygroups/nsg-shared`;
    const SOURCE_NIC_ID = `${BASE}/microsoft.network/networkinterfaces/nic-source`;
    const DEST_NIC_ID = `${BASE}/microsoft.network/networkinterfaces/nic-dest`;
    const SOURCE_VM_ID = `${BASE}/microsoft.compute/virtualmachines/vm-source`;
    const DEST_VM_ID = `${BASE}/microsoft.compute/virtualmachines/vm-dest`;
    const nsgBoth = nsgResource(NSG_ID_SHARED, {
      securityRules: [
        allowRule("allow-in", { priority: 100, direction: "inbound" }),
        allowRule("allow-out", { priority: 100, direction: "outbound" }),
      ],
    });
    const resources = [
      resource(VNET_ID, "Microsoft.Network/virtualNetworks", {
        addressSpace: { addressPrefixes: ["10.0.0.0/16"] },
        subnets: [{ id: SOURCE_SUBNET_ID }, { id: DEST_SUBNET_ID }],
      }),
      resource(SOURCE_SUBNET_ID, "Microsoft.Network/virtualNetworks/subnets", {
        networkSecurityGroup: { id: NSG_ID_SHARED },
      }),
      resource(DEST_SUBNET_ID, "Microsoft.Network/virtualNetworks/subnets", {
        networkSecurityGroup: { id: NSG_ID_SHARED },
      }),
      nsgBoth,
      resource(SOURCE_NIC_ID, "Microsoft.Network/networkInterfaces", {
        ipConfigurations: [
          {
            name: "ipconfig1",
            properties: { subnet: { id: SOURCE_SUBNET_ID } },
          },
        ],
      }),
      resource(DEST_NIC_ID, "Microsoft.Network/networkInterfaces", {
        ipConfigurations: [
          { name: "ipconfig1", properties: { subnet: { id: DEST_SUBNET_ID } } },
        ],
      }),
      resource(SOURCE_VM_ID, "Microsoft.Compute/virtualMachines", {
        networkProfile: { networkInterfaces: [{ id: SOURCE_NIC_ID }] },
      }),
      resource(DEST_VM_ID, "Microsoft.Compute/virtualMachines", {
        networkProfile: { networkInterfaces: [{ id: DEST_NIC_ID }] },
      }),
    ];
    const result = analyzePath(resources, {
      sourceResourceId: SOURCE_VM_ID,
      destinationResourceId: DEST_VM_ID,
    });
    expect(result.overallVerdict === "allowed").toBeTruthy();
  });
});

describe("TestEffectiveNSGComposition", () => {
  function resourcesWithNicAndSubnetNsgs({
    nicRules,
    subnetRules,
  }: {
    nicRules: readonly Record<string, unknown>[];
    subnetRules: readonly Record<string, unknown>[];
  }) {
    const nicNsgId = `${BASE}/microsoft.network/networksecuritygroups/nsg-nic`;
    const subnetNsgId = `${BASE}/microsoft.network/networksecuritygroups/nsg-subnet`;
    return [
      resource(VNET_ID, "Microsoft.Network/virtualNetworks", {
        addressSpace: { addressPrefixes: ["10.0.0.0/16"] },
        subnets: [{ id: SUBNET_ID }],
      }),
      resource(SUBNET_ID, "Microsoft.Network/virtualNetworks/subnets", {
        networkSecurityGroup: { id: subnetNsgId },
      }),
      nsgResource(nicNsgId, { securityRules: nicRules }),
      nsgResource(subnetNsgId, { securityRules: subnetRules }),
      resource(NIC_ID, "Microsoft.Network/networkInterfaces", {
        networkSecurityGroup: { id: nicNsgId },
        ipConfigurations: [
          { name: "ipconfig1", properties: { subnet: { id: SUBNET_ID } } },
        ],
      }),
      resource(VM_ID, "Microsoft.Compute/virtualMachines", {
        networkProfile: { networkInterfaces: [{ id: NIC_ID }] },
      }),
    ];
  }
  it("test_subnet_deny_blocks_even_when_nic_allows", () => {
    const resources = resourcesWithNicAndSubnetNsgs({
      nicRules: [
        allowRule("nic-allow", { priority: 100, direction: "inbound" }),
      ],
      subnetRules: [
        denyRule("subnet-deny", { priority: 100, direction: "inbound" }),
      ],
    });
    const result = analyzePath(resources, {
      sourceResourceId: VM_ID,
      destinationResourceId: SUBNET_ID,
    });
    expect(result.overallVerdict === "blocked").toBeTruthy();
  });
  it("test_nic_deny_blocks_even_when_subnet_allows", () => {
    const resources = resourcesWithNicAndSubnetNsgs({
      nicRules: [denyRule("nic-deny", { priority: 100, direction: "inbound" })],
      subnetRules: [
        allowRule("subnet-allow", { priority: 100, direction: "inbound" }),
      ],
    });
    const result = analyzePath(resources, {
      sourceResourceId: SUBNET_ID,
      destinationResourceId: VM_ID,
    });
    expect(result.overallVerdict === "blocked").toBeTruthy();
  });
});

describe("TestServiceTagInNSGVerdict", () => {
  it("test_nsg_rule_with_virtualnetwork_tag_allows_vnet_address", () => {
    const nsg = nsgResource(NSG_ID, {
      securityRules: [
        {
          name: "allow-vnet-in",
          properties: {
            direction: "Inbound",
            access: "Allow",
            priority: 100,
            sourceAddressPrefix: "VirtualNetwork",
            destinationAddressPrefix: "*",
            sourcePortRange: "*",
            destinationPortRange: "*",
            protocol: "*",
          },
        },
      ],
    });
    const resources = [
      resource(VNET_ID, "Microsoft.Network/virtualNetworks", {
        addressSpace: { addressPrefixes: ["10.0.0.0/16"] },
        subnets: [{ id: SUBNET_ID }],
      }),
      resource(SUBNET_ID, "Microsoft.Network/virtualNetworks/subnets", {
        networkSecurityGroup: { id: NSG_ID },
      }),
      nsg,
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
      sourceAddressPrefix: "10.0.2.4/32",
    });
    expect(["allowed", "unknown"].includes(result.overallVerdict)).toBeTruthy();
  });
  it("test_nsg_rule_name_reports_actual_winning_rule", () => {
    const nsg = nsgResource(NSG_ID, {
      securityRules: [
        denyRule("deny-public-in", {
          priority: 100,
          sourcePrefix: "203.0.113.0/24",
        }),
      ],
    });
    const resources = [
      resource(VNET_ID, "Microsoft.Network/virtualNetworks", {
        addressSpace: { addressPrefixes: ["10.0.0.0/16"] },
        subnets: [{ id: SUBNET_ID }],
      }),
      resource(SUBNET_ID, "Microsoft.Network/virtualNetworks/subnets", {
        networkSecurityGroup: { id: NSG_ID },
      }),
      nsg,
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
      sourceAddressPrefix: "10.0.2.4/32",
      destinationAddressPrefix: "10.0.2.5/32",
    });
    const subnetHop = result.pathCandidates[0].hops.find(
      (h) => h.resourceId === SUBNET_ID,
    )!;
    expect(subnetHop.nsgVerdict === "allowed").toBeTruthy();
    expect(subnetHop.nsgRuleName === "AllowVnetInBound").toBeTruthy();
  });
  it("test_nsg_rule_with_internet_tag_blocks_internet_source", () => {
    const nsg = nsgResource(NSG_ID, {
      securityRules: [
        {
          name: "deny-internet-in",
          properties: {
            direction: "Inbound",
            access: "Deny",
            priority: 100,
            sourceAddressPrefix: "Internet",
            destinationAddressPrefix: "*",
            sourcePortRange: "*",
            destinationPortRange: "*",
            protocol: "*",
          },
        },
      ],
    });
    const resources = [
      resource(VNET_ID, "Microsoft.Network/virtualNetworks", {
        addressSpace: { addressPrefixes: ["10.0.0.0/16"] },
        subnets: [{ id: SUBNET_ID }],
      }),
      resource(SUBNET_ID, "Microsoft.Network/virtualNetworks/subnets", {
        networkSecurityGroup: { id: NSG_ID },
      }),
      nsg,
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
      sourceAddressPrefix: "8.8.8.8/32",
    });
    expect(result.overallVerdict === "blocked").toBeTruthy();
  });
});

describe("TestRouteNextHopEvidence", () => {
  function resourcesWithRouteNextHop({
    routeName = "to-firewall",
    nextHopType = "VirtualAppliance",
    nextHopIp = "10.0.0.1",
  }: {
    routeName?: string;
    nextHopType?: string;
    nextHopIp?: string | null;
  } = {}) {
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
        routes: [
          routeEntry(routeName, {
            addressPrefix: "10.0.0.0/16",
            nextHopType: nextHopType,
            nextHopIp: nextHopIp,
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
  }
  it("test_route_next_hop_type_populated_on_subnet_hop", () => {
    const resources = resourcesWithRouteNextHop();
    const result = analyzePath(resources, {
      sourceResourceId: VM_ID,
      destinationResourceId: SUBNET_ID,
    });
    const subnetHop = result.pathCandidates[0].hops.find(
      (h) => h.resourceId === SUBNET_ID,
    )!;
    expect(subnetHop != null).toBeTruthy();
    expect(subnetHop.routeNextHopType === "VirtualAppliance").toBeTruthy();
  });
  it("test_route_next_hop_ip_populated", () => {
    const resources = resourcesWithRouteNextHop({ nextHopIp: "10.0.0.1" });
    const result = analyzePath(resources, {
      sourceResourceId: VM_ID,
      destinationResourceId: SUBNET_ID,
    });
    const subnetHop = result.pathCandidates[0].hops.find(
      (h) => h.resourceId === SUBNET_ID,
    )!;
    expect(subnetHop != null).toBeTruthy();
    expect(subnetHop.routeNextHopIp === "10.0.0.1").toBeTruthy();
  });
  it("test_route_next_hop_ip_none_when_absent", () => {
    const resources = resourcesWithRouteNextHop({
      nextHopType: "VnetLocal",
      nextHopIp: null,
    });
    const result = analyzePath(resources, {
      sourceResourceId: VM_ID,
      destinationResourceId: SUBNET_ID,
    });
    const subnetHop = result.pathCandidates[0].hops.find(
      (h) => h.resourceId === SUBNET_ID,
    )!;
    expect(subnetHop != null).toBeTruthy();
    expect(subnetHop.routeNextHopType === "VnetLocal").toBeTruthy();
    expect(subnetHop.routeNextHopIp == null).toBeTruthy();
  });
  it("test_verdict_reason_includes_next_hop_type", () => {
    const resources = resourcesWithRouteNextHop();
    const result = analyzePath(resources, {
      sourceResourceId: VM_ID,
      destinationResourceId: SUBNET_ID,
    });
    const reason = result.pathCandidates[0].reason;
    expect(
      reason.includes("VirtualAppliance") || reason.includes("via"),
    ).toBeTruthy();
  });
  it("test_blackhole_route_next_hop_type_is_none", () => {
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
    const subnetHop = result.pathCandidates[0].hops.find(
      (h) => h.resourceId === SUBNET_ID,
    )!;
    expect(subnetHop != null).toBeTruthy();
    expect(subnetHop.routeNextHopType === "None").toBeTruthy();
    expect(result.overallVerdict === "blocked").toBeTruthy();
  });
});

describe("TestSourcePortAndAddressFiltering", () => {
  it("test_source_port_blocks_path_through_nsg", () => {
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
          denyRule("deny-ephemeral-src", {
            priority: 100,
            direction: "inbound",
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
      sourcePort: 50000,
    });
    expect(result.overallVerdict === "blocked").toBeTruthy();
  });
  it("test_source_address_prefix_filtering_through_path", () => {
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
          {
            name: "allow-vnet-only",
            properties: {
              direction: "Inbound",
              access: "Allow",
              priority: 100,
              sourceAddressPrefix: "10.0.0.0/16",
              destinationAddressPrefix: "*",
              sourcePortRange: "*",
              destinationPortRange: "*",
              protocol: "*",
            },
          },
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
      sourceAddressPrefix: "10.0.2.4/32",
    });
    expect(result.overallVerdict === "allowed").toBeTruthy();
  });
  it("test_virtual_appliance_route_through_full_path", () => {
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
          routeEntry("to-fw", {
            addressPrefix: "10.0.0.0/16",
            nextHopType: "VirtualAppliance",
            nextHopIp: "10.0.0.1",
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
      destinationAddressPrefix: "10.0.0.5/32",
    });
    expect(result.overallVerdict === "unknown").toBeTruthy();
    const subnetHop = result.pathCandidates[0].hops.find(
      (h) => h.resourceId === SUBNET_ID,
    )!;
    expect(subnetHop != null).toBeTruthy();
    expect(subnetHop.routeNextHopType === "VirtualAppliance").toBeTruthy();
    expect(subnetHop.routeNextHopIp === "10.0.0.1").toBeTruthy();
  });
  it("test_protocol_and_port_combined_through_path", () => {
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
          {
            name: "allow-https-only",
            properties: {
              direction: "Inbound",
              access: "Allow",
              priority: 100,
              sourceAddressPrefix: "*",
              destinationAddressPrefix: "*",
              sourcePortRange: "*",
              destinationPortRange: "443",
              protocol: "Tcp",
            },
          },
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
      protocol: "Tcp",
      sourcePort: 50000,
      destinationPort: 443,
    });
    expect(result.overallVerdict === "allowed").toBeTruthy();
    const result2 = analyzePath(resources, {
      sourceResourceId: VM_ID,
      destinationResourceId: SUBNET_ID,
      protocol: "Udp",
      sourceAddressPrefix: "203.0.113.10/32",
      destinationAddressPrefix: "10.2.0.4/32",
      sourcePort: 50000,
      destinationPort: 443,
    });
    expect(result2.overallVerdict === "blocked").toBeTruthy();
  });
});

describe("TestPeeringTraversalMetadata", () => {
  function directPeeringResources({
    allowForwarded = null,
    localAllowVirtualNetworkAccess = null,
    remoteAllowVirtualNetworkAccess = null,
  }: {
    allowForwarded?: boolean | null;
    localAllowVirtualNetworkAccess?: boolean | null;
    remoteAllowVirtualNetworkAccess?: boolean | null;
  } = {}) {
    const remoteVnetId = `${BASE}/microsoft.network/virtualnetworks/vnet-remote`;
    const remoteSubnetId = `${remoteVnetId}/subnets/snet-remote`;
    const remoteNicId = `${BASE}/microsoft.network/networkinterfaces/nic-remote`;
    const remoteVmId = `${BASE}/microsoft.compute/virtualmachines/vm-remote`;
    const localPeeringProps: Record<string, unknown> = {
      remoteVirtualNetwork: { id: remoteVnetId },
      peeringState: "Connected",
    };
    const remotePeeringProps: Record<string, unknown> = {
      remoteVirtualNetwork: { id: VNET_ID },
      peeringState: "Connected",
    };
    if (allowForwarded != null) {
      localPeeringProps["allowForwardedTraffic"] = allowForwarded;
      remotePeeringProps["allowForwardedTraffic"] = allowForwarded;
    }
    if (localAllowVirtualNetworkAccess != null) {
      localPeeringProps["allowVirtualNetworkAccess"] =
        localAllowVirtualNetworkAccess;
    }
    if (remoteAllowVirtualNetworkAccess != null) {
      remotePeeringProps["allowVirtualNetworkAccess"] =
        remoteAllowVirtualNetworkAccess;
    }
    const resources = [
      resource(VNET_ID, "Microsoft.Network/virtualNetworks", {
        subnets: [{ id: SUBNET_ID }],
        virtualNetworkPeerings: [{ properties: localPeeringProps }],
      }),
      resource(SUBNET_ID, "Microsoft.Network/virtualNetworks/subnets", {}),
      resource(remoteVnetId, "Microsoft.Network/virtualNetworks", {
        subnets: [{ id: remoteSubnetId }],
        virtualNetworkPeerings: [{ properties: remotePeeringProps }],
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
    return [resources, remoteVmId, SUBNET_ID] as const;
  }
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
  } = {}) {
    const hubVnetId = `${BASE}/microsoft.network/virtualnetworks/vnet-hub`;
    const spokeVnetId = `${BASE}/microsoft.network/virtualnetworks/vnet-spoke`;
    const hubSubnetId = `${hubVnetId}/subnets/snet-hub`;
    const spokeSubnetId = `${spokeVnetId}/subnets/snet-spoke`;
    const spokeNicId = `${BASE}/microsoft.network/networkinterfaces/nic-spoke`;
    const spokeVmId = `${BASE}/microsoft.compute/virtualmachines/vm-spoke`;
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
    ] as const;
  }
  it("test_intra_vnet_path_has_no_peering_metadata", () => {
    const [resources, ,] = directPeeringResources();
    const localNicId = `${BASE}/microsoft.network/networkinterfaces/nic-local`;
    const localVmId = `${BASE}/microsoft.compute/virtualmachines/vm-local`;
    const localResources = [
      ...resources,
      ...[
        resource(localNicId, "Microsoft.Network/networkInterfaces", {
          ipConfigurations: [
            { name: "ipconfig1", properties: { subnet: { id: SUBNET_ID } } },
          ],
        }),
        resource(localVmId, "Microsoft.Compute/virtualMachines", {
          networkProfile: { networkInterfaces: [{ id: localNicId }] },
        }),
      ],
    ];
    const result = analyzePath(localResources, {
      sourceResourceId: localVmId,
      destinationResourceId: SUBNET_ID,
    });
    expect(result.pathCandidates.length > 0).toBeTruthy();
    const candidate = result.pathCandidates[0];
    expect(candidate.peeringHopCount === 0).toBeTruthy();
    expect(candidate.isForwardedTraffic == null).toBeTruthy();
    expect(
      !candidate.hops.map((hop) => hop.isPeeringBoundary).some(Boolean),
    ).toBeTruthy();
  });
  it("test_direct_peering_path_has_peering_hop_count_1", () => {
    const [resources, remoteVmId] = directPeeringResources({
      allowForwarded: false,
    });
    const result = analyzePath(resources, {
      sourceResourceId: remoteVmId,
      destinationResourceId: SUBNET_ID,
    });
    expect(result.pathCandidates.length > 0).toBeTruthy();
    const candidate = result.pathCandidates[0];
    expect(candidate.peeringHopCount === 1).toBeTruthy();
    expect(candidate.isForwardedTraffic === false).toBeTruthy();
  });
  it("test_direct_peering_path_marks_peering_boundary", () => {
    const [resources, remoteVmId] = directPeeringResources({
      allowForwarded: false,
    });
    const result = analyzePath(resources, {
      sourceResourceId: remoteVmId,
      destinationResourceId: SUBNET_ID,
    });
    expect(result.pathCandidates.length > 0).toBeTruthy();
    const candidate = result.pathCandidates[0];
    const peeringBoundaryHops = candidate.hops.filter(
      (h) => h.isPeeringBoundary,
    );
    expect(peeringBoundaryHops.length).toBeGreaterThan(0);
    expect(
      peeringBoundaryHops.map((h) => h.hopType === "vnet").every(Boolean),
    ).toBeTruthy();
  });
  it("test_direct_peering_path_blocks_when_source_direction_disallows_virtual_network_access", () => {
    const [resources, remoteVmId] = directPeeringResources({
      allowForwarded: false,
      remoteAllowVirtualNetworkAccess: false,
    });
    const result = analyzePath(resources, {
      sourceResourceId: remoteVmId,
      destinationResourceId: SUBNET_ID,
    });
    expect(result.overallVerdict === "unknown").toBeTruthy();
    expect(result.pathCandidates.length === 0).toBeTruthy();
    expect(
      result.warnings.at(-1)!.includes("No network path found"),
    ).toBeTruthy();
  });
  it("test_transitive_peering_path_has_peering_hop_count_2", () => {
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
    expect(result.pathCandidates.length > 0).toBeTruthy();
    const candidate = result.pathCandidates[0];
    expect(candidate.peeringHopCount === 2).toBeTruthy();
    expect(candidate.isForwardedTraffic === true).toBeTruthy();
  });
  it("test_transitive_peering_path_marks_multiple_peering_boundaries", () => {
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
    expect(result.pathCandidates.length > 0).toBeTruthy();
    const candidate = result.pathCandidates[0];
    const peeringBoundaryHops = candidate.hops.filter(
      (h) => h.isPeeringBoundary,
    );
    expect(peeringBoundaryHops.length >= 2).toBeTruthy();
  });
  it("test_no_path_produces_no_peering_metadata", () => {
    const [resources, spokeVmId] = transitivePeeringResources({
      targetToHub: null,
      hubToTarget: null,
      hubToSpoke: null,
      spokeToHub: null,
    });
    const result = analyzePath(resources, {
      sourceResourceId: spokeVmId,
      destinationResourceId: SUBNET_ID,
    });
    expect(result.overallVerdict === "unknown").toBeTruthy();
    expect(result.pathCandidates.length === 0).toBeTruthy();
  });
});

describe("TestServiceTagIntegration", () => {
  it("test_nsg_rule_with_virtualnetwork_source_allows_rfc1918", () => {
    const rules = [
      {
        protocol: "*", sourcePortRange: "*", destinationPortRange: "*", destinationAddressPrefix: "*",
        direction: "inbound",
        access: "allow",
        priority: 100,
        name: "allow-vnet",
        sourceAddressPrefix: "VirtualNetwork",
      },
    ];
    const verdict = classifyNsgVerdict(rules, {
      direction: "inbound",
      sourceAddressPrefix: "10.0.2.4/32",
      virtualNetworkPrefixes: ["10.0.0.0/16"],
    });
    expect(verdict === "allowed").toBeTruthy();
  });
  it("test_nsg_rule_with_virtualnetwork_source_blocks_public_ip", () => {
    const rules = [
      {
        protocol: "*", sourcePortRange: "*", destinationPortRange: "*", destinationAddressPrefix: "*",
        direction: "inbound",
        access: "allow",
        priority: 100,
        name: "allow-vnet",
        sourceAddressPrefix: "VirtualNetwork",
      },
    ];
    const verdict = classifyNsgVerdict(rules, {
      direction: "inbound",
      sourceAddressPrefix: "4.2.0.0/32",
    });
    expect(verdict === "unknown").toBeTruthy();
  });
  it("test_nsg_rule_with_internet_prefix_matches_any_ip", () => {
    const rules = [
      {
        protocol: "*", sourcePortRange: "*", destinationPortRange: "*", sourceAddressPrefix: "*",
        direction: "outbound",
        access: "allow",
        priority: 100,
        name: "allow-internet",
        destinationAddressPrefix: "Internet",
      },
    ];
    const verdict = classifyNsgVerdict(rules, {
      direction: "outbound",
      destinationAddressPrefix: "1.2.3.4/32",
    });
    expect(verdict === "allowed").toBeTruthy();
  });
  it("test_nsg_rule_with_unknown_tag_stays_unknown", () => {
    const rules = [
      {
        protocol: "*", sourcePortRange: "*", destinationPortRange: "*", destinationAddressPrefix: "*",
        direction: "inbound",
        access: "allow",
        priority: 100,
        name: "allow-unknowntag",
        sourceAddressPrefix: "SomeMadeUpTag",
      },
    ];
    const verdict = classifyNsgVerdict(rules, {
      direction: "inbound",
      sourceAddressPrefix: "10.0.0.4/32",
    });
    expect(verdict === "unknown").toBeTruthy();
  });
  it("test_route_blackhole_with_service_tag_virtualnetwork", () => {
    const routes = [
      {
        name: "drop-vnet",
        addressPrefix: "VirtualNetwork",
        nextHopType: "None",
      },
    ];
    const verdict = classifyRouteVerdict(routes, {
      destinationPrefix: "10.0.1.5/32",
      virtualNetworkPrefixes: ["10.0.0.0/16", "172.16.0.0/16"],
    });
    expect(verdict === "blocked").toBeTruthy();
  });
  it("test_route_blackhole_with_service_tag_not_matching", () => {
    const routes = [
      {
        name: "drop-vnet",
        addressPrefix: "VirtualNetwork",
        nextHopType: "None",
      },
    ];
    const verdict = classifyRouteVerdict(routes, {
      destinationPrefix: "172.16.0.5/32",
      virtualNetworkPrefixes: ["10.0.0.0/16", "172.16.0.0/16"],
    });
    expect(verdict === "blocked").toBeTruthy();
  });
  it("test_route_blackhole_with_service_tag_different_range", () => {
    const routes = [
      {
        name: "drop-vnet",
        addressPrefix: "VirtualNetwork",
        nextHopType: "None",
      },
    ];
    const verdict = classifyRouteVerdict(routes, {
      destinationPrefix: "4.2.0.0/32",
      virtualNetworkPrefixes: ["10.0.0.0/16", "172.16.0.0/16"],
    });
    expect(verdict === "allowed").toBeTruthy();
  });
});
