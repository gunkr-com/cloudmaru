import "server-only";
import { getWorkspace } from "./db/workspaces";
import { getWorkspaceClaudeSettings } from "./db/workspace-claude";
import { readWorkspaceSecret, writeWorkspaceSecret, SecretStorageError } from "./workspace-secrets";
import { claudeApiKeyEnvSchema } from "@/lib/workspace/claude-settings";
import { workspaceSecretSchema, type WorkspaceSecret } from "@/lib/workspace/setup-schema";
import type { ClaudeOverview, ClaudeTestStatus } from "@/types/setup";

export class WorkspaceSettingsMissingError extends Error {}
async function configuration(id: string) {
  try {
    const legacy = await getWorkspaceClaudeSettings(id);
    if (!legacy) throw new WorkspaceSettingsMissingError();
    const saved = await readWorkspaceSecret(id);
    return { legacy, saved };
  } catch (error) { if (error instanceof WorkspaceSettingsMissingError) throw error; throw new SecretStorageError(); }
}
export async function resolveWorkspaceClaude(id: string): Promise<{ apiKeyEnv: string | null; apiKey?: string; model?: string }> {
  const { legacy, saved } = await configuration(id);
  if (saved?.source === "disabled") return { apiKeyEnv: null };
  if (saved?.source === "key") return { apiKeyEnv: null, apiKey: saved.apiKey, ...(saved.model ? { model: saved.model } : {}) };
  const reference = claudeApiKeyEnvSchema.safeParse(saved?.source === "env" ? saved.apiKeyEnv : legacy.apiKeyEnv);
  return { apiKeyEnv: reference.success ? reference.data : null, ...(saved?.model ? { model: saved.model } : {}) };
}
export async function getWorkspaceClaudeOverview(id: string): Promise<ClaudeOverview> {
  const { legacy, saved } = await configuration(id);
  const source = saved?.source ?? (legacy.apiKeyEnv ? "env" : "disabled");
  const apiKeyEnv = saved?.source === "env" ? saved.apiKeyEnv : saved ? null : legacy.apiKeyEnv;
  const model = saved && "model" in saved && saved.model ? saved.model : process.env.CLAUDE_MODEL?.trim() || "";
  return { source, apiKeyEnv, model, available: source === "key" || (source === "env" && Boolean(apiKeyEnv && process.env[apiKeyEnv]?.trim())), needsSetup: !saved && !legacy.apiKeyEnv };
}
export async function saveWorkspaceClaudeSetup(id: string, input: WorkspaceSecret): Promise<void> {
  const value = workspaceSecretSchema.parse(input);
  if (!await getWorkspace(id)) throw new SecretStorageError();
  await writeWorkspaceSecret(id, value);
}
export async function testWorkspaceClaude(id: string, transport: typeof fetch = fetch): Promise<ClaudeTestStatus> {
  try {
    const config = await resolveWorkspaceClaude(id);
    const key = config.apiKey ?? (config.apiKeyEnv ? process.env[config.apiKeyEnv]?.trim() : undefined);
    if (!key) return "disabled";
    const model = config.model ?? process.env.CLAUDE_MODEL?.trim();
    if (!model) return "modelMissing";
    const response = await transport(`https://api.anthropic.com/v1/models/${encodeURIComponent(model)}`, {
      method: "GET", headers: { "x-api-key": key, "anthropic-version": "2023-06-01" },
      signal: AbortSignal.timeout(10_000), redirect: "error", cache: "no-store",
    });
    // No body is returned, logged, or persisted. This verifies metadata access, not generation.
    await response.body?.cancel();
    if (response.ok) return "verified";
    if (response.status === 401 || response.status === 403) return "unauthorized";
    if (response.status === 404) return "modelUnavailable";
    if (response.status === 429) return "rateLimited";
    return "unreachable";
  } catch { return "unreachable"; }
}
