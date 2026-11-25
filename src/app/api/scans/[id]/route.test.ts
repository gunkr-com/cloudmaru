// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ getScan: vi.fn() }));
vi.mock("@/services/db/scans", () => ({ getScan: m.getScan }));
import { GET } from "./route";
const id = "123e4567-e89b-42d3-a456-426614174000";
const get = (value = id) => GET(new Request("http://local"), { params: Promise.resolve({ id: value }) });
const record = {
  id, workspaceId: "other-workspace", source: "live", status: "pending", errorCode: null,
  subscriptionIds: ["subscription"], summary: null, collectedAt: null,
  createdAt: new Date().toISOString(), completedAt: null,
};
async function check(response: Response, status: number, body: unknown) {
  expect(response.status).toBe(status);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toEqual(body);
}
beforeEach(() => { vi.resetAllMocks(); m.getScan.mockResolvedValue(null); });
describe("GET /api/scans/[id]", () => {
  it.each(["bad", "../scan", "123e4567-e89b-42d3-a456-426614174000-extra"])("rejects invalid UUID %s without lookup", async value => {
    await check(await get(value), 404, { code: "not-found" });
    expect(m.getScan).not.toHaveBeenCalled();
  });
  it("returns not-found for an absent scan", async () => {
    await check(await get(), 404, { code: "not-found" });
    expect(m.getScan).toHaveBeenCalledWith(id);
  });
  it("returns only the allowed fields, including scans from another workspace", async () => {
    m.getScan.mockResolvedValue({ ...record, resources: ["private"], inventory: { resources: ["private"] }, certificatePath: "/private.pem", token: "private" });
    await check(await get(), 200, record);
  });
  it("resolves stale pending to failed/interrupted", async () => {
    const stale = { ...record, createdAt: new Date(Date.now() - 16 * 60_000).toISOString() };
    m.getScan.mockResolvedValue(stale);
    await check(await get(), 200, { ...stale, status: "failed", errorCode: "interrupted" });
  });
  it.each(["succeeded", "failed"])("preserves terminal status %s", async status => {
    const terminal = { ...record, status, createdAt: "2020-01-01T00:00:00Z" };
    m.getScan.mockResolvedValue(terminal);
    await check(await get(), 200, terminal);
  });
  it("hides storage errors", async () => {
    m.getScan.mockRejectedValue(Error("private.pem token"));
    await check(await get(), 500, { code: "internal" });
  });
});
