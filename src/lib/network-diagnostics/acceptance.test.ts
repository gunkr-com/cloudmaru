// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDatabase, insertTestWorkspace } from "@/lib/db/test-db.test-data";
import { summarizeInventory } from "@/lib/inventory/summarize";
import { networkDiagnosticSchema } from "@/lib/completion/schema";
import { createScansDb } from "@/services/db/scans";
import { createNetworkDiagnosticsDb } from "@/services/db/network-diagnostics";
import { BASE, SUBSCRIPTION, VNET_ID, SUBNET_ID, NSG_ID, RT_ID, VM_ID, NIC_ID, resource, nsgResource, allowRule, denyRule, routeTableResource, routeEntry } from "@/lib/network/fixtures.test-data";
import type { NetworkInput } from "./validation";
import { networkResources } from "./validation";
const dependencies = vi.hoisted(() => ({ db: vi.fn(), workspace: vi.fn() }));
vi.mock("@/services/db/client", () => ({ getDb: dependencies.db }));
vi.mock("@/services/current-workspace", () => ({ getCurrentWorkspace: dependencies.workspace }));
vi.mock("@/lib/network", async importOriginal => {
  const actual = await importOriginal<typeof import("@/lib/network")>();
  return { ...actual, diagnosePath: vi.fn(actual.diagnosePath) };
});
import { diagnosePath } from "@/lib/network";
import { POST } from "@/app/api/network-diagnostics/route";
import { GET } from "@/app/api/network-diagnostics/[id]/route";

const destinationVm = `${BASE}/microsoft.compute/virtualmachines/destination`;
const destinationNic = `${BASE}/microsoft.network/networkinterfaces/destination`;
type Scenario = "allow" | "deny" | "missing-subnet" | "missing-route" | "service-tag" | "appliance";
function fixture(scenario: Scenario) {
  const resources = [
    resource(VNET_ID, "microsoft.network/virtualnetworks", { addressSpace: { addressPrefixes: ["10.0.0.0/16"] } }),
    resource(SUBNET_ID, "microsoft.network/virtualnetworks/subnets", { networkSecurityGroup: { id: NSG_ID }, routeTable: null }),
    nsgResource(NSG_ID, { securityRules: [allowRule("in"), allowRule("out", { direction: "outbound" })] }),
    ...[[VM_ID, NIC_ID, "10.0.1.4"], [destinationVm, destinationNic, "10.0.1.5"]].flatMap(([vm, nic, ip]) => [
      resource(vm, "microsoft.compute/virtualmachines", { networkProfile: { networkInterfaces: [{ id: nic }] } }),
      resource(nic, "microsoft.network/networkinterfaces", { networkSecurityGroup: null, ipConfigurations: [{ properties: { privateIPAddress: ip, subnet: { id: SUBNET_ID } } }] }),
    ]),
  ];
  if (scenario === "deny") resources[2].properties.securityRules = [denyRule("deny-out", { priority: 100, direction: "outbound" }), allowRule("out", { priority: 200, direction: "outbound" })];
  if (scenario === "service-tag") resources[2].properties.securityRules = [allowRule("in"), denyRule("tag", { direction: "outbound", destPrefix: "AzureMonitor" })];
  if (scenario === "missing-subnet") resources.splice(1, 1);
  if (scenario === "missing-route" || scenario === "appliance") resources[1].properties.routeTable = { id: RT_ID };
  if (scenario === "appliance") resources.push(routeTableResource(RT_ID, { routes: [routeEntry("nva", { addressPrefix: "10.0.1.5/32", nextHopType: "VirtualAppliance", nextHopIp: "10.0.1.8" })] }));
  return resources;
}
let db: PGlite;
let input: NetworkInput;
let store: ReturnType<typeof createNetworkDiagnosticsDb>;
async function savedInput(scenario: Scenario): Promise<NetworkInput> {
  const resources = fixture(scenario);
  const sourceScanId = await createScansDb({ db: async () => db }).createImportScan({
    workspaceId: input.workspaceId, subscriptionIds: [SUBSCRIPTION], collectedAt: "2026-11-10T12:00:00Z",
    inventory: { resources, containers: [], relations: [], skippedRows: 0 }, summary: summarizeInventory(resources, []),
  });
  return { schemaVersion: 1, workspaceId: input.workspaceId, sourceScanId, query: { sourceScanId, sourceResourceId: VM_ID, destinationResourceId: destinationVm, protocol: "tcp", sourcePort: null, destinationPort: 443 } };
}
const post = (body: unknown) => POST(new Request("http://localhost/api/network-diagnostics", { method: "POST", body: JSON.stringify(body) }));
const get = (id: string) => GET(new Request(`http://localhost/api/network-diagnostics/${id}`), { params: Promise.resolve({ id }) });
beforeEach(async () => {
  vi.clearAllMocks();
  db = await createTestDatabase();
  dependencies.db.mockResolvedValue(db);
  const workspaceId = await insertTestWorkspace(db);
  input = { workspaceId } as NetworkInput;
  dependencies.workspace.mockResolvedValue({ id: workspaceId });
  store = createNetworkDiagnosticsDb({ db: async () => db });
  input = await savedInput("allow");
});
afterEach(async () => { await db.close(); });

