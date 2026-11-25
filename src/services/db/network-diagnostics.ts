import "server-only";
import { z } from "zod";
import type { PGlite } from "@electric-sql/pglite";
import { networkDiagnosticSchema, reasonCodeSchema } from "@/lib/completion/schema";
import { toCompletionSourceScan } from "@/lib/completion/source-scan";
import { networkInputSchema, validateNetworkMembers, validateNetworkEngine, NETWORK_STALE_MS, NetworkInputError } from "@/lib/network-diagnostics/validation";
import type { NetworkInput } from "@/lib/network-diagnostics/validation";
import { getDb } from "./client";
import { createScansDb } from "./scans";
import { WorkspaceStoreError } from "./workspaces";
import { logStoreError } from "./store-log";

const uuid = z.uuid();
const timestamp = z.union([z.string(), z.date()]).transform(value => new Date(value).toISOString());
const rowSchema = z.object({
  id: uuid, workspace_id: uuid, source_scan_id: uuid,
  status: z.enum(["pending", "succeeded", "failed"]), input: networkInputSchema,
  result: z.unknown(), error: z.strictObject({ schemaVersion: z.literal(1), code: reasonCodeSchema }).nullable(),
  created_at: timestamp, completed_at: timestamp.nullable(),
});

type ListOptions = { sourceScanId?: string; limit?: number };

