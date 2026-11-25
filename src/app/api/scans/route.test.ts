// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { explicitNetworkResources } from "@/lib/inventory/fixtures.test-data";
const m = vi.hoisted(() => ({
  getCurrentWorkspace: vi.fn(), getWorkspaceAzureSettings: vi.fn(), reserveLiveScan: vi.fn(),
  createImportScan: vi.fn(), completeScan: vi.fn(), failScan: vi.fn(),
  createCertificateTokenProvider: vi.fn(), collectInventoryRows: vi.fn(), runLiveScanJob: vi.fn(), after: vi.fn(),
}));
vi.mock("@/services/current-workspace", () => ({ getCurrentWorkspace: m.getCurrentWorkspace }));
vi.mock("@/services/db/workspace-azure", () => ({ getWorkspaceAzureSettings: m.getWorkspaceAzureSettings }));
vi.mock("@/services/db/scans", () => ({ reserveLiveScan: m.reserveLiveScan, createImportScan: m.createImportScan, completeScan: m.completeScan, failScan: m.failScan }));
vi.mock("@/services/azure/credential", () => ({ createCertificateTokenProvider: m.createCertificateTokenProvider }));
vi.mock("@/services/azure/resource-graph", () => ({ collectInventoryRows: m.collectInventoryRows }));
vi.mock("next/server", () => ({ after: m.after }));
vi.mock("@/lib/scans/scan-job", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/scans/scan-job")>(), runLiveScanJob: m.runLiveScanJob,
}));
import { POST } from "./route";
import { SCAN_BODY_MAX_BYTES } from "@/lib/scans/read-json-body";
const id = "123e4567-e89b-42d3-a456-426614174000";
const live = { workspaceId: "workspace", source: "live" };
const post = (body: unknown = live) => POST(new Request("http://local", { method: "POST", body: JSON.stringify(body) }));
async function expectResponse(response: Response, status: number, body: unknown) {
  expect(response.status).toBe(status);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toEqual(body);
}
beforeEach(() => {
  vi.resetAllMocks();
  m.getCurrentWorkspace.mockResolvedValue({ id: "workspace" });
  m.getWorkspaceAzureSettings.mockResolvedValue({ connection: { certificatePath: "/private.pem" }, subscriptionIds: ["subscription"] });
  m.reserveLiveScan.mockResolvedValue({ id, created: true });
  m.createImportScan.mockResolvedValue(id);
  m.runLiveScanJob.mockResolvedValue(undefined);
});
describe("POST /api/scans", () => {
  it("reserves a live scan and runs the job only through after", async () => {
    await expectResponse(await post(), 202, { id, existing: false });
    expect(m.reserveLiveScan).toHaveBeenCalledWith({ workspaceId: "workspace", subscriptionIds: ["subscription"], staleBefore: expect.any(Date) });
    expect(m.after).toHaveBeenCalledTimes(1);
    expect(m.runLiveScanJob).not.toHaveBeenCalled();
    await m.after.mock.calls[0][0]();
    expect(m.runLiveScanJob).toHaveBeenCalledExactlyOnceWith({ id, workspaceId: "workspace" }, {
      getWorkspaceAzureSettings: m.getWorkspaceAzureSettings,
      createTokenProvider: m.createCertificateTokenProvider,
      collectInventoryRows: m.collectInventoryRows, completeScan: m.completeScan,
      failScan: m.failScan, now: expect.any(Function),
    });
    expect(m.runLiveScanJob.mock.calls[0][1].now()).toBeInstanceOf(Date);
  });
  it("reuses pending live scans without scheduling", async () => {
    m.reserveLiveScan.mockResolvedValue({ id, created: false });
    await expectResponse(await post(), 202, { id, existing: true });
    expect(m.after).not.toHaveBeenCalled();
  });
  it("stores an import immediately", async () => {
    await expectResponse(await post({ ...live, source: "import", data: explicitNetworkResources() }), 201, { id });
    expect(m.createImportScan).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: "workspace", inventory: expect.any(Object), summary: expect.any(Object) }));
    expect(m.after).not.toHaveBeenCalled();
    expect(m.getWorkspaceAzureSettings).not.toHaveBeenCalled();
  });
  it.each([
    [{}, 400, "invalid-body"],
    [{ ...live, workspaceId: "other" }, 409, "workspace-changed"],
    [{ ...live, source: "import", data: null }, 400, "import-invalid"],
    [{ ...live, source: "import", data: [] }, 400, "import-empty"],
  ])("returns validation codes for %j", async (body, status, code) => {
    await expectResponse(await post(body), status, { code });
    expect(m.after).not.toHaveBeenCalled();
  });
  it("returns connection-missing", async () => {
    m.getWorkspaceAzureSettings.mockResolvedValue(null);
    await expectResponse(await post(), 409, { code: "connection-missing" });
  });
  it("rejects malformed JSON before workspace lookup", async () => {
    await expectResponse(await POST(new Request("http://local", { method: "POST", body: "{" })), 400, { code: "invalid-body" });
    expect(m.getCurrentWorkspace).not.toHaveBeenCalled();
  });
  it("rejects oversized requests before workspace lookup", async () => {
    await expectResponse(await POST(new Request("http://local", { method: "POST", body: "{}", headers: { "Content-Length": String(SCAN_BODY_MAX_BYTES + 1) } })), 413, { code: "import-too-large" });
    expect(m.getCurrentWorkspace).not.toHaveBeenCalled();
  });
  it.each(["getCurrentWorkspace", "reserveLiveScan", "after"] as const)("hides %s errors", async key => {
    m[key].mockImplementation(() => { throw Error("private.pem token"); });
    await expectResponse(await post(), 500, { code: "internal" });
  });
});