it("uses omission semantics only for a complete live source, preserving import uncertainty", async () => {
  const saved = (await store.getNetworkSourceScan(input.sourceScanId))!;
  const inventory = structuredClone(saved.inventory!);
  for (const row of inventory.resources) {
    row.observedFields = ["properties"];
    delete row.properties.networkSecurityGroup;
    delete row.properties.routeTable;
  }
  await db.query("update scans set source='live', inventory=$2 where id=$1", [input.sourceScanId, inventory]);
  const live = await post(input);
  expect(live.status).toBe(201);
  const result = (await store.getNetworkDiagnostic((await live.json()).id))!.result!;
  expect(result.sourceScan.completeness.state).toBe("complete");
  expect(result.engine.verdict).toBe("allowed");
  expect(result.engine.reasonCodes).toContain("nsg-not-attached");
  await db.query("update scans set source='import' where id=$1", [input.sourceScanId]);
  const imported = await post(input);
  expect(imported.status).toBe(201);
  const importedResult = (await store.getNetworkDiagnostic((await imported.json()).id))!.result!;
  expect(importedResult.engine.verdict).toBe("unknown");
  expect(importedResult.sourceScan.completeness.reasons).toContain("import-scope-unverified");
});

it.each([
  ["allow", "allowed", "nsg-rule-decisive-allow"],
  ["deny", "blocked", "nsg-rule-decisive-deny"],
  ["missing-subnet", "unknown", null],
  ["missing-route", "unknown", "route-table-reference-missing"],
  ["service-tag", "unknown", "service-tag-unsupported"],
  ["appliance", "unknown", "route-next-hop-virtual-appliance"],
] as const)("saved scan → POST → persisted %s → GET after workspace change", async (scenario, verdict, reason) => {
  input = await savedInput(scenario);
  const response = await post(input);
  expect(response.status).toBe(201);
  const { id } = await response.json();
  const stored = (await store.getNetworkDiagnostic(id))!;
  expect(stored.status).toBe("succeeded");
  const result = networkDiagnosticSchema.parse(stored.result);
  expect(result.engine.verdict).toBe(verdict);
  if (reason) expect(result.engine.reasonCodes).toContain(reason);
  if (verdict === "unknown") expect(result.engine.reasonCodes.length).toBeGreaterThan(0);
  const members = new Set(networkResources((await store.getNetworkSourceScan(input.sourceScanId))!.inventory!.resources).map(row => row.id));
  expect(members.has(result.query.sourceResourceId)).toBe(true);
  expect(members.has(result.query.destinationResourceId)).toBe(true);
  for (const path of result.engine.paths) for (const hop of path.hops) {
    expect(members.has(hop.resourceId)).toBe(true);
    for (const evidence of hop.evidence) expect(members.has(evidence.resourceId)).toBe(true);
  }
  const raw = await db.query<{ result: unknown }>("select result from network_diagnostics where id=$1", [id]);
  expect(raw.rows[0].result).toEqual(result);
  // 다른 탭의 쿠키 변경과 최신 스캔 추가가 과거 결과를 재계산하지 않는다.
  const otherWorkspace = await insertTestWorkspace(db);
  dependencies.workspace.mockResolvedValue({ id: otherWorkspace });
  await savedInput("deny");
  vi.mocked(diagnosePath).mockClear();
  dependencies.workspace.mockClear();
  for (let reopen = 0; reopen < 2; reopen++) {
    const reopened = await get(id);
    expect(reopened.status).toBe(200);
    expect(reopened.headers.get("cache-control")).toBe("no-store");
    expect(await reopened.json()).toEqual(stored);
  }
  expect(diagnosePath).not.toHaveBeenCalled();
  expect(dependencies.workspace).not.toHaveBeenCalled();
  expect(await store.listNetworkDiagnostics(otherWorkspace)).toEqual([]);
  expect(await store.listNetworkDiagnostics(input.workspaceId)).toHaveLength(1);
});

it.each([
  { destinationPort: null }, { destinationPort: -1 }, { destinationPort: 65536 },
  { destinationPort: 1.5 }, { destinationPort: "443" }, { sourcePort: 65536 },
  { protocol: "icmp", destinationPort: 443 }, { protocol: "any", sourcePort: 1 },
  { protocol: "https" }, { destinationResourceId: `${destinationVm}-outside` },
  { sourceResourceId: `${VM_ID}-outside` },
])("rejects parameters before reservation: %j", async query => {
  expect((await post({ ...input, query: { ...input.query, ...query } })).status).toBe(400);
  expect((await db.query("select id from network_diagnostics")).rows).toEqual([]);
  expect(diagnosePath).not.toHaveBeenCalled();
});
it("rejects another scan's endpoint and changed workspace without creating jobs", async () => {
  const scans = createScansDb({ db: async () => db });
  const otherInput = await savedInput("missing-subnet");
  const other = (await scans.getScanInventory(otherInput.sourceScanId))!;
  const foreignId = `${destinationVm}-other-scan`;
  other.resources.push(resource(foreignId, "microsoft.compute/virtualmachines"));
  await db.query("update scans set inventory=$2 where id=$1", [otherInput.sourceScanId, other]);
  expect((await post({ ...input, query: { ...input.query, destinationResourceId: foreignId } })).status).toBe(400);
  dependencies.workspace.mockResolvedValue({ id: await insertTestWorkspace(db) });
  expect((await post(input)).status).toBe(409);
  expect((await db.query("select id from network_diagnostics")).rows).toEqual([]);
});
it("reopens stale jobs as interrupted and prevents late success from overwriting them", async () => {
  const reserved = (await store.reserveNetworkDiagnostic(input))!;
  await db.query("update network_diagnostics set created_at=now()-interval '20 minutes' where id=$1", [reserved.id]);
  dependencies.workspace.mockResolvedValue({ id: await insertTestWorkspace(db) });
  const response = await get(reserved.id);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ status: "failed", result: null, error: { schemaVersion: 1, code: "interrupted" } });
  const engine = diagnosePath(fixture("allow"), input.query);
  expect(await store.completeNetworkDiagnostic(reserved.id, engine)).toBe(false);
  expect((await store.getNetworkDiagnostic(reserved.id))!.error!.code).toBe("interrupted");
});
