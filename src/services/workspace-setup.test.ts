// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ readWorkspaceSecret: vi.fn(), writeWorkspaceSecret: vi.fn(), getWorkspaceClaudeSettings: vi.fn(), getWorkspace: vi.fn(), fetch: vi.fn() }));
vi.mock("./workspace-secrets", async original => ({ ...await original<typeof import("./workspace-secrets")>(), ...m }));
vi.mock("./db/workspace-claude", () => m);
vi.mock("./db/workspaces", () => m);
import { getWorkspaceClaudeOverview, resolveWorkspaceClaude, saveWorkspaceClaudeSetup, testWorkspaceClaude } from "./workspace-setup";
beforeEach(() => { vi.resetAllMocks(); m.readWorkspaceSecret.mockResolvedValue(null); m.getWorkspace.mockResolvedValue({ id: "id" }); m.getWorkspaceClaudeSettings.mockResolvedValue({ apiKeyEnv: "CLOUDSIGHT_CLAUDE_KEY_TEST" }); vi.stubEnv("CLOUDSIGHT_CLAUDE_KEY_TEST", "synthetic-env"); vi.stubEnv("CLAUDE_MODEL", "claude-opus-5-5"); });
afterEach(()=>vi.unstubAllEnvs());
it("keeps legacy references and exposes only safe configuration metadata", async () => {
  expect(await resolveWorkspaceClaude("id")).toEqual({ apiKeyEnv: "CLOUDSIGHT_CLAUDE_KEY_TEST" });
  m.readWorkspaceSecret.mockResolvedValue({ source: "key", apiKey: "synthetic-private", model: "claude-sonnet-5-5" });
  const overview = await getWorkspaceClaudeOverview("id");
  expect(overview).toMatchObject({ source: "key", available: true, model: "claude-sonnet-5-5", needsSetup: false });
  expect(JSON.stringify(overview)).not.toContain("synthetic-private");
  expect(await resolveWorkspaceClaude("id")).toEqual({ apiKey: "synthetic-private", apiKeyEnv: null, model: "claude-sonnet-5-5" });
});
it("disabled overrides legacy keys and storage errors never fall back", async () => {
  m.readWorkspaceSecret.mockResolvedValue({ source: "disabled" });
  expect(await resolveWorkspaceClaude("id")).toEqual({ apiKeyEnv: null });
  m.readWorkspaceSecret.mockRejectedValue(Error("synthetic-private"));
  await expect(resolveWorkspaceClaude("id")).rejects.toThrow("setup.storage");
});
it("writes only after checking workspace exists; disabled stores no key", async () => {
  await saveWorkspaceClaudeSetup("id", { source: "disabled" });
  expect(m.writeWorkspaceSecret).toHaveBeenCalledWith("id", { source: "disabled" });
  m.getWorkspace.mockResolvedValue(null);
  await expect(saveWorkspaceClaudeSetup("missing", { source: "key", apiKey: "synthetic-private" })).rejects.toThrow();
  expect(m.writeWorkspaceSecret).toHaveBeenCalledTimes(1);
});
it("tests only on explicit invocation with one fixed GET and sanitized status", async () => {
  m.fetch.mockResolvedValue(new Response("{}", { status: 200 }));
  expect(await testWorkspaceClaude("id", m.fetch)).toBe("verified");
  expect(m.fetch).toHaveBeenCalledTimes(1);
  const [url, init] = m.fetch.mock.calls[0];
  expect(url).toBe("https://api.anthropic.com/v1/models/claude-opus-5-5");
  expect(init).toMatchObject({ method: "GET", redirect: "error", cache: "no-store" });
  m.fetch.mockResolvedValue(new Response("synthetic-private", { status: 401 }));
  expect(await testWorkspaceClaude("id", m.fetch)).toBe("unauthorized");
  m.readWorkspaceSecret.mockResolvedValue({ source: "disabled" });
  expect(await testWorkspaceClaude("id", m.fetch)).toBe("disabled");
  expect(m.fetch).toHaveBeenCalledTimes(2);
});
