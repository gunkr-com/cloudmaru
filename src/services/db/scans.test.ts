// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDatabase, insertTestWorkspace } from "@/lib/db/test-db.test-data";
import { buildInventory } from "@/lib/inventory/build-inventory";
import { applyMigrations } from "./migrate";
import { WorkspaceStoreError } from "./workspaces";
import { createScansDb } from "./scans";

const missing = "00000000-0000-0000-0000-000000000001";
const subscriptionIds = [missing];
const built = buildInventory({ source: "import", collectedAt: new Date("2026-01-01Z"), resourceRows: [], containerRows: [] });
const payload = { inventory: { resources: built.resources, containers: built.containers, relations: built.relations, skippedRows: built.skippedRows }, summary: built.summary, collectedAt: built.collectedAt, subscriptionIds };
let db: PGlite;
let workspaceId: string;
let store: ReturnType<typeof createScansDb>;
beforeEach(async () => { db = await createTestDatabase(); workspaceId = await insertTestWorkspace(db); store = createScansDb({ db: async () => db }); });
afterEach(async () => { await db.close(); vi.restoreAllMocks(); });
const reserve = () => store.reserveLiveScan({ workspaceId, subscriptionIds, staleBefore: new Date("2026-01-01Z") });
it("reads latest succeeded collection times per workspace in a single query", async () => {
  expect(await store.listLatestScanTimes()).toEqual({});
  const other = await insertTestWorkspace(db);
  await insertTestWorkspace(db);
  await store.createImportScan({ workspaceId, ...payload, collectedAt: "2026-01-03T00:00:00.000Z" });
  await store.createImportScan({ workspaceId, ...payload, collectedAt: "2026-01-01T00:00:00.000Z" });
  await store.createImportScan({ workspaceId: other, ...payload, collectedAt: "2026-01-02T00:00:00.000Z" });
  const failed = (await reserve()).id;
  await store.failScan(failed, "timeout");
  const pending = (await reserve()).id;
  await db.query("update scans set collected_at=$2 where id in ($1, $3)", [failed, "2026-02-01Z", pending]);
  const spy = vi.spyOn(db, "query");
  expect(await store.listLatestScanTimes()).toEqual({ [workspaceId]: "2026-01-03T00:00:00.000Z", [other]: "2026-01-02T00:00:00.000Z" });
  expect(spy).toHaveBeenCalledTimes(1);
});
it("applies migration 0002 idempotently and enforces terminal constraints", async () => {
  expect((await db.query("select version from schema_migrations where version='0002_scans.sql'")).rows).toHaveLength(1);
  expect(await applyMigrations(db)).toEqual([]);
  for (const status of ["succeeded", "failed", "other"]) await expect(db.query("insert into scans(workspace_id,source,status) values ($1,'live',$2)", [workspaceId, status])).rejects.toThrow();
  await expect(db.query("insert into scans(workspace_id,source) values ($1,'other')", [workspaceId])).rejects.toThrow();
});
it("reuses only fresh live pending scans in the same workspace in one statement", async () => {
  await store.createImportScan({ workspaceId, ...payload });
  const spy = vi.spyOn(db, "query");
  const first = await reserve();
  expect(spy).toHaveBeenCalledTimes(1);
  expect(first.created).toBe(true);
  const concurrent = await Promise.all([reserve(), reserve()]);
  expect(concurrent).toEqual([{ id: first.id, created: false }, { id: first.id, created: false }]);
  const other = await store.reserveLiveScan({ workspaceId: await insertTestWorkspace(db), subscriptionIds, staleBefore: new Date("2026-01-01Z") });
  expect(other.id).not.toBe(first.id);
  await db.query("update scans set created_at=$2 where id=$1", [first.id, "2025-01-01Z"]);
  const next = await reserve();
  expect(next).toMatchObject({ created: true });
  expect(next.id).not.toBe(first.id);
  expect((await store.getScan(first.id))?.status).toBe("pending");
});
it("stores imports and completes/fails pending rows once", async () => {
  const imported = await store.createImportScan({ workspaceId, ...payload });
  expect(await store.getScan(imported)).toMatchObject({ source: "import", status: "succeeded", summary: payload.summary, collectedAt: payload.collectedAt, completedAt: expect.any(String) });
  expect(await store.getScanInventory(imported)).toEqual(payload.inventory);
  const { id } = await reserve();
  expect(await store.getScanInventory(id)).toBeNull();
  await store.completeScan(id, payload);
  const complete = await store.getScan(id);
  await store.failScan(id, "timeout");
  await store.completeScan(id, { ...payload, subscriptionIds: [] });
  expect(await store.getScan(id)).toEqual(complete);
  const failed = (await reserve()).id;
  await store.failScan(failed, "forbidden");
  const before = await store.getScan(failed);
  expect(before).toMatchObject({ status: "failed", errorCode: "forbidden", completedAt: expect.any(String) });
  await store.completeScan(failed, payload);
  await store.failScan(failed, "internal");
  expect(await store.getScan(failed)).toEqual(before);
  await db.query("update scans set error_code='future-code' where id=$1", [failed]);
  expect((await store.getScan(failed))?.errorCode).toBe("internal");
});
it("lists newest first with limits and never selects inventory in metadata queries", async () => {
  const ids: string[] = [];
  for (let n = 0; n < 22; n++) {
    const id = await store.createImportScan({ workspaceId, ...payload }); ids.push(id);
    await db.query("update scans set created_at=$2 where id=$1", [id, new Date(2026, 0, 1, 0, n)]);
  }
  await store.createImportScan({ workspaceId: await insertTestWorkspace(db), ...payload });
  const spy = vi.spyOn(db, "query");
  expect((await store.listScans(workspaceId)).map(row => row.id)).toEqual(ids.slice(2).reverse());
  expect((await store.listScans(workspaceId, { limit: 1 })).map(row => row.id)).toEqual(ids.slice(-1));
  expect(await store.listScans(workspaceId, { limit: 0 })).toEqual([]);
  expect(await store.getScan(ids[0])).not.toHaveProperty("inventory");
  for (const [sql] of spy.mock.calls) expect(sql).not.toMatch(/\binventory\b|select\s+\*/i);
});
it("cascades workspace deletion and skips malformed IDs without DB access", async () => {
  const id = (await reserve()).id;
  await db.query("delete from workspaces where id=$1", [workspaceId]);
  expect(await store.getScan(id)).toBeNull();
  expect(await store.getScanInventory(id)).toBeNull();
  const dependency = vi.fn();
  const noDb = createScansDb({ db: dependency });
  expect(await noDb.getScan("bad")).toBeNull();
  expect(await noDb.getScanInventory("bad")).toBeNull();
  expect(dependency).not.toHaveBeenCalled();
});
it("logs and sanitizes DB and parsing failures", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  const broken = createScansDb({ db: async () => { throw new Error("fake-db-error"); } });
  for (const call of [() => broken.reserveLiveScan({ workspaceId, subscriptionIds, staleBefore: new Date() }), () => broken.createImportScan({ workspaceId, ...payload }), () => broken.completeScan(missing, payload), () => broken.failScan(missing, "timeout"), () => broken.getScan(missing), () => broken.getScanInventory(missing), () => broken.listScans(workspaceId)]) await expect(call()).rejects.toBeInstanceOf(WorkspaceStoreError);
  expect(log).toHaveBeenCalledWith(expect.stringContaining("scans failed"));
  const id = await store.createImportScan({ workspaceId, ...payload });
  await db.query("update scans set summary='{}'::jsonb, inventory='{}'::jsonb where id=$1", [id]);
  await expect(store.getScan(id)).rejects.toBeInstanceOf(WorkspaceStoreError);
  await expect(store.getScanInventory(id)).rejects.toBeInstanceOf(WorkspaceStoreError);
});

it("finds the latest collection outside the 20-row history without reading inventory", async () => {
  expect(await store.getLatestSucceededScan(workspaceId)).toBeNull();
  const newest = await store.createImportScan({ workspaceId, ...payload, collectedAt: "2026-01-03T00:00:00.000Z" });
  await store.createImportScan({ workspaceId, ...payload, collectedAt: "2026-01-01T00:00:00.000Z" });
  for (let n = 0; n < 21; n++) {
    const id = (await reserve()).id;
    await store.failScan(id, "timeout");
  }
  await reserve();
  await store.createImportScan({ workspaceId: await insertTestWorkspace(db), ...payload, collectedAt: "2026-02-01T00:00:00.000Z" });
  expect((await store.listScans(workspaceId)).every(row => row.status !== "succeeded")).toBe(true);
  const spy = vi.spyOn(db, "query");
  expect(await store.getLatestSucceededScan(workspaceId)).toMatchObject({ id: newest, collectedAt: "2026-01-03T00:00:00.000Z" });
  expect(spy).toHaveBeenCalledTimes(1);
  expect(spy.mock.calls[0][0]).not.toMatch(/\binventory\b|select\s+\*/i);
});
