import "server-only";
import type { PGlite } from "@electric-sql/pglite";
import type { ScanData, ScanErrorCode, ScanInventory, ScanRecord } from "@/types/scan";
import { parseScanInventory, parseScanRow } from "@/lib/scans/rows";
import { getDb } from "./client";
import { logStoreError } from "./store-log";
import { WorkspaceStoreError } from "./workspaces";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const columns = "id, workspace_id, source, status, subscription_ids, summary, collected_at, error_code, created_at, completed_at";

export function createScansDb(deps: { db: () => Promise<PGlite> }) {
  async function run<T>(operation: (db: PGlite) => Promise<T>): Promise<T> {
    try { return await operation(await deps.db()); }
    catch (error) { logStoreError("scans", error); throw new WorkspaceStoreError(); }
  }
  return {
    async listLatestScanTimes(): Promise<Record<string, string>> {
      return run(async db => {
        const result = await db.query<{ workspace_id: string; collected_at: Date | string }>(
          "select workspace_id, max(collected_at) as collected_at from scans where status='succeeded' group by workspace_id",
        );
        return Object.fromEntries(result.rows.map(row => [row.workspace_id, new Date(row.collected_at).toISOString()]));
      });
    },
    async reserveLiveScan(args: { workspaceId: string; subscriptionIds: string[]; staleBefore: Date }): Promise<{ id: string; created: boolean }> {
      return run(async db => {
        // PGlite의 한 연결에서 검사와 삽입을 한 문장으로 직렬 실행한다.
        const result = await db.query<{ id: string; created: boolean }>(
          `with existing as (
             select id from scans where workspace_id=$1 and source='live' and status='pending' and created_at >= $3
             order by created_at desc, id desc limit 1
           ), inserted as (
             insert into scans(workspace_id, source, subscription_ids)
             select $1, 'live', $2 where not exists (select 1 from existing) returning id
           ) select id, false as created from existing union all select id, true as created from inserted`,
          [args.workspaceId, args.subscriptionIds, args.staleBefore],
        );
        if (!result.rows[0]) throw new WorkspaceStoreError();
        return result.rows[0];
      });
    },
    async createImportScan(args: ScanData & { workspaceId: string }): Promise<string> {
      return run(async db => {
        const result = await db.query<{ id: string }>(
          `insert into scans(workspace_id, source, status, subscription_ids, inventory, summary, collected_at, completed_at)
           values ($1, 'import', 'succeeded', $2, $3, $4, $5, now()) returning id`,
          [args.workspaceId, args.subscriptionIds, args.inventory, args.summary, args.collectedAt],
        );
        if (!result.rows[0]) throw new WorkspaceStoreError();
        return result.rows[0].id;
      });
    },
    async completeScan(id: string, data: ScanData): Promise<void> {
      await run(async db => {
        await db.query("update scans set status='succeeded', inventory=$2, summary=$3, collected_at=$4, subscription_ids=$5, completed_at=now() where id=$1 and status='pending'", [id, data.inventory, data.summary, data.collectedAt, data.subscriptionIds]);
      });
    },
    async failScan(id: string, code: ScanErrorCode): Promise<void> {
      await run(async db => {
        await db.query("update scans set status='failed', error_code=$2, completed_at=now() where id=$1 and status='pending'", [id, code]);
      });
    },
    async getScan(id: string): Promise<ScanRecord | null> {
      if (!uuidPattern.test(id)) return null;
      return run(async db => {
        const result = await db.query(`select ${columns} from scans where id=$1`, [id]);
        return result.rows.length ? parseScanRow(result.rows[0]) : null;
      });
    },
    async getScanInventory(id: string): Promise<ScanInventory | null> {
      if (!uuidPattern.test(id)) return null;
      return run(async db => {
        const result = await db.query<{ inventory: unknown }>("select inventory from scans where id=$1", [id]);
        const value = result.rows[0]?.inventory;
        return value == null ? null : parseScanInventory(value);
      });
    },
    async getLatestSucceededScan(workspaceId: string): Promise<ScanRecord | null> {
      return run(async db => {
        const result = await db.query(
          `select ${columns} from scans where workspace_id=$1 and status='succeeded' order by collected_at desc, id desc limit 1`,
          [workspaceId],
        );
        return result.rows.length ? parseScanRow(result.rows[0]) : null;
      });
    },
    async listScans(workspaceId: string, options?: { limit?: number }): Promise<ScanRecord[]> {
      return run(async db => {
        const result = await db.query(`select ${columns} from scans where workspace_id=$1 order by created_at desc, id desc limit $2`, [workspaceId, options?.limit ?? 20]);
        return result.rows.map(parseScanRow);
      });
    },
  };
}
export const { reserveLiveScan, createImportScan, completeScan, failScan, getScan, getScanInventory, listScans, listLatestScanTimes, getLatestSucceededScan } = createScansDb({ db: getDb });
