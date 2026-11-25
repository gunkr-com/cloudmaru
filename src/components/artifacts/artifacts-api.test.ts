import { afterEach, describe, expect, it, vi } from "vitest";
import { artifactsApi } from "@/components/artifacts/artifacts-api";

describe("artifactsApi", () => {
  it("preserves the owning workspace on a missing-key response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ message: "workspace.claude.unavailable", workspaceId: "owner-company" }, { status: 409 })));
    expect(await artifactsApi.request("analysis-id", "balanced", "guide")).toEqual({ ok: false, status: 409, message: "workspace.claude.unavailable", workspaceId: "owner-company" });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("목록을 같은 출처 GET으로 읽는다", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ artifacts: [] }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await artifactsApi.list("analysis-id")).toEqual({ ok: true, artifacts: [] });
    expect(fetchMock).toHaveBeenCalledWith("/api/analyses/analysis-id/artifacts", { method: "GET" });
  });

  it("결과물 요청을 POST하고 상태별 응답을 보존한다", async () => {
    const artifact = { tier: "balanced", kind: "guide", status: "pending", content: null, createdAt: "2026-01-01T00:00:00Z", completedAt: null };
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ artifact }, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await artifactsApi.request("analysis-id", "balanced", "guide")).toEqual({ ok: true, status: 202, artifact });
    expect(fetchMock).toHaveBeenCalledWith("/api/analyses/analysis-id/artifacts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tier: "balanced", kind: "guide" }) });
    fetchMock.mockResolvedValue(Response.json({ message: "artifacts.analysisUnavailable" }, { status: 404 }));
    expect(await artifactsApi.request("analysis-id", "balanced", "guide")).toEqual({ ok: false, status: 404, message: "artifacts.analysisUnavailable" });
  });

  it("네트워크 오류를 status 0으로 반환한다", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    expect(await artifactsApi.list("analysis-id")).toEqual({ ok: false, status: 0 });
  });
});
