"use server";

import { revalidatePath } from "next/cache";
import { claudeApiKeyEnvSchema } from "@/lib/workspace/claude-settings";
import { saveWorkspaceClaudeSettings } from "@/services/db/workspace-claude";
import type { ClaudeKeyFormState } from "@/types/workspace-claude";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function saveClaudeKeyAction(_prev: ClaudeKeyFormState, data: FormData): Promise<ClaudeKeyFormState> {
  const id = data.get("workspaceId");
  if (typeof id !== "string" || !uuidPattern.test(id)) return { error: "workspace.claude.saveFailed" };
  const value = data.get("apiKeyEnv");
  if (typeof value !== "string") return { error: "workspace.claude.invalidReference" };
  const parsed = claudeApiKeyEnvSchema.safeParse(value.trim() === "" ? null : value);
  if (!parsed.success) return { error: "workspace.claude.invalidReference" };
  try {
    if (!await saveWorkspaceClaudeSettings(id, { apiKeyEnv: parsed.data })) return { error: "workspace.claude.saveFailed" };
  } catch {
    return { error: "workspace.claude.saveFailed" };
  }
  revalidatePath("/", "layout");
  return { saved: true };
}
