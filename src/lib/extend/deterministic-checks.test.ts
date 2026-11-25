import { describe, expect, it } from "vitest";
import { deterministicCheckSchema, extensionPlanSchema } from "@/lib/completion/schema";
import { summarizeInventory } from "@/lib/inventory/summarize";
import { completeSnapshot } from "@/lib/completion/fixtures.test-data";
import { BASE, SUBSCRIPTION, VNET_ID, SUBNET_ID, NSG_ID, VM_ID, NIC_ID, RT_ID,
  resource, nsgResource, allowRule, denyRule, routeTableResource, routeEntry } from "@/lib/network/fixtures.test-data";
import { calculateExtensionChecks, diagnoseExistingExtensionPath } from "./deterministic-checks";
import { createExtensionRequestContext } from "./validate-proposal";
import { proposalInput, proposalScan, proposalInventory, proposalCatalog, proposalSupport, savedProposal } from "./proposal.test-data";
import type { NetworkQuery } from "@/types/network-diagnostics";
import type { ScanRecord } from "@/types/scan";

function fixture(tier = 0) {
  const f = structuredClone({ input: proposalInput, scan: proposalScan as ScanRecord, inventory: proposalInventory,
    catalog: proposalCatalog, support: proposalSupport, plan: savedProposal.plans[tier] });
  f.scan.source = "live";
  f.scan.subscriptionIds = [f.inventory.resources[0].subscriptionId];
  f.inventory.resources[0].properties.subnets = [];
  return f;
}
type Fixture = ReturnType<typeof fixture>;
function context(f: Fixture) {
  f.scan.summary = summarizeInventory(f.inventory.resources, []);
  return createExtensionRequestContext(f.input, f.scan, f.inventory, f.catalog, { support: f.support });
}
function run(f = fixture()) { return calculateExtensionChecks(f.plan, context(f)); }
const check = (f: Fixture, kind: string) => run(f).find(c => c.kind === kind)!;
function sibling(f: Fixture, prefix: unknown, name = "sibling") {
  const parent = f.inventory.resources[0];
  f.inventory.resources.push({ ...structuredClone(parent), id: `${parent.id}/subnets/${name}`, name,
    type: "microsoft.network/virtualnetworks/subnets", parentId: parent.id,
    properties: { addressPrefix: prefix, delegations: [] } });
}

