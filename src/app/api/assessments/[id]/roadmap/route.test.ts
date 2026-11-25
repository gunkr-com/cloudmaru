// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ start: vi.fn(), get: vi.fn(), workspace: vi.fn(), after: vi.fn() }));
vi.mock("@/services/assessment-roadmap", () => ({ roadmapJobs: { start: mocks.start, get: mocks.get } }));
vi.mock("@/services/current-workspace", () => ({ getCurrentWorkspace: mocks.workspace }));
vi.mock("next/server", () => ({ after: mocks.after }));
import { GET, POST, maxDuration } from "./route";
const id = "00000000-0000-4000-8000-000000000001", workspaceId = "00000000-0000-4000-8000-000000000002";
const context = { params: Promise.resolve({ id }) };
function request(body: unknown) { return new Request(`http://localhost/api/assessments/${id}/roadmap`, { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }); }
beforeEach(() => { vi.resetAllMocks(); mocks.workspace.mockResolvedValue({ id: workspaceId }); mocks.start.mockResolvedValue({ status: 202, id }); });
it("strict body and URL identity reject caller attempts/IDs/usage before mutation", async () => {
  for (const body of [{}, { workspaceId, attemptId: id }, { workspaceId, id }, { workspaceId, usage: null }, null]) {
    expect((await POST(request(body), context)).status).toBe(400);
  }
  expect((await POST(request({ workspaceId }), { params: Promise.resolve({ id: "bad" }) })).status).toBe(404);
  expect(mocks.start).not.toHaveBeenCalled();
});
it("passes saved parent ID and current cookie separately; after schedules supplied task", async () => {
  expect(maxDuration).toBe(300);
  const response = await POST(request({ workspaceId }), context);
  expect(response.status).toBe(202); expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(await response.json()).toEqual({ id });
  expect(mocks.start).toHaveBeenCalledWith(id, workspaceId, workspaceId, expect.any(Function));
  const task = vi.fn(); mocks.start.mock.calls[0][3](task); expect(mocks.after).toHaveBeenCalledWith(task);
});
it("returns sanitized no-key/changed-workspace states and never provider errors", async () => {
  mocks.start.mockResolvedValue({ status: 409, code: "key-unavailable", workspaceId });
  expect(await (await POST(request({ workspaceId }), context)).json()).toEqual({ code: "key-unavailable", workspaceId });
  mocks.start.mockRejectedValue(new Error("SECRET provider"));
  expect(await (await POST(request({ workspaceId }), context)).json()).toEqual({ code: "internal" });
});
it("GET permits changed cookie saved reads and returns only validated status projection", async () => {
  mocks.get.mockResolvedValue({ id, workspaceMismatch: true, roadmap: { status: "pending" } });
  expect(await (await GET(new Request("http://localhost"), context)).json()).toMatchObject({ id, workspaceMismatch: true });
  expect(mocks.get).toHaveBeenCalledWith(id, workspaceId);
  mocks.get.mockResolvedValue(null); expect((await GET(new Request("http://localhost"), context)).status).toBe(404);
  mocks.get.mockRejectedValue(new Error("SECRET")); expect(await (await GET(new Request("http://localhost"), context)).json()).toEqual({ code: "internal" });
});
it("rejects malformed JSON and oversized body", async () => {
  expect((await POST(new Request("http://localhost", { method: "POST", body: "{" }), context)).status).toBe(400);
  expect((await POST(request({ workspaceId, more: "x".repeat(5000) }), context)).status).toBe(413);
});
