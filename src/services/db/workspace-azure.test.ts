// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDatabase, insertTestWorkspace } from "@/lib/db/test-db.test-data";
import { WorkspaceStoreError } from "./workspaces";
import { createWorkspaceAzureDb } from "./workspace-azure";

const missing = "00000000-0000-0000-0000-000000000001";
const connection = { tenantId: missing, clientId: missing, certificatePath: "/fake/certificate.pem", certificatePasswordEnv: "FAKE_CERT_PASSWORD" };
const settings = { connection, subscriptionIds: [missing] };
let db: PGlite;
let workspaceId: string;
let store: ReturnType<typeof createWorkspaceAzureDb>;
beforeEach(async () => { db = await createTestDatabase(); workspaceId = await insertTestWorkspace(db); store = createWorkspaceAzureDb({ db: async () => db }); });
afterEach(async () => { await db.close(); vi.restoreAllMocks(); });
it("round-trips validated settings and allows clearing the connection", async () => {
  expect(await store.getWorkspaceAzureSettings(workspaceId)).toEqual({ connection: null, subscriptionIds: [] });
  expect(await store.saveWorkspaceAzureSettings(workspaceId, settings)).toBe(true);
  expect(await store.getWorkspaceAzureSettings(workspaceId)).toEqual(settings);
  expect((await db.query("select azure_connection from workspaces where id=$1", [workspaceId])).rows[0]).toEqual({ azure_connection: connection });
  expect(await store.saveWorkspaceAzureSettings(workspaceId, { connection: null, subscriptionIds: [] })).toBe(true);
  expect(await store.getWorkspaceAzureSettings(workspaceId)).toEqual({ connection: null, subscriptionIds: [] });
});
it("revalidates stored JSON and normalizes GUIDs", async () => {
  await db.query("update workspaces set azure_connection=$2, subscription_ids=$3 where id=$1", [workspaceId, { ...connection, tenantId: "AAAAAAAA-0000-0000-0000-000000000001" }, [missing, missing]]);
  expect(await store.getWorkspaceAzureSettings(workspaceId)).toEqual({ connection: { ...connection, tenantId: "aaaaaaaa-0000-0000-0000-000000000001" }, subscriptionIds: [missing] });
  for (const value of [{}, { ...connection, certificatePath: "relative" }, "bad"]) {
    await db.query("update workspaces set azure_connection=$2 where id=$1", [workspaceId, typeof value === "string" ? JSON.stringify(value) : value]);
    expect((await store.getWorkspaceAzureSettings(workspaceId))?.connection).toBeNull();
  }
});
it("strips extra secret fields on save and rejects malformed input", async () => {
  await store.saveWorkspaceAzureSettings(workspaceId, { ...settings, connection: { ...connection, password: "fake-secret", certificate: "fake-content" } } as typeof settings);
  expect((await db.query("select azure_connection from workspaces where id=$1", [workspaceId])).rows[0]).toEqual({ azure_connection: connection });
  vi.spyOn(console, "error").mockImplementation(() => {});
  await expect(store.saveWorkspaceAzureSettings(workspaceId, { ...settings, connection: { ...connection, certificatePath: "bad" } })).rejects.toBeInstanceOf(WorkspaceStoreError);
});
it("handles missing IDs without querying malformed UUIDs and sanitizes failures", async () => {
  expect(await store.getWorkspaceAzureSettings(missing)).toBeNull();
  expect(await store.saveWorkspaceAzureSettings(missing, settings)).toBe(false);
  const dependency = vi.fn(); const noDb = createWorkspaceAzureDb({ db: dependency });
  expect(await noDb.getWorkspaceAzureSettings("bad")).toBeNull();
  expect(await noDb.saveWorkspaceAzureSettings("bad", settings)).toBe(false);
  expect(dependency).not.toHaveBeenCalled();
  vi.spyOn(console, "error").mockImplementation(() => {});
  const broken = createWorkspaceAzureDb({ db: async () => { throw new Error("fake-db-error"); } });
  await expect(broken.getWorkspaceAzureSettings(missing)).rejects.toBeInstanceOf(WorkspaceStoreError);
  await expect(broken.saveWorkspaceAzureSettings(missing, settings)).rejects.toBeInstanceOf(WorkspaceStoreError);
});
