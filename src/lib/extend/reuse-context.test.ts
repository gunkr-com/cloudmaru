import { describe, expect, it } from "vitest";
import { loadCatalog } from "@/lib/catalog/load";
import { loadExtensionSupportCatalog } from "@/lib/catalog/extension-support";
import { completeSnapshot, ids } from "@/lib/completion/fixtures.test-data";
import { summarizeInventory } from "@/lib/inventory/summarize";
import type { InventoryResource } from "@/types/inventory";
import type { ScanInventory } from "@/types/scan";
import { buildExtensionModelContext, computeReuseCandidates } from "./reuse-context";

const catalog = loadCatalog();
const support = loadExtensionSupportCatalog();
const region = "canadacentral";
const root = `/subscriptions/${ids.subscription}/resourcegroups/private-rg/providers`;
function resource(type: string, name: string, properties = {}, extra: Partial<InventoryResource> = {}): InventoryResource {
  return { id: `${root}/${type}/${name}`, name, type, properties, location: region,
    subscriptionId: ids.subscription, resourceGroup: "private-rg", kind: null, sku: null,
    tags: { password: "private-secret" }, zones: [], managedBy: null, parentId: null,
    observedFields: ["properties", "location", "sku"], ...extra };
}
function good() {
  const vnet = resource("microsoft.network/virtualnetworks", "private-vnet", { addressSpace: { addressPrefixes: ["10.1.0.0/16", "fd00::/48"] } });
  const subnet = resource("microsoft.network/virtualnetworks/subnets", "private-subnet", {
    addressPrefixes: ["10.1.1.0/24", "fd00:0:0:1::/64"], delegations: [],
  }, { id: `${vnet.id}/subnets/private-subnet`, parentId: vnet.id });
  return [vnet, subnet,
    resource("microsoft.web/serverfarms", "private-plan", { reserved: true }, { sku: { name: "P1v3" } }),
    resource("microsoft.keyvault/vaults", "private-vault"),
    resource("microsoft.operationalinsights/workspaces", "private-logs")];
}
function saved(resources: InventoryResource[]) {
  const inventory: ScanInventory = { resources, containers: [], relations: [], skippedRows: 0 };
  return { scan: { ...completeSnapshot.record, summary: summarizeInventory(resources, []) }, inventory };
}
function run(resources = good(), selectedSupport = support, selectedCatalog = catalog) {
  const { scan, inventory } = saved(resources);
  return computeReuseCandidates(scan, inventory, selectedCatalog, { region, support: selectedSupport });
}
const eligible = (resources: InventoryResource[]) => run(resources).candidates.filter(c => c.eligibility === "supported");

