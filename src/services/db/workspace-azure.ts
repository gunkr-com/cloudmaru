import "server-only";
import type { PGlite } from "@electric-sql/pglite";
import type { WorkspaceAzureSettings } from "@/types/scan";
import { azureSettingsInputSchema, subscriptionIdsSchema } from "@/lib/scans/connection-schema";
import { getDb } from "./client";
import { logStoreError } from "./store-log";
import { WorkspaceStoreError } from "./workspaces";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function parseSettings(connection: unknown, subscriptionIds: unknown): WorkspaceAzureSettings {
  const parsed = azureSettingsInputSchema.safeParse({
    ...(typeof connection === "object" && connection !== null ? connection : {}), subscriptionIds,
  });
  if (parsed.success) return parsed.data;
  const subscriptions = subscriptionIdsSchema.safeParse(subscriptionIds);
  return { connection: null, subscriptionIds: subscriptions.success ? subscriptions.data : [] };
}

export function createWorkspaceAzureDb(deps: { db: () => Promise<PGlite> }) {
  async function run<T>(operation: (db: PGlite) => Promise<T>): Promise<T> {
    try { return await operation(await deps.db()); }
    catch (error) { logStoreError("workspace-azure", error); throw new WorkspaceStoreError(); }
  }
  return {
    async getWorkspaceAzureSettings(workspaceId: string): Promise<WorkspaceAzureSettings | null> {
      if (!uuidPattern.test(workspaceId)) return null;
      return run(async db => {
        const result = await db.query<{ azure_connection: unknown; subscription_ids: unknown }>("select azure_connection, subscription_ids from workspaces where id=$1", [workspaceId]);
        const row = result.rows[0];
        return row ? parseSettings(row.azure_connection, row.subscription_ids) : null;
      });
    },
    async saveWorkspaceAzureSettings(workspaceId: string, settings: WorkspaceAzureSettings): Promise<boolean> {
      if (!uuidPattern.test(workspaceId)) return false;
      return run(async db => {
        const validated = settings.connection === null
          ? { connection: null, subscriptionIds: subscriptionIdsSchema.parse(settings.subscriptionIds) }
          : azureSettingsInputSchema.parse({ ...settings.connection, subscriptionIds: settings.subscriptionIds });
        // 스키마가 허용한 경로와 환경 변수 이름만 저장하고 나머지 입력은 버린다.
        const result = await db.query("update workspaces set azure_connection=$2, subscription_ids=$3, updated_at=now() where id=$1 returning id", [workspaceId, validated.connection, validated.subscriptionIds]);
        return result.rows.length > 0;
      });
    },
  };
}
export const { getWorkspaceAzureSettings, saveWorkspaceAzureSettings } = createWorkspaceAzureDb({ db: getDb });
