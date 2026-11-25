// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ saveWorkspaceClaudeSettings: vi.fn(), revalidatePath: vi.fn(), redirect: vi.fn((path: string): never => { throw Error(`REDIRECT:${path}`); }) }));
vi.mock("@/services/db/workspace-claude", () => m);
vi.mock("next/cache", () => m);
vi.mock("next/navigation", () => m);
import { saveClaudeKeyAction } from "./actions";
const id = "00000000-0000-0000-0000-000000000011";
const ref = "CLOUDSIGHT_CLAUDE_KEY_ACME";
const form = (apiKeyEnv = ref, workspaceId = id) => { const data = new FormData(); data.set("apiKeyEnv", apiKeyEnv); data.set("workspaceId", workspaceId); return data; };
beforeEach(() => { vi.clearAllMocks(); m.saveWorkspaceClaudeSettings.mockResolvedValue(true); });
it("validates references without returning pasted credentials or writing invalid input", async () => {
  for (const value of ["fake-secret-key", "ANTHROPIC_API_KEY", "HOME"]) {
    expect(await saveClaudeKeyAction({}, form(value))).toEqual({ error: "workspace.claude.invalidReference" });
  }
  expect(await saveClaudeKeyAction({}, form(ref, "bad"))).toEqual({ error: "workspace.claude.saveFailed" });
  expect(m.saveWorkspaceClaudeSettings).not.toHaveBeenCalled();
});
it.each([[` ${ref} `, ref], ["", null]])("saves reference %s or disables explicitly", async (value, expected) => {
  await expect(saveClaudeKeyAction({}, form(value))).resolves.toEqual({ saved: true });
  expect(m.saveWorkspaceClaudeSettings).toHaveBeenCalledWith(id, { apiKeyEnv: expected });
  expect(m.revalidatePath).toHaveBeenCalledWith("/", "layout");
});
it.each([false, new Error("private-original")])("sanitizes save failure %s", async failure => {
  if (failure instanceof Error) m.saveWorkspaceClaudeSettings.mockRejectedValue(failure);
  else m.saveWorkspaceClaudeSettings.mockResolvedValue(failure);
  expect(await saveClaudeKeyAction({}, form())).toEqual({ error: "workspace.claude.saveFailed" });
  expect(m.redirect).not.toHaveBeenCalled();
});
it("rejects file input and missing fields without disabling AI accidentally", async () => {
  const data = form(); data.delete("apiKeyEnv");
  expect(await saveClaudeKeyAction({}, data)).toEqual({ error: "workspace.claude.invalidReference" });
  data.set("apiKeyEnv", new Blob(["fake-secret"]), "key.txt");
  expect(await saveClaudeKeyAction({}, data)).toEqual({ error: "workspace.claude.invalidReference" });
  expect(m.saveWorkspaceClaudeSettings).not.toHaveBeenCalled();
});