describe("saved inventory reuse candidates", () => {
  it("supports five reviewed families with unverified capacity and mandatory metered increments", () => {
    const result = run();
    expect(result.sourceScan.completeness).toEqual({ state: "complete", reasons: [] });
    const candidates = result.candidates.filter(c => c.eligibility === "supported");
    expect(candidates.map(c => c.componentId).sort()).toEqual([
      "virtual-network", "virtual-network-subnet", "app-service-linux-p1v3", "key-vault-operations", "log-analytics-ingestion",
    ].sort());
    expect(candidates.every(c => c.capacity === "unverified")).toBe(true);
    for (const id of ["key-vault-operations", "log-analytics-ingestion"]) {
      expect(candidates.find(c => c.componentId === id)).toMatchObject({ additionalUsage: "metered" });
    }
    expect(result.candidates.every(c => c.notes === null || c.notes.en.length > 0)).toBe(true);
    // 실제 production 기본값도 검증된 정적 로더를 사용한다.
    const { scan, inventory } = saved(good());
    expect(computeReuseCandidates(scan, inventory, catalog, { region })).toEqual(result);
  });

  it.each([0, 1, 2, 3, 4])("rejects missing and mismatched regional facts for family %i", index => {
    for (const location of [null, "", "Canada Central", "westus2"]) {
      const resources = good();
      resources[index].location = location;
      expect(eligible(resources).some(c => c.resourceId === resources[index].id)).toBe(false);
    }
  });

  it.each(["P1 v3", "p1v3", "B1", "", undefined, 123])("requires exact ARM SKU, not display name %s", name => {
    const resources = good();
    resources[2].sku = { name };
    expect(eligible(resources).some(c => c.componentId === "app-service-linux-p1v3")).toBe(false);
  });

  it.each([false, undefined, "true", 1, null])("never infers Linux from names or kind: %s", reserved => {
    const resources = good();
    resources[2].kind = "linux";
    resources[2].properties = { reserved };
    expect(eligible(resources).some(c => c.resourceId === resources[2].id)).toBe(false);
  });

  it.each([undefined, [], ["10.1.0.1/16"], ["10.1.0.0"], ["10.1.0.0/99"], ["fd00::1/48"], ["10.1.0.0/16", "10.1.0.0/16"]])(
    "requires known exact VNet networks: %j", prefixes => {
      const resources = good();
      resources[0].properties = { addressSpace: { addressPrefixes: prefixes } };
      expect(eligible(resources).some(c => c.resourceId === resources[0].id || c.resourceId === resources[1].id)).toBe(false);
    });

  it("requires exact saved subnet parent, containment, delegation and sibling non-overlap", () => {
    for (const patch of [
      { parentId: null }, { parentId: `${good()[0].id}-other` },
      { properties: { addressPrefix: "10.2.1.0/24", delegations: [] } },
      { properties: { addressPrefix: "10.1.1.0/24" } },
      { properties: { addressPrefix: "10.1.1.0/24", delegations: null } },
      { properties: { addressPrefix: "10.1.1.0/24", delegations: [{ properties: { serviceName: "Microsoft.Web/serverFarms" } }] } },
    ]) {
      const resources = good();
      Object.assign(resources[1], patch);
      expect(eligible(resources).some(c => c.resourceId === resources[1].id)).toBe(false);
    }
    const resources = good();
    expect(eligible(resources.slice(1)).some(c => c.resourceId === resources[1].id)).toBe(false);
    const sibling = { ...resources[1], id: `${resources[0].id}/subnets/overlap`, name: "overlap" };
    expect(eligible([...resources, sibling]).filter(c => c.componentId === "virtual-network-subnet")).toEqual([]);
  });

  it("does not approve a subnet when its own ranges overlap or a saved sibling is invalid", () => {
    const resources = good();
    resources[1].properties.addressPrefixes = ["10.1.1.0/24", "10.1.1.0/25"];
    expect(eligible(resources).some(c => c.componentId === "virtual-network-subnet")).toBe(false);
    const rows = good();
    const sibling = { ...rows[1], id: `${rows[0].id}/subnets/bad`, name: "bad", resourceGroup: "wrong" };
    expect(eligible([...rows, sibling]).some(c => c.componentId === "virtual-network-subnet")).toBe(false);
  });

  it.each(["B1", "B2", "P0v3", "P1v3", "P2v3"])("uses the exact per-component SKU policy for %s", sku => {
    const resources = good(); resources[2].sku = { name: sku };
    expect(eligible(resources).filter(c => c.resourceId === resources[2].id).map(c => c.componentId))
      .toEqual([`app-service-linux-${sku.toLowerCase()}`]);
  });

  it("expands only exact embedded children bound to the saved parent without mutating it", () => {
    const resources = good();
    resources[0].properties.subnets = [{ id: resources[1].id, name: resources[1].name, properties: resources[1].properties }];
    resources.splice(1, 1);
    const before = structuredClone(resources);
    expect(eligible(resources).some(c => c.componentId === "virtual-network-subnet")).toBe(true);
    expect(resources).toEqual(before);
    for (const id of [`${root}/microsoft.network/virtualnetworks/other/subnets/private-subnet`, `${resources[0].id}/subnets/../bad`, `${resources[0].id}/subnets/wrong-name`]) {
      const invalid = structuredClone(resources);
      (invalid[0].properties.subnets as { id: string }[])[0].id = id;
      expect(() => run(invalid)).toThrow("invalid-data");
    }
  });

  it("rejects conflicting embedded identities even when a standalone child exists", () => {
    const resources = good();
    resources[0].properties.subnets = [{ id: resources[1].id, name: "wrong", properties: {} }];
    expect(() => run(resources)).toThrow("invalid-data");
  });

  it("never auto-reuses unsupported types, duplicate canonical IDs or malformed declared identity", () => {
    const resources = good();
    resources.push(resource("microsoft.compute/virtualmachines", "private-vm"));
    const result = run([...resources, { ...resources[3], id: resources[3].id.toUpperCase() }]);
    expect(result.candidates.filter(c => c.resourceId === resources[3].id).every(c => c.eligibility !== "supported")).toBe(true);
    expect(result.candidates.find(c => c.resourceId === resources[5].id)).toMatchObject({ eligibility: "unsupported", reasonCodes: ["unsupported-type"] });
    for (const patch of [{ name: "wrong-name" }, { type: "microsoft.keyvault/vaults" }, { subscriptionId: ids.otherSubscription }, { resourceGroup: "other" }, { parentId: resources[0].id }]) {
      const rows = good(); Object.assign(rows[2], patch);
      expect(eligible(rows).some(c => c.resourceId === rows[2].id)).toBe(false);
    }
    const invalid = good(); invalid[0].id = "not-arm";
    expect(eligible(invalid).some(c => c.resourceId === "not-arm")).toBe(false);
  });

  it("has no fallback for absent or unknown catalogs/policies and never waives metered reuse", () => {
    const noPolicy = structuredClone(support);
    noPolicy.reusePolicies = noPolicy.reusePolicies.filter(p => p.id !== "reuse-key-vault");
    expect(run(good(), noPolicy).candidates.find(c => c.resourceId === good()[3].id)?.eligibility).toBe("unsupported");
    const missing = structuredClone(catalog); missing.components = missing.components.filter(c => c.id !== "key-vault-operations");
    expect(() => run(good(), support, missing)).toThrow();
    const waived = structuredClone(support); waived.reusePolicies.find(p => p.id === "reuse-key-vault")!.additionalUsage = "none";
    expect(() => run(good(), waived)).toThrow("invalid-data");
    const unknown = structuredClone(support);
    unknown.components.find(c => c.componentId === "key-vault-operations")!.regions.find(r => r.regionId === region)!.status = "unknown";
    expect(eligible(good())).toHaveLength(5);
    expect(run(good(), unknown).candidates.find(c => c.resourceId === good()[3].id)?.eligibility).toBe("unknown");
  });

  it("uses real source conversion, retaining import/legacy/partial provenance and rejecting pending", () => {
    const { scan, inventory } = saved(good());
    expect(() => computeReuseCandidates({ ...scan, status: "pending" }, inventory, catalog, { region, support })).toThrow();
    const legacy = structuredClone(inventory); delete legacy.resources[0].observedFields;
    expect(computeReuseCandidates({ ...scan, source: "import" }, legacy, catalog, { region, support }).sourceScan.completeness.reasons)
      .toEqual(["import-scope-unverified", "legacy-completeness-unknown"]);
    inventory.skippedRows = 1;
    expect(computeReuseCandidates(scan, inventory, catalog, { region, support }).sourceScan.completeness.state).toBe("partial");
  });
});

