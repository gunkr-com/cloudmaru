// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ getAnalysis: vi.fn() })); vi.mock("@/services/db/analyses", () => ({ getAnalysis: m.getAnalysis }));
import { GET } from "./route";
const id = "123e4567-e89b-42d3-a456-426614174000";
const ctx = (value: string) => ({ params: Promise.resolve({ id: value }) });
beforeEach(() => { vi.clearAllMocks(); m.getAnalysis.mockResolvedValue(null); });
describe("GET /api/analyses/[id]", () => { it("does not query invalid UUID", async () => { expect((await GET(new Request("http://local"), ctx("bad"))).status).toBe(404); expect(m.getAnalysis).not.toHaveBeenCalled(); }); it("returns 404 when absent", async () => { expect((await GET(new Request("http://local"), ctx(id))).status).toBe(404); }); it("returns status only", async () => { m.getAnalysis.mockResolvedValue({ id, status: "pending", createdAt: new Date().toISOString(), errorStage: null, result: { secret: true } }); const r = await GET(new Request("http://local"), ctx(id)); expect(r.status).toBe(200); expect(await r.json()).toEqual({ id, status: "pending", failureReason: null }); expect(r.headers.get("cache-control")).toBe("no-store"); }); });

it("hides storage failures", async () => {
  m.getAnalysis.mockRejectedValueOnce(Error("private"));
  const response = await GET(new Request("http://local"), ctx(id));
  expect(response.status).toBe(500);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toEqual({ message: "analysis.requestFailed" });
});

it("분석을 찾지 못하면 문장 대신 사전 키를 반환한다", async () => {
  for (const value of ["bad", id]) {
    const response = await GET(new Request("http://local"), ctx(value));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ message: "common.analysisNotFound" });
  }
});
