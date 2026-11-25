import { describe, expect, it, vi } from "vitest";
const { getCurrentWorkspace, listWorkspaces, listLlmUsageSince } = vi.hoisted(() => ({
  getCurrentWorkspace: vi.fn(), listWorkspaces: vi.fn(), listLlmUsageSince: vi.fn(),
}));
vi.mock("@/services/current-workspace", () => ({ getCurrentWorkspace }));
vi.mock("@/services/db/workspaces", () => ({ listWorkspaces }));
vi.mock("@/services/db/analyses", () => ({ listLlmUsageSince }));
vi.mock("@/components/shell/dashboard-shell", () => ({ DashboardShell: () => null }));
import Layout from "./layout";
describe("app layout", () => {
  it("기본 워크스페이스 확정 후 목록과 현지 월 사용량으로 셸 데이터를 만든다", async () => {
    const now = new Date();
    const workspace = { id: "w1", name: "Default", companyName: null, azureConnection: "private" };
    getCurrentWorkspace.mockResolvedValue(workspace);
    listWorkspaces.mockResolvedValue([workspace]);
    listLlmUsageSince.mockResolvedValue([{ costUsd: 0.003 }, { costUsd: null }]);
    const result = await Layout({ children: "내용" });
    expect(listLlmUsageSince).toHaveBeenCalledWith(new Date(now.getFullYear(), now.getMonth(), 1));
    expect(getCurrentWorkspace.mock.invocationCallOrder[0]).toBeLessThan(listWorkspaces.mock.invocationCallOrder[0]);
    expect(result.props).toEqual({ workspace: { id: "w1", name: "Default", companyName: null }, workspaces: [{ id: "w1", name: "Default", companyName: null }], monthlyCost: { totalUsd: 0.003, uncountedCalls: 1 }, children: "내용" });
  });
});
