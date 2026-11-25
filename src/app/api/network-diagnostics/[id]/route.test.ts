// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { ids, networkDiagnostic, resourceIds } from "@/lib/completion/fixtures.test-data";
import type { NetworkDiagnostic } from "@/types/network-diagnostics";
const get = vi.hoisted(() => vi.fn());
vi.mock("@/services/db/network-diagnostics", () => ({ getNetworkDiagnostic: get }));
import { GET } from "./route";
const read = (id = ids.network as string) => GET(new Request("http://localhost"), { params: Promise.resolve({ id }) });
beforeEach(() => vi.resetAllMocks());
it("reads saved owner without current workspace or latest scan", async () => {
  const saved = { id: ids.network, workspaceId: ids.otherWorkspace, status: "succeeded", result: networkDiagnostic };
  get.mockResolvedValue(saved);
  const response = await read();
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toEqual(saved);
});
it("redacts secret evidence at the API boundary without changing the saved result", async () => {
  const result: NetworkDiagnostic = structuredClone(networkDiagnostic);
  result.engine.paths = [{ verdict: "unknown", reasonCodes: ["missing-data"], hops: [{
    resourceId: resourceIds.nsg, hopType: "nsg", verdict: "unknown", reasonCodes: ["missing-data"],
    evidence: [{ resourceId: resourceIds.nsg, propertyPath: "/properties/password", observation: { state: "present", value: "private-fixture-secret" } }],
  }] }];
  get.mockResolvedValue({ status: "succeeded", result });
  const response = await read();
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(JSON.stringify(body)).not.toContain("private-fixture-secret");
  expect(body.result.engine.verdict).toBe(result.engine.verdict);
  expect(result.engine.paths[0].hops[0].evidence[0].observation.state).toBe("present");
});
it("rejects malformed and missing IDs", async () => {
  expect((await read("bad")).status).toBe(404);
  expect(get).not.toHaveBeenCalled();
  get.mockResolvedValue(null);
  expect((await read()).status).toBe(404);
});
it("hides storage details", async () => {
  get.mockRejectedValue(Error("private path"));
  const response = await read();
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ code: "internal" });
});
