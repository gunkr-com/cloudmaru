// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDatabase } from "@/lib/db/test-db.test-data";
import { createWorkspacesStore, WorkspaceStoreError } from "./workspaces";
let db: PGlite;
let store: ReturnType<typeof createWorkspacesStore>;
const input = { name: "Customer", companyName: "Company", defaultRegion: "canadacentral" };
beforeEach(async () => { db = await createTestDatabase(); store = createWorkspacesStore({ db: async () => db }); });
afterEach(async () => { await db.close(); });
it("creates, reads and lists only public fields with ISO timestamps", async () => {
  expect(await store.listWorkspaces()).toEqual([]);
  const workspace = await store.createWorkspace(input);
  expect(workspace).toEqual({ ...input, id: expect.any(String), currency: "CAD", createdAt: expect.any(String), updatedAt: expect.any(String) });
  const raw = await db.query<{ created_at: Date }>("select created_at from workspaces where id=$1", [workspace.id]);
  expect(raw.rows[0].created_at).toBeInstanceOf(Date);
  expect(workspace.createdAt).toBe(raw.rows[0].created_at.toISOString());
  expect(await store.getWorkspace(workspace.id)).toEqual(workspace);
  expect(await store.getWorkspace("00000000-0000-4000-8000-000000000000")).toBeNull();
  const second = await store.createWorkspace({ ...input, name: "Second" });
  await db.query("update workspaces set created_at='2000-01-01' where id=$1", [second.id]);
  expect((await store.listWorkspaces()).map(w => w.id)).toEqual([second.id, workspace.id]);
});
it("updates fields and timestamp and returns null for missing IDs", async () => {
  const original = await store.createWorkspace(input);
  await db.query("update workspaces set updated_at='2000-01-01' where id=$1", [original.id]);
  const updated = await store.updateWorkspace(original.id, { name: "Changed", companyName: null, defaultRegion: "canadacentral" });
  expect(updated).toMatchObject({ id: original.id, name: "Changed", companyName: null, defaultRegion: "canadacentral", currency: "CAD", createdAt: original.createdAt });
  expect(Date.parse(updated!.updatedAt)).toBeGreaterThan(Date.parse("2000-01-01"));
  expect(await store.updateWorkspace("00000000-0000-4000-8000-000000000000", input)).toBeNull();
});
it("does not access the DB for malformed UUIDs", async () => {
  const dependency = vi.fn();
  const isolated = createWorkspacesStore({ db: dependency });
  for (const id of ["bad", "", "' OR true --"]) {
    expect(await isolated.getWorkspace(id)).toBeNull();
    expect(await isolated.updateWorkspace(id, input)).toBeNull();
  }
  expect(dependency).not.toHaveBeenCalled();
});
it("creates exactly one default under concurrent calls across store instances", async () => {
  const other = createWorkspacesStore({ db: async () => db });
  const defaults = await Promise.all([store.ensureDefaultWorkspace(), other.ensureDefaultWorkspace(), store.ensureDefaultWorkspace()]);
  expect(new Set(defaults.map(w => w.id)).size).toBe(1);
  expect(defaults[0]).toMatchObject({ name: "Default workspace", companyName: null, defaultRegion: "canadacentral", currency: "CAD" });
  expect(await store.listWorkspaces()).toHaveLength(1);
});
it("returns the oldest existing workspace without adding a default", async () => {
  const existing = await store.createWorkspace(input);
  expect(await store.ensureDefaultWorkspace()).toEqual(existing);
  expect(await store.listWorkspaces()).toHaveLength(1);
});
it("hides raw errors for every store operation, including connection failures", async () => {
  const broken = createWorkspacesStore({ db: async () => { throw new Error("secret database path"); } });
  const id = "00000000-0000-4000-8000-000000000000";
  for (const call of [() => broken.listWorkspaces(), () => broken.getWorkspace(id), () => broken.createWorkspace(input), () => broken.updateWorkspace(id, input), () => broken.ensureDefaultWorkspace()]) {
    await expect(call()).rejects.toBeInstanceOf(WorkspaceStoreError);
    await expect(call()).rejects.toThrow("저장소 요청에 실패했습니다.");
    await call().catch(error => { expect(error.cause).toBeUndefined(); expect(error.message).not.toContain("secret"); });
  }
  await expect(store.createWorkspace({ ...input, name: "" })).rejects.toBeInstanceOf(WorkspaceStoreError);
});
