"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { workspaceIdSchema, workspaceSecretSchema } from "@/lib/workspace/setup-schema";
import { saveWorkspaceClaudeSetup, testWorkspaceClaude } from "@/services/workspace-setup";
import { testAzureWorkspace } from "@/services/workspace-azure-diagnostics";
import { getWorkspace } from "@/services/db/workspaces";
import type { SetupFormState, AzureTestFormState } from "@/types/setup";

export async function saveSetupAction(_previous: SetupFormState, data: FormData): Promise<SetupFormState> {
  const id = workspaceIdSchema.safeParse(data.get("workspaceId"));
  const source = data.get("intent") === "disable" ? "disabled" : data.get("source");
  const model = data.get("model");
  const optionalModel = typeof model === "string" && model.trim() ? { model: model.trim() } : {};
  const parsed = workspaceSecretSchema.safeParse(source === "disabled" ? { source } : source === "key"
    ? { source, apiKey: data.get("apiKey"), ...optionalModel }
    : { source, apiKeyEnv: data.get("apiKeyEnv"), ...optionalModel });
  if (!id.success || !parsed.success) return { error: "setup.invalid" };
  try { await saveWorkspaceClaudeSetup(id.data, parsed.data); }
  catch { return { error: "setup.storage" }; }
  revalidatePath("/", "layout");
  return { saved: true };
}
export async function testClaudeAction(_previous: SetupFormState, data: FormData): Promise<SetupFormState> {
  const id = workspaceIdSchema.safeParse(data.get("workspaceId"));
  try {
    if (!id.success || !await getWorkspace(id.data)) return { error: "setup.invalid" };
    return { test: await testWorkspaceClaude(id.data), checkedAt: new Date().toISOString() };
  } catch { return { error: "setup.storage" }; }
}
export async function testAzureAction(_previous: AzureTestFormState, data: FormData): Promise<AzureTestFormState> {
  const id = workspaceIdSchema.safeParse(data.get("workspaceId"));
  try {
    if (!id.success || !await getWorkspace(id.data)) return { result: { status: "missing", subscriptionCount: 0 } };
    return { result: await testAzureWorkspace(id.data), checkedAt: new Date().toISOString() };
  } catch { return { result: { status: "unreachable", subscriptionCount: 0 } }; }
}
export async function continueLocalAction(data: FormData): Promise<void> {
  data.set("intent", "disable");
  const state = await saveSetupAction({}, data);
  if (state.error) redirect("/setup?error=storage");
  redirect("/inventory");
}
