import "server-only";
import { ClaudeError, requestStructuredOutput } from "./claude";
import { getAnalysis } from "./db/analyses";
import { getCompletionOwner } from "./db/completion-ownership";
import { resolveWorkspaceClaude, WorkspaceSettingsMissingError } from "./workspace-setup";
import { SecretStorageError } from "./workspace-secrets";
import type { LlmCallSource } from "@/types/llm";

export type CompletionClaudeSource = {
  source: Exclude<LlmCallSource, "analysis" | "artifact">;
  sourceId: string;
};

type Config = Awaited<ReturnType<typeof resolveWorkspaceClaude>>;
// The workspace's saved configuration (or CLAUDE_MODEL) owns key and model selection; callers cannot pass them.
type ScopedRequest = Omit<Parameters<typeof requestStructuredOutput>[0], "apiKeyEnv" | "apiKey" | "model">;
function available(config: Config) {
  return Boolean(config.apiKey?.trim() || (config.apiKeyEnv && process.env[config.apiKeyEnv]?.trim()));
}
function scopedRequest(request: ScopedRequest, config: Config) {
  const safe: Parameters<typeof requestStructuredOutput>[0] = { ...request };
  delete safe.apiKey; delete safe.apiKeyEnv; delete safe.model;
  return { ...safe, ...config };
}
// Ownership and secret values are reloaded for every attempt, including validation retries.
async function completionKeyReference({ source, sourceId }: CompletionClaudeSource): Promise<Config | null> {
  try {
    const workspaceId = await getCompletionOwner(source, sourceId);
    if (!workspaceId) return null;
    const config = await resolveWorkspaceClaude(workspaceId);
    return available(config) ? config : null;
  } catch (error) {
    if (error instanceof WorkspaceSettingsMissingError) return null;
    throw new ClaudeError("config", "workspace.claude.unavailable");
  }
}

export async function hasCompletionClaudeKey(source: CompletionClaudeSource): Promise<boolean> {
  return (await completionKeyReference(source)) !== null;
}

export async function requestCompletionStructuredOutput(
  source: CompletionClaudeSource,
  request: ScopedRequest,
): ReturnType<typeof requestStructuredOutput> {
  const apiKeyEnv = await completionKeyReference(source);
  if (apiKeyEnv === null) throw new ClaudeError("config", "workspace.claude.unavailable");
  // spread 뒤에 서버가 고른 참조를 둬서 런타임에 주입한 apiKeyEnv도 덮어쓴다.
  return requestStructuredOutput(scopedRequest(request, apiKeyEnv));
}

// 예약 전에 설정만 확인한다. 실제 호출은 재시도마다 다시 키를 읽는다.
// 설정이 없거나 비공개 저장소를 읽지 못하면 키가 없는 것으로 막아 409(workspace.claude.unavailable)로 안내한다.
export async function hasWorkspaceClaudeKey(workspaceId: string): Promise<boolean> {
  try {
    return available(await resolveWorkspaceClaude(workspaceId));
  } catch (error) {
    if (error instanceof WorkspaceSettingsMissingError || error instanceof SecretStorageError) return false;
    throw error;
  }
}

// 저장된 분석의 소속을 따른다. 현재 쿠키나 클라이언트의 workspaceId로 고르지 않는다.
export async function requestAnalysisStructuredOutput(
  analysisId: string,
  request: ScopedRequest,
): ReturnType<typeof requestStructuredOutput> {
  let config: Config;
  try {
    const analysis = await getAnalysis(analysisId);
    if (!analysis) throw new Error();
    config = await resolveWorkspaceClaude(analysis.workspaceId);
  } catch {
    throw new ClaudeError("config", "workspace.claude.unavailable");
  }
  return requestStructuredOutput(scopedRequest(request, config));
}
