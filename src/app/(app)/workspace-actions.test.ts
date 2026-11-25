// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
const { redirect, getWorkspace, setCurrentWorkspaceCookie } = vi.hoisted(() => ({
  redirect: vi.fn((path: string): never => { throw new Error(`REDIRECT:${path}`); }),
  getWorkspace: vi.fn(), setCurrentWorkspaceCookie: vi.fn(),
}));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("@/services/db/workspaces", () => ({ getWorkspace }));
vi.mock("@/services/current-workspace", () => ({ setCurrentWorkspaceCookie }));
import { selectWorkspace } from "./workspace-actions";
const id = "11111111-1111-4111-8111-111111111111";
describe("selectWorkspace", () => {
  beforeEach(() => { vi.clearAllMocks(); getWorkspace.mockResolvedValue({ id }); });
  it("존재하는 UUID만 쿠키에 저장하고 새 분석으로 이동한다", async () => {
    const form = new FormData(); form.set("workspaceId", id);
    await expect(selectWorkspace(form)).rejects.toThrow("REDIRECT:/analyses/new");
    expect(getWorkspace).toHaveBeenCalledWith(id);
    expect(setCurrentWorkspaceCookie).toHaveBeenCalledWith(id);
    expect(setCurrentWorkspaceCookie.mock.invocationCallOrder[0]).toBeLessThan(redirect.mock.invocationCallOrder[0]);
  });
  it.each([null, "", "invalid", "../../foo"])("잘못된 ID %s는 조회하지 않는다", async value => {
    const form = new FormData(); if (value !== null) form.set("workspaceId", value);
    await selectWorkspace(form);
    expect(getWorkspace).not.toHaveBeenCalled();
    expect(setCurrentWorkspaceCookie).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });
  it("없는 워크스페이스는 쿠키를 바꾸지 않는다", async () => {
    getWorkspace.mockResolvedValue(null);
    const form = new FormData(); form.set("workspaceId", id);
    await selectWorkspace(form);
    expect(setCurrentWorkspaceCookie).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });
});