describe("minimal extension model payload", () => {
  function context(resources = good(), extra = {}) {
    const { scan, inventory } = saved(resources);
    return buildExtensionModelContext(scan, inventory, catalog, { region, support, ...extra });
  }
  it("exposes aliases and reviewed eligibility only, never private IDs, names, addresses or properties", () => {
    const result = context();
    const serialized = JSON.stringify(result.payload);
    for (const secret of [root, ids.subscription, ids.scan, "private-", "10.1.", "fd00:", "password", "P1v3", "addressSpace", "aliasToResourceId"]) expect(serialized).not.toContain(secret);
    expect(result.payload.candidates.some(c => c.componentId === "key-vault-operations" && c.additionalUsage === "metered")).toBe(true);
    expect(result.aliasToResourceId.size).toBe(5);
    expect(JSON.stringify(result)).toBe(JSON.stringify({ payload: result.payload }));
  });

  it("preserves stable aliases across input/selection order and explicit limits beyond 20 resources", () => {
    const resources = Array.from({ length: 35 }, (_, i) => resource("microsoft.keyvault/vaults", `private-${String(i).padStart(2, "0")}`));
    const all = context(resources);
    expect(all.payload.inventory.coverage).toEqual({ total: 35, included: 35, excluded: 0, reasons: [] });
    const reversed = context([...resources].reverse());
    expect(reversed.payload).toEqual(all.payload);
    const limited = context(resources, { maxResources: 21 });
    expect(limited.payload.inventory.coverage).toEqual({ total: 35, included: 21, excluded: 14, reasons: [{ code: "context-limit", count: 14 }] });
    for (const [alias, id] of limited.aliasToResourceId) expect(all.aliasToResourceId.get(alias)).toBe(id);
    const selected = context(resources, { relevantResourceIds: [resources[30].id, resources[1].id], maxResources: 1 });
    expect(selected.payload.inventory.selection).toMatchObject({ requested: 2, matched: 2 });
    expect(selected.payload.inventory.coverage).toMatchObject({ total: 35, included: 1, excluded: 34 });
    expect(context(resources, { relevantResourceIds: [] }).payload.inventory.coverage.included).toBe(0);
    expect(context(resources, { maxResources: 0 }).payload.inventory.coverage).toMatchObject({ included: 0, excluded: 35 });
    expect(() => context(resources, { maxResources: -1 })).toThrow();
    const selection = context(resources, { relevantResourceIds: [resources[0].id, resources[0].id.toUpperCase(), "bad", `${resources[0].id}-absent`] });
    expect(selection.payload.inventory.selection).toEqual({ requested: 4, matched: 1, duplicates: 1, rejected: 1, missing: 1 });
  });

  it("does not apply the 2,000-resource diagnostics limit and accounts for invalid/type exclusions", () => {
    const resources = Array.from({ length: 2001 }, (_, i) => resource("microsoft.keyvault/vaults", `private-${i}`));
    expect(run(resources).candidates.filter(c => c.eligibility === "supported")).toHaveLength(2001);
    expect(context(resources).payload.inventory.coverage).toMatchObject({ total: 2001, included: 200, excluded: 1801 });
    const rows = good(); rows[2].resourceGroup = "wrong";
    rows.push(resource("microsoft.compute/virtualmachines", "private-vm"));
    const result = context(rows);
    expect(result.payload.inventory.coverage.reasons).toEqual([{ code: "invalid-data", count: 1 }, { code: "unsupported-type", count: 1 }]);
    expect(result.aliasToResourceId.size).toBe(4);
  });
});
