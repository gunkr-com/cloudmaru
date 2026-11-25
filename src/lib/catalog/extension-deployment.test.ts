import { describe, expect, it, vi } from "vitest";
import rawComponents from "@/catalog/components.json";
import legacy from "@/lib/extend/legacy-evidence.test-data.json";
import { componentSchema, catalogSchema } from "./schema";
import { getPostgresDeploymentMapping, getComponentBicepDeployment, getExtensionDeploymentIntent } from "./extension-deployment";
import rawArchitectures from "@/catalog/reference-architectures.json";
import prices from "@/catalog/prices.json";
import { validateCatalog } from "./validate";

vi.mock("./load", () => { throw new Error("A pure mapping must not load the current catalog"); });
const component = (id: string) => componentSchema.parse(rawComponents.find(c => c.id === id));

describe("explicit pinned topology and deployment roles", () => {
  it("provides reviewed roles for every offered component without deriving them from names", () => {
    for (const raw of rawComponents) {
      const c = componentSchema.parse(raw);
      expect(getComponentBicepDeployment(c)).toBe(c.extensionDeployment);
      expect(c.extensionDeployment).toMatchObject({ version: "extension-deployment-v1", capabilityStatus: "unverified" });
      expect(c.extensionDeployment!.locationBasis).toBe(c.id.startsWith("static-web-apps-") ? "service-location-input" : c.id === "front-door-standard-base" ? "global" : "selected-region");
      const old = structuredClone(c); delete old.extensionDeployment;
      expect(getComponentBicepDeployment(old)).toBeNull();
    }
  });
  it("pins all four references and twelve tier intents with explicit native HA billing", () => {
    const catalog = catalogSchema.parse({ components: rawComponents, architectures: rawArchitectures, prices });
    for (const a of catalog.architectures) for (const tier of ["low", "balanced", "ha"] as const) {
      const intent = getExtensionDeploymentIntent(catalog, a.id, tier)!;
      expect(intent).toBe(a.tiers[tier].deploymentIntent);
      expect(intent.postgres).toEqual({ highAvailabilityMode: tier === "ha" ? "ZoneRedundant" : "Disabled", billingInstancesPerRoot: tier === "ha" ? 2 : 1 });
      if (a.id === "app-service-zone-redundant") {
        expect(intent.applicationGateway).toEqual({minimumCapacity: {low: 1, balanced: 2, ha: 3}[tier], zoneRedundant: tier === "ha", zonesBasis: tier === "ha" ? "deployment-input" : "none"});
        expect(intent.publicIp).toEqual({zoneRedundant: tier === "ha", zonesBasis: tier === "ha" ? "deployment-input" : "none"});
      }
      delete a.tiers[tier].deploymentIntent;
      expect(getExtensionDeploymentIntent(catalog, a.id, tier)).toBeNull();
    }
    expect(getExtensionDeploymentIntent(catalog, "missing", "ha")).toBeNull();
  });
  it("keeps the old PG default while allowing reviewed GP HA modes and rejecting Burstable HA", () => {
    const gp = component("postgres-flex-gp-2vcore");
    expect(gp.bicepDeployment).toMatchObject({ highAvailabilityMode: "Disabled", allowedHighAvailabilityModes: ["Disabled", "ZoneRedundant"], highAvailabilityBilling: { mode: "ZoneRedundant", billingInstancesPerRoot: 2 } });
    const b = component("postgres-flex-b1ms");
    expect(b.bicepDeployment).toMatchObject({ allowedHighAvailabilityModes: ["Disabled"] });
    expect(componentSchema.safeParse({ ...b, bicepDeployment: { ...b.bicepDeployment, allowedHighAvailabilityModes: ["Disabled", "ZoneRedundant"] } }).success).toBe(false);
  });
  it("rejects wrong component roles, facts, resource types and unsafe source URLs", () => {
    const c = component("container-apps-vcpu");
    for (const change of [{ role: "memory" }, { groupId: "functions" }, { locationBasis: "global" }, { sourceUrls: ["https://evil.test/"] }, { sourceUrls: ["https://u:p@learn.microsoft.com/test"] }, { capabilityStatus: "verified" }]) {
      expect(componentSchema.safeParse({ ...c, extensionDeployment: { ...c.extensionDeployment, ...change } }).success).toBe(false);
    }
    expect(componentSchema.safeParse({ ...c, bicepResourceTypes: ["Microsoft.Web/sites"] }).success).toBe(false);
    const asp = component("app-service-linux-p1v3");
    expect(componentSchema.safeParse({ ...asp, extensionDeployment: { ...asp.extensionDeployment, skuName: "B1" } }).success).toBe(false);
  });
  it("rejects intent edges that do not match the selected reference connections and roles", () => {
    for (const kind of ["wrong-role", "wrong-target", "missing-edge", "network-role"]) {
      const catalog = catalogSchema.parse({ components: rawComponents, architectures: rawArchitectures, prices });
      const tier = catalog.architectures.find(a => a.id === "app-service-zone-redundant")!.tiers.ha;
      if (kind === "wrong-role") tier.deploymentIntent!.bindings[0].role = "function-storage";
      if (kind === "wrong-target") tier.deploymentIntent!.bindings[0].toComponentId = "postgres-flex-gp-2vcore";
      if (kind === "missing-edge") tier.connections = [];
      if (kind === "network-role") tier.deploymentIntent!.networkRequirements[0].componentId = "blob-hot-zrs";
      expect(validateCatalog(catalog).ok).toBe(false);
    }
  });
});

