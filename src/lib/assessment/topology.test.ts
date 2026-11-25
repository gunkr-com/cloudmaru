import { reportFixture } from "@/lib/assessment/report/fixtures.test-data";
import { expect, it } from "vitest";
import type { InventoryResource } from "@/types/inventory";
import type { ScanInventory } from "@/types/scan";
import { assessmentTopology, searchTopology, topologyChecks, topologyIssues, topologyNeighborhood, topologyRoles } from "./topology";

const resource = (id: string, name: string): InventoryResource => ({
  id, name, type: "microsoft.storage/storageaccounts", resourceGroup: "group",
  subscriptionId: "subscription", location: null, kind: null, sku: null, tags: {},
  zones: [], managedBy: null, parentId: null, properties: { privateValue: "hidden-sentinel" },
});
const inventory: ScanInventory = {
  containers: [], skippedRows: 0,
  resources: [resource("/A", "storage"), resource("/B", "endpoint"), resource("/C", "network"), resource("/D", "standalone")],
  relations: [
    { sourceId: "/b", targetId: "/A", type: "connects_to", evidence: ["internal-field"] },
    { sourceId: "/B", targetId: "/a", type: "connects_to", evidence: ["duplicate"] },
    { sourceId: "/C", targetId: "/B", type: "secures", evidence: [] },
    { sourceId: "/C", targetId: "/absent", type: "routes", evidence: [] },
  ],
};

it("projects only saved relationships between resources from the same scan", () => {
  const topology = assessmentTopology(inventory);
  expect(topology.nodes).toHaveLength(4);
  expect(topology.edges).toEqual([
    { sourceId: "/b", targetId: "/a", type: "connects_to" },
    { sourceId: "/c", targetId: "/b", type: "secures" },
  ]);
  expect(JSON.stringify(topology)).not.toMatch(/hidden-sentinel|internal-field|absent/);
});

it("lays out a connected neighborhood and retains access to standalone resources", () => {
  const topology = assessmentTopology(inventory);
  expect(topologyNeighborhood(topology, "/a", 5).layers).toEqual([["/a"], ["/b"], ["/c"]]);
  expect(topologyNeighborhood(topology, "/d", 5).layers).toEqual([["/d"]]);
  expect(topologyNeighborhood(topology, "/a", 2)).toMatchObject({ layers: [["/a"], ["/b"]], hidden: 1 });
});

it("explains a saved violation in everyday language and retains its catalog details", () => {
  const f = reportFixture();
  const found = f.record.result!.local.findings[0];
  const issues = topologyIssues([
    { ...found, verdict: "violation", ruleId: "web-https-only" },
    { ...found, verdict: "unknown", ruleId: "web-https-only" },
  ], f.catalogData, "en");
  expect(issues).toHaveLength(1);
  expect(issues[0].summary).toMatch(/unencrypted/);
  expect(issues[0].description).toBe(f.catalogData.rules.rules.find(rule => rule.id === "web-https-only")?.description.en);
});

it("labels every node with its classified role and keeps the saved Azure ID for details", () => {
  const topology = assessmentTopology({ ...inventory, resources: [
    ...inventory.resources,
    { ...resource("/subscriptions/s/resourceGroups/web/providers/Microsoft.Web/sites/App-1", "App-1"), type: "Microsoft.Web/sites" },
    { ...resource("/E", "plan"), type: "microsoft.web/serverfarms" },
  ] });
  const app = topology.nodes.find(node => node.name === "App-1")!;
  expect(app).toMatchObject({ family: "web-app", azureId: "/subscriptions/s/resourceGroups/web/providers/Microsoft.Web/sites/App-1" });
  expect(topology.nodes.find(node => node.name === "plan")?.family).toBe("app-plan");
  expect(topology.nodes.find(node => node.name === "storage")?.family).toBe("storage");
  expect(topologyRoles(topology)).toEqual([
    { family: "storage", count: 4 }, { family: "app-plan", count: 1 }, { family: "web-app", count: 1 },
  ]);
});

it("finds resources without recorded connections by name, type, group or role label", () => {
  const topology = assessmentTopology(inventory);
  const label = (family: string) => family === "storage" ? "Storage accounts" : family;
  expect(searchTopology(topology, "stand", null, label).map(node => node.id)).toEqual(["/d"]);
  expect(searchTopology(topology, "STORAGE ACC", null, label)).toHaveLength(4);
  expect(searchTopology(topology, "  ", "storage", label)).toHaveLength(4);
  expect(searchTopology(topology, "group", "web-app", label)).toEqual([]);
});

it("projects saved App Service plan links only when both ends are in the scan", () => {
  const topology = assessmentTopology({ ...inventory, relations: [
    { sourceId: "/A", targetId: "/D", type: "hosts", evidence: ["site.serverFarmId"] },
    { sourceId: "/missing-plan", targetId: "/D", type: "hosts", evidence: ["site.serverFarmId"] },
  ] });
  expect(topology.edges).toEqual([{ sourceId: "/a", targetId: "/d", type: "hosts" }]);
});

it("keeps pass, violation and insufficient-data checks distinct with their evidence paths and next check", () => {
  const f = reportFixture();
  const found = f.record.result!.local.findings[0];
  const checks = topologyChecks([
    { ...found, id: "00000000-0000-4000-8000-000000000101", verdict: "violation", ruleId: "web-https-only", reasonCode: null },
    { ...found, id: "00000000-0000-4000-8000-000000000102", verdict: "unknown", ruleId: "web-minimum-tls", reasonCode: "missing-data",
      evidence: [{ resourceId: found.resourceId, propertyPath: "properties.siteConfig.minTlsVersion", observation: { state: "missing" } }] },
    { ...found, id: "00000000-0000-4000-8000-000000000103", verdict: "pass", ruleId: "storage-https-only", reasonCode: null },
    { ...found, id: "00000000-0000-4000-8000-000000000104", verdict: "violation", ruleId: "not-in-catalog", reasonCode: null },
  ], f.catalogData, "ko");
  expect(checks.map(check => check.verdict)).toEqual(["violation", "unknown", "pass"]);
  expect(checks[0]).toMatchObject({ ruleId: "web-https-only", summary: expect.stringMatching(/HTTPS/), nextCheck: expect.stringMatching(/HTTPS/) });
  expect(checks[1]).toMatchObject({ reasonCode: "missing-data", evidence: [{ propertyPath: "properties.siteConfig.minTlsVersion", state: "missing" }] });
  expect(checks[0].title).toBe(f.catalogData.rules.rules.find(rule => rule.id === "web-https-only")?.title.ko);
  expect(JSON.stringify(checks)).not.toMatch(/not-in-catalog/);
});
