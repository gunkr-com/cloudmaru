// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { processedFixture } from "@/lib/extend/proposal.test-data";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";
const m = vi.hoisted(() => ({ get: vi.fn(), workspace: vi.fn() }));
vi.mock("@/services/extension-job", () => ({ extensionJobs: { get: m.get } }));
vi.mock("@/services/current-workspace", () => ({ getCurrentWorkspace: m.workspace }));
import { GET } from "./route";
const read = (id: string) => GET(new Request("http://localhost"), { params: Promise.resolve({ id }) });
beforeEach(() => { vi.resetAllMocks(); });
it.each(["bad", "00000000-0000-4000-8000-000000000000"])("returns stable 404 for invalid or missing id %s", async id => {
  m.get.mockResolvedValue(null);
  const response = await read(id); expect(response.status).toBe(404);
  expect(await response.json()).toEqual({ code: "not-found" });
  if (id === "bad") expect(m.get).not.toHaveBeenCalled();
  expect(m.workspace).not.toHaveBeenCalled();
});
it("sanitizes cookie failures without exposing a validated stored result", async () => {
  const { result } = processedFixture();
  m.get.mockResolvedValue({ id: result.id, workspaceId: result.workspaceId });
  m.workspace.mockRejectedValue(Error("PRIVATE cookie path"));
  const response = await read(result.id); expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ code: "internal" });
});
it.each([
  [{}, 200], [{ host: "evil.test" }, 403], [{ origin: "https://evil.test" }, 403],
  [{ "content-type": "text/plain" }, 415],
] as const)("keeps the local Host/Origin/JSON guard on the new route: %j", async (overrides, status) => {
  const request = new NextRequest("http://localhost/api/extensions", { method: "POST", headers: {
    host: "localhost", origin: "http://localhost", "content-type": "application/json", ...overrides,
  } });
  expect((await proxy(request)).status).toBe(status);
  expect(m.get).not.toHaveBeenCalled();
});
