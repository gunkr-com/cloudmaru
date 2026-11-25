// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDatabase, insertTestWorkspace } from "@/lib/db/test-db.test-data";
import { completeSnapshot, ids, resourceIds } from "@/lib/completion/fixtures.test-data";
import { diagnosePath } from "@/lib/network";
import { createScansDb } from "./scans";
import { createNetworkDiagnosticsDb } from "./network-diagnostics";
let db: PGlite;
let store: ReturnType<typeof createNetworkDiagnosticsDb>;
let input: { schemaVersion: 1; workspaceId: string; sourceScanId: string; query: { sourceScanId: string; sourceResourceId: string; destinationResourceId: string; protocol: "tcp"; sourcePort: null; destinationPort: number } };
beforeEach(async () => {
  db = await createTestDatabase();
  const workspaceId = await insertTestWorkspace(db);
  const sourceScanId = await createScansDb({ db: async () => db }).createImportScan({ workspaceId, subscriptionIds: completeSnapshot.record.subscriptionIds, inventory: completeSnapshot.inventory, summary: completeSnapshot.record.summary!, collectedAt: completeSnapshot.record.collectedAt! });
  input = { schemaVersion: 1, workspaceId, sourceScanId, query: { sourceScanId, sourceResourceId: resourceIds.vm, destinationResourceId: resourceIds.nic, protocol: "tcp", sourcePort: null, destinationPort: 443 } };
  store = createNetworkDiagnosticsDb({ db: async () => db });
});
afterEach(async () => { await db.close(); vi.restoreAllMocks(); });
it("reserves distinct requests, completes once and reopens against saved owner/scan", async () => {
  const a = await store.reserveNetworkDiagnostic(input);
  const b = await store.reserveNetworkDiagnostic(input);
  expect(a!.id).not.toBe(b!.id);
  const engine = diagnosePath(completeSnapshot.inventory.resources, input.query);
  expect(await store.completeNetworkDiagnostic(a!.id, engine)).toBe(true);
  const saved = await store.getNetworkDiagnostic(a!.id);
  expect(saved).toMatchObject({ status: "succeeded", workspaceId: input.workspaceId, sourceScanId: input.sourceScanId, result: { query: input.query, engine } });
  expect(await store.failNetworkDiagnostic(a!.id, "internal")).toBe(false);
  expect(await store.completeNetworkDiagnostic(a!.id, engine)).toBe(false);
  expect(await store.getNetworkDiagnostic(a!.id)).toEqual(saved);
  expect(await store.listNetworkDiagnostics(input.workspaceId, { sourceScanId: input.sourceScanId })).toHaveLength(2);
  expect(await store.listNetworkDiagnostics(await insertTestWorkspace(db))).toEqual([]);
  expect(await store.listNetworkDiagnostics(input.workspaceId, { sourceScanId: ids.oldScan })).toEqual([]);
});
it("rejects missing, failed and cross-company scans and invalid endpoints before reservation", async () => {
  expect(await store.reserveNetworkDiagnostic({ ...input, workspaceId: await insertTestWorkspace(db) })).toBeNull();
  expect(await store.reserveNetworkDiagnostic({ ...input, sourceScanId: ids.oldScan, query: { ...input.query, sourceScanId: ids.oldScan } })).toBeNull();
  await expect(store.reserveNetworkDiagnostic({ ...input, query: { ...input.query, sourceResourceId: `${resourceIds.vm}-missing` } })).rejects.toThrow();
  expect((await db.query("select id from network_diagnostics")).rows).toEqual([]);
  await db.query("update scans set status='failed', error_code='internal' where id=$1", [input.sourceScanId]);
  expect(await store.reserveNetworkDiagnostic(input)).toBeNull();
});
it("rejects invalid results and corrupted saved results on read", async () => {
  const reserved = await store.reserveNetworkDiagnostic(input);
  const engine = diagnosePath(completeSnapshot.inventory.resources, input.query);
  await expect(store.completeNetworkDiagnostic(reserved!.id, { ...engine, sourceResourceId: resourceIds.storage })).rejects.toThrow();
  expect((await store.getNetworkDiagnostic(reserved!.id))?.status).toBe("pending");
  await store.completeNetworkDiagnostic(reserved!.id, engine);
  await db.query("update network_diagnostics set result=jsonb_set(result, '{engine,sourceResourceId}', to_jsonb($2::text)) where id=$1", [reserved!.id, resourceIds.storage]);
  await expect(store.getNetworkDiagnostic(reserved!.id)).rejects.toThrow();
});
it("stores coded failure once and resolves abandoned pending rows", async () => {
  const first = (await store.reserveNetworkDiagnostic(input))!;
  expect(await store.failNetworkDiagnostic(first.id, "internal")).toBe(true);
  expect(await store.failNetworkDiagnostic(first.id, "timeout")).toBe(false);
  expect(await store.getNetworkDiagnostic(first.id)).toMatchObject({ status: "failed", error: { schemaVersion: 1, code: "internal" }, result: null });
  const stale = (await store.reserveNetworkDiagnostic(input))!;
  await db.query("update network_diagnostics set created_at=now()-interval '20 minutes' where id=$1", [stale.id]);
  expect(await store.getNetworkDiagnostic(stale.id)).toMatchObject({ status: "failed", error: { schemaVersion: 1, code: "interrupted" } });
});
it("skips malformed IDs and sanitizes storage failures", async () => {
  const dependency = vi.fn();
  const empty = createNetworkDiagnosticsDb({ db: dependency });
  expect(await empty.getNetworkDiagnostic("bad")).toBeNull();
  expect(dependency).not.toHaveBeenCalled();
  dependency.mockRejectedValue(Error("private database path"));
  await expect(empty.getNetworkDiagnostic(ids.network)).rejects.toThrow("저장소 요청에 실패했습니다.");
});
it("peeks history read-only, leaving stale pending rows byte-identical, while the existing list still expires them", async () => {
  const stale = (await store.reserveNetworkDiagnostic(input))!;
  await db.query("update network_diagnostics set created_at=now()-interval '20 minutes' where id=$1", [stale.id]);
  const snapshot = async () => (await db.query<{ row: string }>("select row_to_json(n)::text as row from network_diagnostics n where id=$1", [stale.id])).rows[0].row;
  const before = await snapshot();
  const peeked = await store.peekNetworkDiagnostics(input.workspaceId, { limit: 1 });
  expect(peeked).toHaveLength(1);
  expect(peeked[0]).toMatchObject({ id: stale.id, status: "pending", error: null, completedAt: null, result: null });
  expect(await snapshot()).toBe(before);
  expect(await store.peekNetworkDiagnostics(await insertTestWorkspace(db))).toEqual([]);
  expect(await store.peekNetworkDiagnostics("not-a-uuid")).toEqual([]);
  expect(await store.listNetworkDiagnostics(input.workspaceId)).toMatchObject([{ id: stale.id, status: "failed", error: { schemaVersion: 1, code: "interrupted" } }]);
  expect(await snapshot()).not.toBe(before);
});