describe("deterministic Extend checks", () => {
  it("checks saved parent inclusion without certifying capacity or unbuilt connectivity", () => {
    const f = fixture(); const checks = run(f);
    expect(checks.map(c => [c.kind, c.verdict])).toEqual([
      ["region", "pass"], ["cidr", "pass"], ["path", "unknown"], ["capacity", "unknown"],
    ]);
    expect(checks[2].reasonCodes).toEqual(["unsupported-path"]);
    expect(checks[3].reasonCodes).toEqual(["capacity-unverified"]);
    expect(checks[1].evidence).toContainEqual(expect.objectContaining({ resourceId: f.inventory.resources[0].id,
      propertyPath: "/properties/addressSpace/addressPrefixes", observation: { state: "present", value: ["10.1.0.0/16"] } }));
    for (const value of checks) expect(deterministicCheckSchema.safeParse(value).success).toBe(true);
    expect(extensionPlanSchema.safeParse({ ...f.plan, checks, incrementalCost: { state: "unavailable", reason: "price-unavailable" } }).success).toBe(true);
  });
  it.each(["10.2.1.0/24", "10.0.0.0/8", "fd00::/64"])("rejects subnet outside exact parent: %s", prefix => {
    const f = fixture(); f.plan.subnetProposals[0].addressPrefixes = [prefix];
    expect(check(f, "cidr").verdict).toBe("violation");
  });
  it.each(["10.1.1.0/24", "10.1.0.0/23", "10.1.1.128/25"])("detects every saved sibling overlap: %s", prefix => {
    const f = fixture(); sibling(f, "10.1.8.0/24", "first"); sibling(f, prefix, "second");
    expect(check(f, "cidr").verdict).toBe("violation");
    expect(check(f, "cidr").evidence.some(e => e.resourceId.endsWith("/second"))).toBe(true);
  });
  it("checks embedded siblings as well as separate saved rows", () => {
    const f = fixture(); f.inventory.resources[0].properties.subnets = [{ name: "embedded", properties: { addressPrefix: "10.1.1.0/24" } }];
    expect(check(f, "cidr").verdict).toBe("violation");
    expect(check(f, "cidr").evidence.every(e => f.inventory.resources.some(r => r.id === e.resourceId))).toBe(true);
  });
  it("keeps scalar prefix evidence identical to the stored JSON pointer", () => {
    const f = fixture(); sibling(f, "10.1.8.0/24");
    expect(check(f, "cidr").evidence).toContainEqual({ resourceId: f.inventory.resources.at(-1)!.id,
      propertyPath: "/properties/addressPrefix", observation: { state: "present", value: "10.1.8.0/24" } });
  });
  it("detects conflicting existing siblings away from the proposed subnet", () => {
    const f = fixture(); sibling(f, "10.1.8.0/24", "first"); sibling(f, "10.1.8.128/25", "second");
    expect(check(f, "cidr").verdict).toBe("violation");
  });
  it("checks containment of a selected existing subnet even in another parent", () => {
    const f = fixture(2); sibling(f, "10.9.1.0/24");
    f.plan.reusedResources.push({ resourceId: f.inventory.resources.at(-1)!.id,
      componentId: "virtual-network-subnet", reason: { en: "Use the saved subnet", ko: "저장된 서브넷을 사용합니다." } });
    expect(check(f, "cidr").verdict).toBe("violation");
  });
  it("does not hide contradictory embedded and standalone saved subnet ranges", () => {
    const f = fixture(); sibling(f, "10.1.8.0/24");
    f.inventory.resources[0].properties.subnets = [{ name: "sibling", properties: { addressPrefix: "10.1.1.0/24" } }];
    expect(check(f, "cidr").verdict).toBe("violation");
  });
  it.each([undefined, "bad", "10.1.1.1/24"])("missing/malformed saved sibling never passes: %s", value => {
    const f = fixture(); sibling(f, value ?? null);
    expect(check(f, "cidr").verdict).toBe("unknown");
  });
  it("compares all proposed siblings sharing a parent", () => {
    const f = fixture(); const subnet = f.plan.subnetProposals[0];
    f.plan.subnetProposals.push({ ...subnet, id: "second", addressPrefixes: ["10.1.1.128/25"] });
    f.plan.newItems.find(i => i.componentId === subnet.componentId)!.quantity = 2;
    expect(check(f, "cidr").verdict).toBe("violation");
    f.plan.subnetProposals[1].addressPrefixes = ["10.1.2.0/24"];
    expect(check(f, "cidr").verdict).toBe("pass");
  });
  it("uses explicit new parent space, never a space derived from the subnet", () => {
    const f = fixture(2);
    expect(check(f, "cidr").verdict).toBe("pass");
    const parent = f.plan.subnetProposals[0].parent;
    if (parent.kind !== "new") throw Error();
    parent.addressPrefixes = ["10.3.0.0/16"];
    expect(check(f, "cidr").verdict).toBe("violation");
  });
  it("compares new parent against selected existing VNet space, not just occupied subnets", () => {
    const f = fixture(2); const subnet = f.plan.subnetProposals[0];
    subnet.addressPrefixes = ["10.1.9.0/24"];
    if (subnet.parent.kind !== "new") throw Error();
    subnet.parent.addressPrefixes = ["10.1.0.0/16"];
    expect(check(f, "cidr").verdict).toBe("violation");
  });
  it("compares distinct new parents, even when their child subnets do not overlap", () => {
    const f = fixture(2); const subnet = f.plan.subnetProposals[0];
    f.plan.subnetProposals.push({ ...subnet, id: "second", addressPrefixes: ["10.2.2.0/24"],
      parent: { kind: "new", id: "second-vnet", componentId: "virtual-network", addressPrefixes: ["10.2.0.0/16"] } });
    for (const item of f.plan.newItems) if (item.componentId.startsWith("virtual-network")) item.quantity = 2;
    expect(check(f, "cidr").verdict).toBe("violation");
  });
  it("checks IPv6 containment/overlap with exact bigint boundaries", () => {
    const f = fixture(); f.inventory.resources[0].properties.addressSpace = { addressPrefixes: ["fd00::/48"] };
    f.plan.subnetProposals[0].addressPrefixes = ["fd00:0:0:1::/64"];
    expect(check(f, "cidr").verdict).toBe("pass");
    sibling(f, "fd00:0000:0000:0001:0000:0000:0000:0000/65");
    expect(check(f, "cidr").verdict).toBe("violation");
  });
  it.each([
    ["10.1.1.1/24"], ["fd00::1/64"], ["fd00::/64", "fd00:0000:0000:0000::/64"],
    ["10.1.0.0/16", "10.1.1.0/24"], ["10.1.1.0"],
  ])("rejects host bits, semantic duplicates and overlapping proposal prefixes: %j", (...prefixes) => {
    const f = fixture(); f.plan.subnetProposals[0].addressPrefixes = prefixes;
    expect(() => run(f)).toThrow("validation-failed");
  });
  it.each([null, {}, { addressPrefixes: ["10.1.0.1/16"] }, { addressPrefixes: ["fd00::/64", "fd00:0::/64"] }])("unknown for invalid saved parent: %j", addressSpace => {
    const f = fixture(); f.inventory.resources[0].properties.addressSpace = addressSpace;
    expect(check(f, "cidr").verdict).toBe("unknown");
  });
  it.each(["import", "partial", "legacy"])("does not certify absent siblings in %s collections", state => {
    const f = fixture(); delete f.inventory.resources[0].properties.subnets;
    if (state === "import") f.scan.source = "import";
    if (state === "partial") f.inventory.skippedRows = 1;
    if (state === "legacy") delete f.inventory.resources[0].observedFields;
    expect(check(f, "cidr").verdict).toBe("unknown");
  });
  it("does not infer a collected subnet list from live properties presence alone", () => {
    const f = fixture(); delete f.inventory.resources[0].properties.subnets;
    expect(check(f, "cidr")).toMatchObject({ verdict: "unknown", reasonCodes: ["missing-data"] });
  });
  it.each([null, "westus2"])("missing/mismatched saved region: %s", location => {
    const f = fixture(); f.inventory.resources[0].location = location;
    expect(check(f, "region").verdict).toBe(location ? "violation" : "unknown");
  });
  it("does not infer global/free network support", () => {
    const f = fixture(); f.support.components.find(c => c.componentId === "virtual-network-subnet")!.regions
      .find(r => r.regionId === f.input.region)!.status = "unknown";
    expect(check(f, "region")).toMatchObject({ verdict: "unknown", reasonCodes: ["unsupported-region"] });
  });
  it("checks proposed subnet/parent region against selected region", () => {
    const f = fixture(); f.plan.subnetProposals[0].region = "westus2";
    expect(check(f, "region").verdict).toBe("violation");
  });
  it("rejects exact source ID/scan/component violations with sanitized errors", () => {
    const f = fixture(); f.plan.reusedResources[0].resourceId += "-other";
    expect(() => run(f)).toThrow(/^validation-failed$/);
    const g = fixture(); g.input.sourceScanId = completeSnapshot.sourceScan.id.replace(/.$/, "9");
    expect(() => run(g)).toThrow(/^validation-failed$/);
    const h = fixture(); h.plan.newItems[0].componentId = "invented-component";
    expect(() => run(h)).toThrow(/^validation-failed$/);
  });
  it("does not return universal pass for a new-only non-network configuration", () => {
    const f = fixture(); f.plan.reusedResources = []; f.plan.usageIncreases = []; f.plan.subnetProposals = [];
    f.plan.newItems = f.plan.newItems.slice(0, 1);
    const checks = run(f);
    expect(checks).toHaveLength(4);
    expect(checks.every(c => c.verdict === "unknown")).toBe(true);
    expect(checks.find(c => c.kind === "cidr")!.reasonCodes).toContain("not-supported");
  });
  it("references only plan members and actual saved evidence, without mutation", () => {
    const f = fixture(); sibling(f, "10.1.1.0/24"); const ctx = context(f);
    const before = JSON.stringify([f.plan, ctx.inventory, ctx.scan]);
    const checks = calculateExtensionChecks(f.plan, ctx);
    const planIds = new Set(f.plan.reusedResources.map(r => r.resourceId));
    const savedIds = new Set(ctx.inventory.resources.map(r => r.id));
    for (const c of checks) {
      expect(c.resourceIds.every(id => planIds.has(id))).toBe(true);
      expect(c.evidence.every(e => savedIds.has(e.resourceId))).toBe(true);
    }
    expect(JSON.stringify([f.plan, ctx.inventory, ctx.scan])).toBe(before);
    expect(calculateExtensionChecks(f.plan, ctx)).toEqual(checks);
  });
});

