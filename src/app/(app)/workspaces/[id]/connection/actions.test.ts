// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  saveWorkspaceAzureSettings: vi.fn(), revalidatePath: vi.fn(),
  redirect: vi.fn((path: string): never => { throw new Error(`REDIRECT:${path}`); }),
  notFound: vi.fn((): never => { throw new Error("NOT_FOUND"); }),
}));
vi.mock("@/services/db/workspace-azure", () => mocks);
vi.mock("next/cache", () => mocks);
vi.mock("next/navigation", () => mocks);
import { saveAzureConnectionAction, removeAzureConnectionAction } from "./actions";
const id = "00000000-0000-0000-0000-000000000011";
const values = {
  tenantId: "00000000-0000-0000-0000-0000000000AA", clientId: "00000000-0000-0000-0000-0000000000BB",
  certificatePath: "/fake/certificate.pem", certificatePasswordEnv: "", subscriptionIds: "00000000-0000-0000-0000-000000000001",
};
const form = (patch: Record<string, string> = {}) => {
  const data = new FormData();
  Object.entries({ ...values, workspaceId: id, ...patch }).forEach(([key, value]) => data.set(key, value));
  return data;
};
beforeEach(() => { vi.clearAllMocks(); mocks.saveWorkspaceAzureSettings.mockResolvedValue(true); });
it("returns original invalid values without writing", async () => {
  expect(await saveAzureConnectionAction({}, form({ tenantId: "bad" }))).toEqual({ errors: { tenantId: "tenant-id-invalid" } });
  expect(mocks.saveWorkspaceAzureSettings).not.toHaveBeenCalled();
});
it.each(["", "bad", "../../other"])("rejects invalid workspace ID %s", async workspaceId => {
  expect(await saveAzureConnectionAction({}, form({ workspaceId }))).toEqual({ message: "inventory.connection.form.errors.save" });
  await expect(removeAzureConnectionAction(form({ workspaceId }))).rejects.toThrow("NOT_FOUND");
  expect(mocks.saveWorkspaceAzureSettings).not.toHaveBeenCalled();
});
it.each([false, new Error("private original error")])("hides save failure %s and preserves input", async failure => {
  if (failure instanceof Error) mocks.saveWorkspaceAzureSettings.mockRejectedValue(failure);
  else mocks.saveWorkspaceAzureSettings.mockResolvedValue(failure);
  expect(await saveAzureConnectionAction({}, form())).toEqual({ message: "inventory.connection.form.errors.save" });
  expect(mocks.redirect).not.toHaveBeenCalled();
});
it("saves normalized settings, revalidates and redirects outside the catch", async () => {
  await expect(saveAzureConnectionAction({}, form())).rejects.toThrow(`REDIRECT:/workspaces/${id}/connection?saved=1`);
  expect(mocks.saveWorkspaceAzureSettings).toHaveBeenCalledWith(id, {
    connection: { tenantId: values.tenantId.toLowerCase(), clientId: values.clientId.toLowerCase(), certificatePath: values.certificatePath, certificatePasswordEnv: null },
    subscriptionIds: [values.subscriptionIds],
  });
  expect(mocks.revalidatePath).toHaveBeenCalledWith("/", "layout");
});
it("removes the connection and subscriptions and redirects", async () => {
  await expect(removeAzureConnectionAction(form())).rejects.toThrow(`REDIRECT:/workspaces/${id}/connection?removed=1`);
  expect(mocks.saveWorkspaceAzureSettings).toHaveBeenCalledWith(id, { connection: null, subscriptionIds: [] });
  expect(mocks.revalidatePath).toHaveBeenCalledWith("/", "layout");
});
it.each([false, new Error("private original error")])("does not report removal success on failure %s", async failure => {
  if (failure instanceof Error) mocks.saveWorkspaceAzureSettings.mockRejectedValue(failure);
  else mocks.saveWorkspaceAzureSettings.mockResolvedValue(failure);
  await expect(removeAzureConnectionAction(form())).rejects.toThrow(`REDIRECT:/workspaces/${id}/connection?error=save`);
  expect(mocks.revalidatePath).not.toHaveBeenCalled();
});
