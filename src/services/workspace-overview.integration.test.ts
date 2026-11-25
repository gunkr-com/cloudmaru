// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDatabase, insertTestWorkspace } from "@/lib/db/test-db.test-data";
import { completeSnapshot, resourceIds } from "@/lib/completion/fixtures.test-data";
import { createScansDb } from "@/services/db/scans";
import { createNetworkDiagnosticsDb } from "@/services/db/network-diagnostics";

// 실제 PGlite(메모리)와 고정 합성 자료만 쓴다. Claude 설정 읽기는 파일 비밀 저장소를 피하려고 목으로 둔다.
const dependencies = vi.hoisted(() => ({ db: vi.fn(), claude: vi.fn() }));
vi.mock("@/services/db/client", () => ({ getDb: dependencies.db }));
vi.mock("@/services/workspace-setup", () => ({ getWorkspaceClaudeOverview: dependencies.claude }));
import { loadWorkspaceOverview } from "./workspace-overview";

const TABLES = ["workspaces", "scans", "assessments", "analyses", "extensions", "network_diagnostics"] as const;
let db: PGlite;
beforeEach(async () => {
  db = await createTestDatabase();
  dependencies.db.mockResolvedValue(db);
  dependencies.claude.mockResolvedValue({ source: "env", apiKeyEnv: null, model: "", available: false, needsSetup: false });
});
afterEach(async () => { await db.close(); vi.clearAllMocks(); });

async function snapshot(): Promise<string[]> {
  const rows: string[] = [];
  for (const table of TABLES) {
    const { rows: [row] } = await db.query<{ rows: string | null }>(`select json_agg(t order by t.id)::text as rows from ${table} t`);
    rows.push(`${table}:${row.rows ?? "[]"}`);
  }
  return rows;
}

it("reads a stale pending network diagnostic without changing any stored row, projecting it as failed", async () => {
  const workspaceId = await insertTestWorkspace(db);
  const sourceScanId = await createScansDb({ db: async () => db }).createImportScan({ workspaceId, subscriptionIds: completeSnapshot.record.subscriptionIds,
    inventory: completeSnapshot.inventory, summary: completeSnapshot.record.summary!, collectedAt: completeSnapshot.record.collectedAt! });
  const reserved = (await createNetworkDiagnosticsDb({ db: async () => db }).reserveNetworkDiagnostic({ schemaVersion: 1, workspaceId, sourceScanId,
    query: { sourceScanId, sourceResourceId: resourceIds.vm, destinationResourceId: resourceIds.nic, protocol: "tcp", sourcePort: null, destinationPort: 443 } }))!;
  await db.query("update network_diagnostics set created_at=now()-interval '20 minutes' where id=$1", [reserved.id]);
  const before = await snapshot();

  const view = await loadWorkspaceOverview(workspaceId);

  expect(await snapshot()).toEqual(before);
  const { rows: [row] } = await db.query<{ status: string; error: unknown; completed_at: unknown }>("select status, error, completed_at from network_diagnostics where id=$1", [reserved.id]);
  expect(row).toEqual({ status: "pending", error: null, completed_at: null });
  expect(view.network).toMatchObject({ id: reserved.id, status: "failed", verdict: null });
  expect(view.inventory.latest).toMatchObject({ id: sourceScanId, source: "import" });
});
