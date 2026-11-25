// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { assessment, ids } from "@/lib/completion/fixtures.test-data";
import { ASSESSMENT_STALE_MS } from "@/lib/assessment/app/job";
const m = vi.hoisted(() => ({ get: vi.fn(), fail: vi.fn(), workspace: vi.fn() }));
vi.mock("@/services/db/assessments", () => ({ getAssessment: m.get, failAssessment: m.fail }));
vi.mock("@/services/current-workspace", () => ({ getCurrentWorkspace: m.workspace }));
import { GET } from "./route";
const read = (id: string = ids.assessment) => GET(new Request("http://localhost"), { params: Promise.resolve({ id }) });
const saved = { id: ids.assessment, workspaceId: ids.workspace, sourceScanId: ids.scan, previousScanId: ids.oldScan,
  status: "succeeded", result: assessment, error: null, createdAt: "2026-11-11T00:00:00Z", roadmap: { status: "pending" } };
beforeEach(() => { vi.resetAllMocks(); m.workspace.mockResolvedValue({ id: ids.workspace }); m.get.mockResolvedValue(saved); });
afterEach(() => vi.useRealTimers());
it.each(["pending", "failed"])("returns local success twice regardless of roadmap %s or changed cookie", async status => {
  const record = { ...saved, roadmap: { status } }; m.get.mockResolvedValue(record);
  for (const mismatch of [false, true]) {
    m.workspace.mockResolvedValue({ id: mismatch ? ids.otherWorkspace : ids.workspace });
    const response = await read();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ ...record, workspaceMismatch: mismatch });
  }
  expect(m.fail).not.toHaveBeenCalled();
  expect(m.get).toHaveBeenNthCalledWith(1, ids.assessment);
  expect(m.get).toHaveBeenNthCalledWith(2, ids.assessment);
});
it("validates IDs before storage and returns missing rows as 404", async () => {
  expect((await read("bad")).status).toBe(404); expect(m.get).not.toHaveBeenCalled();
  m.get.mockResolvedValue(null);
  const response = await read(); expect(response.status).toBe(404);
  expect(await response.json()).toEqual({ code: "not-found" });
  expect(m.workspace).not.toHaveBeenCalled();
});
it.each([0, -1])("closes pending at/beyond the documented stale boundary (%s)", async offset => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-12T00:00:00Z"));
  const pending = { ...saved, status: "pending", result: null, createdAt: new Date(Date.now() - ASSESSMENT_STALE_MS + offset).toISOString() };
  const failed = { ...pending, status: "failed", error: { schemaVersion: 1, code: "interrupted" } };
  m.get.mockResolvedValueOnce(pending).mockResolvedValueOnce(failed); m.fail.mockResolvedValue(true);
  const response = await read();
  expect(m.fail).toHaveBeenCalledExactlyOnceWith(ids.assessment, "interrupted");
  expect(await response.json()).toEqual({ ...failed, workspaceMismatch: false });
});
it("does not expire fresh pending and rereads a concurrent terminal result instead of fabricating failure", async () => {
  vi.useFakeTimers();
  const pending = { ...saved, status: "pending", result: null, createdAt: new Date(Date.now() - ASSESSMENT_STALE_MS + 1).toISOString() };
  m.get.mockResolvedValue(pending); expect((await read()).status).toBe(200); expect(m.fail).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  m.get.mockResolvedValueOnce(pending).mockResolvedValueOnce(saved); m.fail.mockResolvedValue(false);
  expect(await (await read()).json()).toEqual({ ...saved, workspaceMismatch: false });
});
it.each(["get", "fail", "workspace"] as const)("sanitizes %s errors", async key => {
  m.get.mockResolvedValue({ ...saved, status: "pending", result: null });
  m[key].mockRejectedValue(Error("PRIVATE token /private.pem"));
  const response = await read(); expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ code: "internal" });
});
