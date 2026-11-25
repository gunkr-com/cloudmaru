// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  createWorkspace: vi.fn(), updateWorkspace: vi.fn(), getWorkspace: vi.fn(),
  setCurrentWorkspaceCookie: vi.fn(), revalidatePath: vi.fn(),
  redirect: vi.fn((path: string): never => { throw new Error(`REDIRECT:${path}`); }),
}));
vi.mock("@/services/db/workspaces", () => mocks);
vi.mock("@/services/current-workspace", () => mocks);
vi.mock("next/cache", () => mocks);
vi.mock("next/navigation", () => mocks);
import { createWorkspaceAction, updateWorkspaceAction } from "./actions";
const id = "11111111-1111-4111-8111-111111111111";
const values = { name: " Team ", companyName: " Company ", defaultRegion: "canadacentral" };
const form = (patch: Record<string, string> = {}) => {
  const data = new FormData();
  Object.entries({ ...values, workspaceId: id, ...patch }).forEach(([key, value]) => data.set(key, value));
  return data;
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.getWorkspace.mockResolvedValue({ id });
  mocks.createWorkspace.mockResolvedValue({ id });
  mocks.updateWorkspace.mockResolvedValue({ id });
});
it("validates fields and returns submitted values without writing", async () => {
  const state = await createWorkspaceAction({}, form({ name: " ", defaultRegion: "wrong" }));
  expect(state.errors?.name).toBeDefined();
  expect(state.errors?.defaultRegion).toBeDefined();
  expect(state.values).toEqual({ ...values, name: " ", defaultRegion: "wrong" });
  expect(mocks.createWorkspace).not.toHaveBeenCalled();
});
it("creates, selects, revalidates the shell and redirects", async () => {
  await expect(createWorkspaceAction({}, form())).rejects.toThrow("REDIRECT:/analyses/new");
  expect(mocks.createWorkspace).toHaveBeenCalledWith({ name: "Team", companyName: "Company", defaultRegion: "canadacentral" });
  expect(mocks.setCurrentWorkspaceCookie).toHaveBeenCalledWith(id);
  expect(mocks.revalidatePath).toHaveBeenCalledWith("/", "layout");
});
it("updates existing workspace then returns to the list", async () => {
  await expect(updateWorkspaceAction({}, form())).rejects.toThrow("REDIRECT:/workspaces");
  expect(mocks.updateWorkspace).toHaveBeenCalledWith(id, { name: "Team", companyName: "Company", defaultRegion: "canadacentral" });
  expect(mocks.setCurrentWorkspaceCookie).not.toHaveBeenCalled();
});
it.each(["", "bad-id", "../../foo"])("rejects malformed update ID %s without touching storage", async workspaceId => {
  expect((await updateWorkspaceAction({}, form({ workspaceId }))).message).toBeTruthy();
  expect(mocks.getWorkspace).not.toHaveBeenCalled();
  expect(mocks.updateWorkspace).not.toHaveBeenCalled();
});
it("does not update an absent workspace", async () => {
  mocks.getWorkspace.mockResolvedValue(null);
  expect((await updateWorkspaceAction({}, form())).message).toBeTruthy();
  expect(mocks.updateWorkspace).not.toHaveBeenCalled();
  expect(mocks.redirect).not.toHaveBeenCalled();
});
it("rejects invalid update fields", async () => {
  expect((await updateWorkspaceAction({}, form({ name: "" }))).errors?.name).toBeDefined();
  expect(mocks.updateWorkspace).not.toHaveBeenCalled();
});
it.each(["create", "update"])("hides %s storage errors and preserves values", async mode => {
  mocks.createWorkspace.mockRejectedValue(new Error("secret path"));
  mocks.updateWorkspace.mockRejectedValue(new Error("secret path"));
  const action = mode === "create" ? createWorkspaceAction : updateWorkspaceAction;
  expect(await action({}, form())).toEqual({ values, message: "workspace.errors.save" });
  expect(mocks.redirect).not.toHaveBeenCalled();
});
it("handles a workspace disappearing before update", async () => {
  mocks.updateWorkspace.mockResolvedValue(null);
  expect((await updateWorkspaceAction({}, form())).message).toBeTruthy();
  expect(mocks.redirect).not.toHaveBeenCalled();
});