function networkFixture(scenario: string) {
  const dest = `${BASE}/microsoft.compute/virtualmachines/dest`;
  const destNic = `${BASE}/microsoft.network/networkinterfaces/dest`;
  const resources = [resource(VNET_ID, "microsoft.network/virtualnetworks", { addressSpace: { addressPrefixes: ["10.0.0.0/16"] } }),
    resource(SUBNET_ID, "microsoft.network/virtualnetworks/subnets", { networkSecurityGroup: { id: NSG_ID }, routeTable: null }),
    nsgResource(NSG_ID, { securityRules: [allowRule("in"), allowRule("out", { direction: "outbound" })] }),
    ...[[VM_ID, NIC_ID, "10.0.1.4"], [dest, destNic, "10.0.1.5"]].flatMap(([vm, nic, ip]) => [
      resource(vm, "microsoft.compute/virtualmachines", { networkProfile: { networkInterfaces: [{ id: nic }] } }),
      resource(nic, "microsoft.network/networkinterfaces", { networkSecurityGroup: null,
        ipConfigurations: [{ properties: { privateIPAddress: ip, subnet: { id: SUBNET_ID } } }] }),
    ]),
  ];
  for (const row of resources) row.observedFields = ["properties"];
  if (scenario === "deny") resources[2].properties.securityRules = [denyRule("out", { direction: "outbound", priority: 100 })];
  if (scenario === "tag") resources[2].properties.securityRules = [allowRule("in"), denyRule("out", { direction: "outbound", destPrefix: "AzureMonitor" })];
  if (scenario === "nva") {
    resources[1].properties.routeTable = { id: RT_ID };
    resources.push(routeTableResource(RT_ID, { routes: [routeEntry("nva", { addressPrefix: "10.0.1.5/32", nextHopType: "VirtualAppliance" })] }));
  }
  if (scenario === "missing") resources.splice(1, 1);
  const inventory = { resources, containers: [], relations: [], skippedRows: 0 };
  const scan: ScanRecord = { ...proposalScan, source: "live", subscriptionIds: [SUBSCRIPTION], summary: summarizeInventory(resources, []) };
  const query: NetworkQuery = { sourceScanId: scan.id, sourceResourceId: VM_ID, destinationResourceId: dest,
    protocol: "tcp", sourcePort: null, destinationPort: 443 };
  return { scan, inventory, query };
}
describe("explicit saved existing traffic (separate from proposed topology)", () => {
  it.each([["allow", "allowed"], ["deny", "blocked"], ["tag", "unknown"], ["nva", "unknown"], ["missing", "unknown"]])("grounds %s in actual phase15 engine", (scenario, verdict) => {
    const f = networkFixture(scenario); const before = JSON.stringify(f);
    const engine = diagnoseExistingExtensionPath(f.scan, f.inventory, f.query);
    expect(engine.verdict).toBe(verdict);
    expect(engine.reasonCodes.length).toBeGreaterThan(0);
    if (verdict !== "unknown") expect(engine.paths.flatMap(p => p.hops.flatMap(h => h.evidence)).length).toBeGreaterThan(0);
    expect(JSON.stringify(f)).toBe(before);
  });
  it.each(["live", "import", "partial", "legacy"])("passes matching SourceScan omission semantics: %s", state => {
    const f = networkFixture("allow");
    for (const r of f.inventory.resources) { delete r.properties.networkSecurityGroup; delete r.properties.routeTable; }
    if (state === "import") f.scan.source = "import";
    if (state === "partial") f.inventory.skippedRows = 1;
    if (state === "legacy") for (const r of f.inventory.resources) delete r.observedFields;
    expect(diagnoseExistingExtensionPath(f.scan, f.inventory, f.query).verdict).toBe(state === "live" ? "allowed" : "unknown");
  });
  it.each([{ destinationPort: null }, { destinationPort: 65536 }, { protocol: "icmp" }, { sourceAddressPrefix: "10.0.1.4" },
    { destinationResourceId: `${VM_ID}-outside` }, { sourceScanId: "00000000-0000-4000-8000-000000000099" }])("rejects ungrounded/invalid query %j", patch => {
    const f = networkFixture("allow");
    expect(() => diagnoseExistingExtensionPath(f.scan, f.inventory, { ...f.query, ...patch } as NetworkQuery)).toThrow(/^validation-failed$/);
  });
});

it("does not certify a new VNet when other saved VNet relevance is unselected",()=>{
 const f=fixture(2),other=structuredClone(f.inventory.resources[0]);
 other.id+="-unselected";other.name+="-unselected";other.properties={addressSpace:{addressPrefixes:["10.8.0.0/16"]},subnets:[]};
 f.inventory.resources.push(other);
 expect(check(f,"cidr")).toMatchObject({verdict:"unknown",reasonCodes:["missing-data"]});
});