describe("pinned PostgreSQL deployment mapping", () => {
  it.each([
    ["postgres-flex-b1ms", "Standard_B1ms", "Burstable", "official-example"],
    ["postgres-flex-b2s", "Standard_B2s", "Burstable", "inferred-vm-series"],
    ["postgres-flex-gp-2vcore", "Standard_D2ds_v5", "GeneralPurpose", "inferred-vm-series"],
    ["postgres-flex-gp-4vcore", "Standard_D4ds_v5", "GeneralPurpose", "official-example"],
  ])("preserves the reviewed draft and evidence basis for %s", (id, skuName, tier, mappingBasis) => {
    const mapping = getPostgresDeploymentMapping(component(id));
    expect(mapping).toMatchObject({ kind: "postgres-flex-compute", skuName, tier, mappingBasis,
      engineVersion: "16", highAvailabilityMode: "Disabled", storageComponentId: "postgres-flex-storage",
      capabilityStatus: "unverified" });
    expect(mapping!.sourceUrls.length).toBeGreaterThan(0);
  });

  it("returns only the passed snapshot and never guesses a missing mapping", () => {
    const old = legacy.evidence.catalog.components.find(c => c.id === "postgres-flex-b1ms")!;
    expect(componentSchema.parse(old)).toEqual(old);
    expect(getPostgresDeploymentMapping(componentSchema.parse(old))).toBeNull();
    expect(getPostgresDeploymentMapping(component("virtual-network"))).toBeNull();
    const pinned = component("postgres-flex-b2s");
    expect(getPostgresDeploymentMapping(pinned)).toBe(pinned.bicepDeployment);
    expect(catalogSchema.parse(legacy.evidence.catalog)).toEqual(legacy.evidence.catalog);
  });

  it("keeps classic storage as an app pattern with unknown regional capabilities", () => {
    expect(getPostgresDeploymentMapping(component("postgres-flex-storage"))).toMatchObject({
      kind: "postgres-flex-storage", storageType: "Premium_LRS",
      storageSizesGB: [32, 64, 128, 256, 512, 1024, 2048, 4096, 8192, 16384, 32768],
      mappingBasis: "conservative-app-pattern", capabilityStatus: "unverified",
    });
  });

  it("rejects misplaced kinds, mismatched SKU/tier/basis, unknown fields and unsafe sources", () => {
    const compute = component("postgres-flex-b2s"), storage = component("postgres-flex-storage");
    const mapping = compute.bicepDeployment!;
    const bad = [
      { ...compute, bicepDeployment: storage.bicepDeployment },
      { ...storage, bicepDeployment: mapping },
      { ...component("virtual-network"), bicepDeployment: mapping },
      ...[
        { tier: "GeneralPurpose" }, { skuName: "Standard_B1ms" }, { mappingBasis: "official-example" },
        { engineVersion: "latest" }, { highAvailabilityMode: "ZoneRedundant" }, { capabilityStatus: "verified" },
        { extra: true }, { sourceUrls: [] }, { sourceUrls: ["https://evil.test/"] },
        { sourceUrls: ["not-a-url"] }, { sourceUrls: [""] },
        { sourceUrls: ["https://user:password@learn.microsoft.com/test"] },
        { sourceUrls: ["https://learn.microsoft.com:444/test"] },
      ].map(change => ({ ...compute, bicepDeployment: { ...mapping, ...change } })),
      ...[[33], [16], [65536], [32.5], [32, 32], [64, 32]].map(storageSizesGB => ({
        ...storage, bicepDeployment: { ...storage.bicepDeployment, storageSizesGB },
      })),
    ];
    for (const value of bad) expect(componentSchema.safeParse(value).success).toBe(false);
  });
});