export function createNetworkDiagnosticsDb(deps: { db: () => Promise<PGlite> }) {
  async function run<T>(operation: (db: PGlite) => Promise<T>): Promise<T> {
    try { return await operation(await deps.db()); }
    catch (error) {
      if (error instanceof NetworkInputError) throw error;
      logStoreError("network-diagnostics", new Error("operation failed"));
      throw new WorkspaceStoreError();
    }
  }
  async function source(db: PGlite, id: string) {
    const scans = createScansDb({ db: async () => db });
    const scan = await scans.getScan(id);
    if (!scan) return null;
    return { scan, inventory: scan.status === "succeeded" ? await scans.getScanInventory(id) : null };
  }
  async function parse(db: PGlite, raw: unknown) {
    const row = rowSchema.parse(raw);
    const saved = await source(db, row.source_scan_id);
    if (!saved?.inventory || saved.scan.status !== "succeeded" || saved.scan.workspaceId !== row.workspace_id
      || row.input.workspaceId !== row.workspace_id || row.input.sourceScanId !== row.source_scan_id) throw new WorkspaceStoreError();
    validateNetworkMembers(saved.inventory.resources, row.input.query);
    const sourceScan = toCompletionSourceScan(saved.scan, saved.inventory);
    const result = row.status === "succeeded" ? networkDiagnosticSchema.parse(row.result) : null;
    if (result) {
      if (result.createdAt !== row.created_at || result.id !== row.id || result.workspaceId !== row.workspace_id || result.sourceScanId !== row.source_scan_id
        || JSON.stringify(result.query) !== JSON.stringify(row.input.query)
        || JSON.stringify(result.sourceScan) !== JSON.stringify(sourceScan)) throw new WorkspaceStoreError();
      validateNetworkEngine(saved.inventory.resources, result.query, result.engine);
    }
    if (row.completed_at !== null && Date.parse(row.completed_at) < Date.parse(row.created_at)) throw new WorkspaceStoreError();
    if (row.status === "pending" ? row.result !== null || row.error !== null || row.completed_at !== null
      : row.completed_at === null || (row.status === "succeeded" ? row.error !== null : row.result !== null || row.error === null)) throw new WorkspaceStoreError();
    return {
      id: row.id, workspaceId: row.workspace_id, sourceScanId: row.source_scan_id, status: row.status,
      input: row.input, result, error: row.error, createdAt: row.created_at, completedAt: row.completed_at,
    };
  }
  async function expire(db: PGlite, filter: string, values: unknown[]) {
    await db.query(`update network_diagnostics set status='failed', error='{"schemaVersion":1,"code":"interrupted"}'::jsonb,
      completed_at=now() where ${filter} and status='pending' and created_at < $${values.length + 1}`,
    [...values, new Date(Date.now() - NETWORK_STALE_MS)]);
  }
  async function list(workspaceId: string, options: ListOptions, expireStale: boolean) {
    if (!uuid.safeParse(workspaceId).success || options.sourceScanId !== undefined && !uuid.safeParse(options.sourceScanId).success) return [];
    const limit = z.number().int().min(0).max(100).parse(options.limit ?? 20);
    return run(async db => {
      if (expireStale) await expire(db, "workspace_id=$1", [workspaceId]);
      const { rows } = await db.query(`select * from network_diagnostics where workspace_id=$1
        and ($2::uuid is null or source_scan_id=$2) order by created_at desc, id desc limit $3`, [workspaceId, options.sourceScanId ?? null, limit]);
      return Promise.all(rows.map(row => parse(db, row)));
    });
  }
  return {
    async getNetworkSourceScan(id: string) {
      if (!uuid.safeParse(id).success) return null;
      return run(db => source(db, id));
    },
    async reserveNetworkDiagnostic(raw: NetworkInput) {
      const input = networkInputSchema.parse(raw);
      return run(async db => {
        const saved = await source(db, input.sourceScanId);
        if (!saved?.inventory || saved.scan.status !== "succeeded" || saved.scan.workspaceId !== input.workspaceId) return null;
        toCompletionSourceScan(saved.scan, saved.inventory);
        validateNetworkMembers(saved.inventory.resources, input.query);
        const { rows } = await db.query<{ id: string; status: "pending"; created: boolean }>(
          "select * from reserve_network_diagnostic($1,$2,$3)", [input.workspaceId, input.sourceScanId, input]);
        return rows[0] ?? null;
      });
    },
    async completeNetworkDiagnostic(id: string, engine: unknown): Promise<boolean> {
      if (!uuid.safeParse(id).success) return false;
      return run(async db => {
        const { rows } = await db.query("select * from network_diagnostics where id=$1", [id]);
        if (!rows.length) return false;
        const row = await parse(db, rows[0]);
        if (row.status !== "pending") return false;
        const saved = await source(db, row.sourceScanId);
        if (!saved?.inventory) throw new WorkspaceStoreError();
        const result = networkDiagnosticSchema.parse({
          schemaVersion: 1, id: row.id, workspaceId: row.workspaceId, sourceScanId: row.sourceScanId,
          sourceScan: toCompletionSourceScan(saved.scan, saved.inventory), createdAt: row.createdAt,
          query: row.input.query, engine: validateNetworkEngine(saved.inventory.resources, row.input.query, engine),
        });
        const updated = await db.query("update network_diagnostics set status='succeeded', result=$2, completed_at=now() where id=$1 and status='pending' returning id", [id, result]);
        return updated.rows.length === 1;
      });
    },
    async failNetworkDiagnostic(id: string, code: z.infer<typeof reasonCodeSchema>): Promise<boolean> {
      if (!uuid.safeParse(id).success) return false;
      const error = { schemaVersion: 1, code: reasonCodeSchema.parse(code) };
      return run(async db => {
        const updated = await db.query("update network_diagnostics set status='failed', error=$2, completed_at=now() where id=$1 and status='pending' returning id", [id, error]);
        return updated.rows.length === 1;
      });
    },
    async getNetworkDiagnostic(id: string) {
      if (!uuid.safeParse(id).success) return null;
      return run(async db => {
        await expire(db, "id=$1", [id]);
        const { rows } = await db.query("select * from network_diagnostics where id=$1", [id]);
        return rows.length ? parse(db, rows[0]) : null;
      });
    },
    async listNetworkDiagnostics(workspaceId: string, options: ListOptions = {}) {
      return list(workspaceId, options, true);
    },
    // Read-only history: leaves stale pending rows untouched so summary pages never write on read.
    async peekNetworkDiagnostics(workspaceId: string, options: ListOptions = {}) {
      return list(workspaceId, options, false);
    },
  };
}
export const { getNetworkSourceScan, reserveNetworkDiagnostic, completeNetworkDiagnostic, failNetworkDiagnostic, getNetworkDiagnostic, listNetworkDiagnostics, peekNetworkDiagnostics } = createNetworkDiagnosticsDb({ db: getDb });
