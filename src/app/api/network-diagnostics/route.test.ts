// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { completeSnapshot, ids, resourceIds } from "@/lib/completion/fixtures.test-data";
const m = vi.hoisted(() => ({ getCurrentWorkspace: vi.fn(), getNetworkSourceScan: vi.fn(), reserveNetworkDiagnostic: vi.fn(), completeNetworkDiagnostic: vi.fn(), failNetworkDiagnostic: vi.fn() }));
vi.mock("@/services/current-workspace", () => ({ getCurrentWorkspace: m.getCurrentWorkspace }));
vi.mock("@/services/db/network-diagnostics", () => m);
import { POST } from "./route";
const input = { schemaVersion: 1, workspaceId: ids.workspace, sourceScanId: ids.scan, query: { sourceScanId: ids.scan, sourceResourceId: resourceIds.vm, destinationResourceId: resourceIds.nic, protocol: "tcp", sourcePort: null, destinationPort: 443 } };
const post = (body: unknown = input) => POST(new Request("http://localhost/api/network-diagnostics", { method: "POST", body: JSON.stringify(body) }));
beforeEach(() => {
  vi.resetAllMocks();
  m.getCurrentWorkspace.mockResolvedValue({ id: ids.workspace });
  m.getNetworkSourceScan.mockResolvedValue({ scan: completeSnapshot.record, inventory: completeSnapshot.inventory });
  m.reserveNetworkDiagnostic.mockResolvedValue({ id: ids.network, status: "pending", created: true });
  m.completeNetworkDiagnostic.mockResolvedValue(true);
});
it("computes locally and stores without any Claude configuration", async () => {
  const response = await post();
  expect(response.status).toBe(201);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toEqual({ id: ids.network });
  expect(m.completeNetworkDiagnostic).toHaveBeenCalledWith(ids.network, expect.objectContaining({ engineVersion: expect.any(String) }));
});
it("reports oversized inventory as a calculation limit rather than an invalid query", async () => {
  const rows = Array.from({length:2001}, (_, n) => ({...completeSnapshot.inventory.resources.find(row => row.id === resourceIds.vm)!, id:`${resourceIds.vm}-${n}`}));
  m.getNetworkSourceScan.mockResolvedValue({scan:completeSnapshot.record, inventory:{...completeSnapshot.inventory, resources:rows}});
  const response = await post();
  expect(response.status).toBe(413);
  expect(await response.json()).toEqual({code:"inventory-too-large"});
  expect(m.reserveNetworkDiagnostic).not.toHaveBeenCalled();
});
it.each([
  [{ ...input, workspaceId: ids.otherWorkspace }, 409, "workspace-changed"],
  [{ ...input, query: { ...input.query, destinationPort: -1 } }, 400, "invalid-query"],
  [{ ...input, query: { ...input.query, sourceResourceId: `${resourceIds.vm}-missing` } }, 400, "resource-missing"],
  [{ ...input, query: { ...input.query, sourceAddressPrefix: "10.0.0.1" } }, 400, "invalid-query"],
])("rejects invalid input %j", async (body, status, code) => {
  const response = await post(body);
  expect(response.status).toBe(status);
  expect(await response.json()).toEqual({ code });
  expect(m.reserveNetworkDiagnostic).not.toHaveBeenCalled();
});
it.each([
  [null, 404, "scan-missing"],
  [{ scan: { ...completeSnapshot.record, workspaceId: ids.otherWorkspace }, inventory: completeSnapshot.inventory }, 404, "scan-missing"],
  [{ scan: { ...completeSnapshot.record, status: "pending" }, inventory: null }, 409, "scan-not-succeeded"],
])("validates stored scan %j", async (scan, status, code) => {
  m.getNetworkSourceScan.mockResolvedValue(scan);
  const response = await post();
  expect(response.status).toBe(status);
  expect(await response.json()).toEqual({ code });
  expect(m.reserveNetworkDiagnostic).not.toHaveBeenCalled();
});
it("returns coded failures and finalizes reserved rows on compute/storage error", async () => {
  m.completeNetworkDiagnostic.mockRejectedValue(Error("private token"));
  const response = await post();
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ code: "internal" });
  expect(m.failNetworkDiagnostic).toHaveBeenCalledWith(ids.network, "internal");
});
it("bounds bytes and rejects malformed JSON before loading workspace", async () => {
  for (const body of ["{", " ".repeat(16385)]) {
    const response = await POST(new Request("http://localhost", { method: "POST", body }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ code: "invalid-query" });
  }
  expect(m.getCurrentWorkspace).not.toHaveBeenCalled();
});
