// @vitest-environment node
import { describe, expect, it } from "vitest";
import { extensionSupportCatalogSchema, parseExtensionSupportCatalog } from "./extension-support-schema";
import type { Catalog } from "@/types/catalog";
import { loadCatalog } from "./load";

const source = { title: "Microsoft source", url: "https://learn.microsoft.com/en-us/azure/virtual-network/virtual-networks-overview" };
const text = { en: "Review capacity before use", ko: "사용 전에 용량을 확인합니다" };
function support() {
  return { schemaVersion: 1, version: "2026-11-11-v1", verifiedAt: "2026-11-12T05:13:39Z",
    regions: [{ id: "canadacentral", label: { en: "Canada Central", ko: "캐나다 중부" } }],
    components: [{ componentId: "app-service-linux-b1", regions: [{ regionId: "canadacentral", status: "supported", priceRegion: "canadacentral", sources: [source] }] }],
    reusePolicies: [{ id: "reuse-linux-plan", resourceTypes: ["microsoft.web/serverfarms"], componentIds: ["app-service-linux-b1"],
      conditions: ["same-region", "sku-match", "linux-required"], skuByComponent: { "app-service-linux-b1": "B1" },
      additionalUsage: "none", capacity: "unverified", notes: text, sources: [source] }] };
}
function catalog(): Pick<Catalog, "components" | "prices"> {
  const all = loadCatalog(); return { components: all.components.filter(c => c.id === "app-service-linux-b1"), prices: all.prices };
}
describe("Extend support catalog", () => {
  it("accepts an evidenced priced region and keeps capacity unverified", () => {
    const parsed = parseExtensionSupportCatalog(support(), catalog());
    expect(parsed.reusePolicies[0].capacity).toBe("unverified");
    expect(extensionSupportCatalogSchema.parse(support())).toEqual(support());
  });
  it("rejects untrusted links, malformed types, duplicate identities and invented guarantees", () => {
    const base = support();
    for (const value of [
      { ...base, schemaVersion: 2 }, { ...base, regions: [base.regions[0], base.regions[0]] },
      { ...base, components: [base.components[0], base.components[0]] },
      { ...base, reusePolicies: [base.reusePolicies[0], base.reusePolicies[0]] },
      { ...base, reusePolicies: [{ ...base.reusePolicies[0], capacity: "sufficient" }] },
      { ...base, reusePolicies: [{ ...base.reusePolicies[0], resourceTypes: ["microsoft.web/*"] }] },
      { ...base, reusePolicies: [{ ...base.reusePolicies[0], sources: [{ ...source, url: "https://evil.test/" }] }] },
      { ...base, reusePolicies: [{ ...base.reusePolicies[0], sources: [{ ...source, url: "https://user:password@learn.microsoft.com/test" }] }] },
      { ...base, components: [{ ...base.components[0], regions: [{ ...base.components[0].regions[0], status: "unavailable" }] }] },
      { ...base, extra: true },
    ]) expect(extensionSupportCatalogSchema.safeParse(value).success).toBe(false);
  });
  it("rejects a supported regional price when no exact snapshot row exists", () => {
    const base = support(); const c = catalog();
    const prices = { ...c.prices, prices: {} };
    expect(() => parseExtensionSupportCatalog(base, { ...c, prices })).toThrow();
    const changed = { ...base, components: [{ ...base.components[0], regions: [{ ...base.components[0].regions[0], priceRegion: "westus2" }] }] };
    expect(() => parseExtensionSupportCatalog(changed, c)).toThrow();
  });
  it("permits explicit unknown without fabricating prices, while retaining every component-region pair", () => {
    const base = support(); const unknown = { ...base, components: [{ ...base.components[0], regions: [{ ...base.components[0].regions[0], status: "unknown" }] }] };
    expect(parseExtensionSupportCatalog(unknown, { ...catalog(), prices: { ...catalog().prices, prices: {} } }).components[0].regions[0].status).toBe("unknown");
    expect(() => parseExtensionSupportCatalog({ ...base, components: [] }, catalog())).toThrow();
    expect(() => parseExtensionSupportCatalog({ ...base, components: [{ ...base.components[0], regions: [] }] }, catalog())).toThrow();
    expect(() => parseExtensionSupportCatalog({ ...base, regions: [...base.regions, { id: "westus2", label: text }] }, catalog())).toThrow();
  });
  it("rejects unknown catalog IDs, inconsistent SKU mappings and duplicate conditions", () => {
    const base = support();
    for (const policy of [
      { ...base.reusePolicies[0], componentIds: ["invented-component"] },
      { ...base.reusePolicies[0], resourceTypes: ["microsoft.storage/storageaccounts"] },
      { ...base.reusePolicies[0], skuByComponent: {} },
      { ...base.reusePolicies[0], skuByComponent: { "invented-component": "B1" } },
      { ...base.reusePolicies[0], conditions: ["same-region", "same-region"] },
    ]) expect(() => parseExtensionSupportCatalog({ ...base, reusePolicies: [policy] }, catalog())).toThrow();
  });
  it("requires metered incremental usage policies to target metered components", () => {
    const base = support(); const c = catalog();
    const free = { ...c.components[0], pricing: { kind: "free" as const } };
    const freeSupport = { ...base, components: [{ ...base.components[0], regions: base.components[0].regions.map(({ priceRegion: omitted, ...entry }) => {
      expect(omitted).toBe("canadacentral"); return entry;
    }) }] };
    expect(parseExtensionSupportCatalog(freeSupport, { components: [free], prices: c.prices }).reusePolicies[0].additionalUsage).toBe("none");
    const value = { ...freeSupport, reusePolicies: [{ ...base.reusePolicies[0], additionalUsage: "metered" }] };
    expect(() => parseExtensionSupportCatalog(value, { components: [free], prices: c.prices })).toThrow();
  });
});
