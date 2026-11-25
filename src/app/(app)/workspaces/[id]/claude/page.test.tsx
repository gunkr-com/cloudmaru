import { beforeEach, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithI18n } from "@/test/render-with-i18n";
const m = vi.hoisted(() => ({ getWorkspace: vi.fn(), getWorkspaceClaudeSettings: vi.fn(), getWorkspaceClaudeOverview: vi.fn() }));
vi.mock("@/services/db/workspaces", () => m);
vi.mock("@/services/db/workspace-claude", () => m);
vi.mock("@/services/workspace-setup", () => m);
vi.mock("../../../setup/actions", () => ({ saveSetupAction: vi.fn(), testClaudeAction: vi.fn() }));
vi.mock("next/navigation", () => ({ notFound: (): never => { throw Error("NOT_FOUND"); } }));
vi.mock("./actions", () => ({ saveClaudeKeyAction: vi.fn() }));
vi.mock("@/i18n/server", async () => { const { createTranslator } = await import("@/i18n/translate"); return { getI18n: async () => ({ t: createTranslator("en") }) }; });
import Page from "./page";
const id = "00000000-0000-0000-0000-000000000011";
const props = (workspaceId = id) => ({ params: Promise.resolve({ id: workspaceId }), searchParams: Promise.resolve({ saved: "1" }) });
beforeEach(() => { vi.clearAllMocks(); m.getWorkspace.mockResolvedValue({ id, name: "Synthetic Company" }); m.getWorkspaceClaudeSettings.mockResolvedValue({ apiKeyEnv: null }); m.getWorkspaceClaudeOverview.mockResolvedValue({source:"disabled",apiKeyEnv:null,model:"",available:false,needsSetup:true}); });
it("shows disabled state and explicitly says save does not verify a key", async () => {
  renderWithI18n(await Page(props()), { locale: "en" });
  expect(screen.getByRole("heading", { name: "Claude API settings" })).toBeInTheDocument();
  expect(screen.getByText("AI unavailable. Add a key, set the referenced environment variable, or continue locally.")).toBeInTheDocument();
  // URL alone cannot prove that the latest edit was saved.
  expect(screen.queryByText("Reference saved. No API request was made.")).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Back to workspaces" })).toHaveAttribute("href", "/workspaces");
});
it("uses the URL workspace rather than the selected workspace", async () => {
  m.getWorkspaceClaudeSettings.mockResolvedValue({ apiKeyEnv: "CLOUDSIGHT_CLAUDE_KEY_ACME" }); m.getWorkspaceClaudeOverview.mockResolvedValue({source:"env",apiKeyEnv:"CLOUDSIGHT_CLAUDE_KEY_ACME",model:"claude-opus-5-5",available:true,needsSetup:false});
  renderWithI18n(await Page(props()), { locale: "en" });
  expect(m.getWorkspaceClaudeSettings).toHaveBeenCalledWith(id);
  expect(screen.getByLabelText("Environment variable name")).toHaveValue("CLOUDSIGHT_CLAUDE_KEY_ACME");
});
it("404s malformed, unknown, or missing workspace settings", async () => {
  await expect(Page(props("bad"))).rejects.toThrow("NOT_FOUND");
  expect(m.getWorkspace).not.toHaveBeenCalled();
  m.getWorkspace.mockResolvedValueOnce(null);
  await expect(Page(props())).rejects.toThrow("NOT_FOUND");
  m.getWorkspaceClaudeSettings.mockResolvedValue(null);
  await expect(Page(props())).rejects.toThrow("NOT_FOUND");
});
