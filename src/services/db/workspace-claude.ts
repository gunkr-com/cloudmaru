import "server-only";
import type { PGlite } from "@electric-sql/pglite";
import { claudeApiKeyEnvSchema } from "@/lib/workspace/claude-settings";
import type { WorkspaceClaudeSettings } from "@/types/workspace-claude";
import { getDb } from "./client";
import { logStoreError } from "./store-log";
import { WorkspaceStoreError } from "./workspaces";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function createWorkspaceClaudeDb(deps: { db: () => Promise<PGlite> }) {
  async function run<T>(operation: (db: PGlite) => Promise<T>): Promise<T> {
    try { return await operation(await deps.db()); }
    catch {
      // 키 설정 경로의 원본 오류는 입력값을 포함할 수 있어 로그에도 남기지 않는다.
      logStoreError("workspace-claude", new Error("operation failed"));
      throw new WorkspaceStoreError();
    }
  }
  return {
    async getWorkspaceClaudeSettings(id: string): Promise<WorkspaceClaudeSettings | null> {
      if (!uuidPattern.test(id)) return null;
      return run(async db => {
        const { rows } = await db.query<{ claude_api_key_env: unknown }>("select claude_api_key_env from workspaces where id=$1", [id]);
        return rows[0] ? { apiKeyEnv: claudeApiKeyEnvSchema.parse(rows[0].claude_api_key_env) } : null;
      });
    },
    async saveWorkspaceClaudeSettings(id: string, settings: WorkspaceClaudeSettings): Promise<boolean> {
      if (!uuidPattern.test(id)) return false;
      return run(async db => {
        const reference = claudeApiKeyEnvSchema.parse(settings.apiKeyEnv);
        const { rows } = await db.query("update workspaces set claude_api_key_env=$2, updated_at=now() where id=$1 returning id", [id, reference]);
        return rows.length > 0;
      });
    },
  };
}
export const { getWorkspaceClaudeSettings, saveWorkspaceClaudeSettings } = createWorkspaceClaudeDb({ db: getDb });
