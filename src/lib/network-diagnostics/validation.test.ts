import { describe, expect, it } from "vitest";
import { completeSnapshot, ids, resourceIds } from "@/lib/completion/fixtures.test-data";
import { diagnosePath } from "@/lib/network";
import { networkInputSchema, validateNetworkMembers, validateNetworkEngine, NETWORK_RESOURCE_LIMIT } from "./validation";
const query = { sourceScanId: ids.scan, sourceResourceId: resourceIds.vm, destinationResourceId: resourceIds.nic, protocol: "tcp" as const, sourcePort: null, destinationPort: 443 };
export const input = { schemaVersion: 1, workspaceId: ids.workspace, sourceScanId: ids.scan, query };
describe("saved network validation", () => {
  it("canonicalizes endpoint IDs and normalizes omitted ports", () => {
    expect(networkInputSchema.parse({ ...input, query: { ...query, sourceResourceId: ` ${resourceIds.vm.toUpperCase()} `, sourcePort: undefined } }).query).toEqual(query);
  });
  it.each([
    { ...query, destinationPort: -1 }, { ...query, destinationPort: 65536 }, { ...query, destinationPort: 1.5 },
    { ...query, destinationPort: "443" }, { ...query, protocol: "https" }, { ...query, protocol: "icmp" },
    { ...query, sourceAddressPrefix: "*" }, { ...query, destinationAddressPrefix: "bad" },
    { ...query, sourceResourceId: "http://example.com" }, { ...query, sourceScanId: ids.oldScan },
  ])("rejects malformed or unpersistable queries %j", value => {
    expect(networkInputSchema.safeParse({ ...input, query: value }).success).toBe(false);
  });
  it("checks exact members including normalized embedded subnets", () => {
    const resources = completeSnapshot.inventory.resources.filter(r => r.id !== resourceIds.subnet);
    expect(() => validateNetworkMembers(resources, { ...query, sourceResourceId: resourceIds.subnet })).not.toThrow();
    expect(() => validateNetworkMembers(resources, { ...query, sourceResourceId: `${resourceIds.vm}-other` })).toThrow();
    expect(() => validateNetworkMembers([...resources, resources[0]], query)).toThrow();
  });
  it("rejects oversized graphs and embedded subnet IDs outside their saved VNet", () => {
    const resources = structuredClone(completeSnapshot.inventory.resources);
    const vnet = resources.find(r => r.id === resourceIds.vnet)!;
    vnet.properties.subnets = [{ id: `${resourceIds.vnet}-other/subnets/foreign`, name: "foreign", properties: {} }];
    expect(() => validateNetworkMembers(resources, query)).toThrow();
    expect(() => validateNetworkMembers(Array.from({ length: NETWORK_RESOURCE_LIMIT + 1 }, (_, n) => ({ ...resources[5], id: `${resourceIds.vm}-${n}` })), query)).toThrow();
  });
  it("distinguishes inventory calculation limits from malformed queries", () => {
    const rows = Array.from({length: NETWORK_RESOURCE_LIMIT + 1}, (_, n) => ({...completeSnapshot.inventory.resources.find(row => row.id === resourceIds.vm)!, id: `${resourceIds.vm}-${n}`}));
    try { validateNetworkMembers(rows, query); throw Error("limit not enforced"); }
    catch (error) { expect(error).toHaveProperty("code", "inventory-too-large"); }
  });
  it("validates schema and every hop and evidence member", () => {
    const resources = completeSnapshot.inventory.resources;
    const engine = diagnosePath(resources, query);
    expect(validateNetworkEngine(resources, query, engine)).toEqual(engine);
    const invalid = structuredClone(engine);
    invalid.paths = [{ verdict: "unknown", reasonCodes: ["missing-data"], hops: [{ resourceId: `${resourceIds.vm}-other`, hopType: "vm", verdict: "unknown", reasonCodes: ["missing-data"], evidence: [] }] }];
    invalid.verdict = "unknown";
    invalid.reasonCodes = ["missing-data"];
    expect(() => validateNetworkEngine(resources, query, invalid)).toThrow();
    invalid.paths[0].hops[0].resourceId = resourceIds.vm;
    invalid.paths[0].hops[0].evidence = [{ resourceId: `${resourceIds.nic}-other`, propertyPath: "/properties", observation: { state: "missing" } }];
    expect(() => validateNetworkEngine(resources, query, invalid)).toThrow();
    expect(() => validateNetworkEngine(resources, query, { ...engine, sourceResourceId: resourceIds.storage })).toThrow();
  });
});
