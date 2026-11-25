import { expect, it, vi } from "vitest";
import { createCurrentWorkspaceService, WORKSPACE_COOKIE } from "./current-workspace";
import type { Workspace } from "@/types/workspace";
const first: Workspace = { id: "first", name: "First", companyName: null, defaultRegion: "canadacentral", currency: "CAD", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
const second = { ...first, id: "second" };
function setup(cookie: string | undefined, list = [first, second]) {
  const jar = { get: vi.fn().mockReturnValue(cookie === undefined ? undefined : { value: cookie }), set: vi.fn() };
  const deps = { cookies: vi.fn().mockResolvedValue(jar), listWorkspaces: vi.fn().mockResolvedValue(list), ensureDefaultWorkspace: vi.fn().mockResolvedValue(first) };
  return { jar, deps, service: createCurrentWorkspaceService(deps) };
}
it.each([undefined, "missing", "first", "second"])("reads current workspace without writing cookie: %s", async cookie => {
  const { jar, deps, service } = setup(cookie);
  expect(await service.getCurrentWorkspace()).toEqual(cookie === "second" ? second : first);
  expect(jar.get).toHaveBeenCalledWith("cs_workspace");
  expect(jar.set).not.toHaveBeenCalled();
  expect(deps.ensureDefaultWorkspace).not.toHaveBeenCalled();
});
it("ensures a default only when the list is empty", async () => {
  const { service, deps, jar } = setup("missing", []);
  expect(await service.getCurrentWorkspace()).toBe(first);
  expect(deps.ensureDefaultWorkspace).toHaveBeenCalledOnce();
  expect(jar.set).not.toHaveBeenCalled();
});
it("writes only the workspace ID with local HTTP cookie options", async () => {
  const { service, jar, deps } = setup(undefined);
  await service.setCurrentWorkspaceCookie(first.id);
  expect(WORKSPACE_COOKIE).toBe("cs_workspace");
  expect(jar.set).toHaveBeenCalledExactlyOnceWith("cs_workspace", first.id, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 365 * 24 * 60 * 60 });
  expect(deps.listWorkspaces).not.toHaveBeenCalled();
});
