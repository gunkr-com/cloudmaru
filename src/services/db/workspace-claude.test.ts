// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { PGlite as MemoryDb } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { createTestDatabase, insertTestWorkspace } from "@/lib/db/test-db.test-data";
import { WorkspaceStoreError } from "./workspaces";
import { createWorkspaceClaudeDb } from "./workspace-claude";

let db: PGlite;
let id: string;
let store: ReturnType<typeof createWorkspaceClaudeDb>;
const ref = "CLOUDSIGHT_CLAUDE_KEY_ACME";
beforeEach(async () => { db = await createTestDatabase(); id = await insertTestWorkspace(db); store = createWorkspaceClaudeDb({ db: async () => db }); });
afterEach(async () => { await db.close(); vi.restoreAllMocks(); });
it("migrates existing workspaces to disabled and isolates references by workspace", async () => {
  const other = await insertTestWorkspace(db);
  expect(await store.getWorkspaceClaudeSettings(id)).toEqual({ apiKeyEnv: null });
  expect(await store.saveWorkspaceClaudeSettings(id, { apiKeyEnv: ref })).toBe(true);
  expect(await store.getWorkspaceClaudeSettings(id)).toEqual({ apiKeyEnv: ref });
  expect(await store.getWorkspaceClaudeSettings(other)).toEqual({ apiKeyEnv: null });
  expect(await store.saveWorkspaceClaudeSettings(id, { apiKeyEnv: null })).toBe(true);
  expect(await store.getWorkspaceClaudeSettings(id)).toEqual({ apiKeyEnv: null });
});
it("stores only a validated reference, never extra credentials", async () => {
  await store.saveWorkspaceClaudeSettings(id, { apiKeyEnv: ref, apiKey: "fake-secret" } as { apiKeyEnv: string });
  expect(JSON.stringify((await db.query("select * from workspaces where id=$1", [id])).rows)).not.toContain("fake-secret");
  vi.spyOn(console, "error").mockImplementation(() => {});
  for (const value of ["fake-secret", "ANTHROPIC_API_KEY", "CLOUDSIGHT_CLAUDE_KEY_"]) {
    await expect(store.saveWorkspaceClaudeSettings(id, { apiKeyEnv: value })).rejects.toBeInstanceOf(WorkspaceStoreError);
    await expect(db.query("update workspaces set claude_api_key_env=$2 where id=$1", [id, value])).rejects.toThrow();
  }
});
it("rejects missing/malformed workspaces and sanitizes storage exceptions", async () => {
  const missing = "00000000-0000-0000-0000-000000000001";
  expect(await store.getWorkspaceClaudeSettings(missing)).toBeNull();
  expect(await store.saveWorkspaceClaudeSettings(missing, { apiKeyEnv: ref })).toBe(false);
  const noDb = vi.fn();
  const invalid = createWorkspaceClaudeDb({ db: noDb });
  expect(await invalid.getWorkspaceClaudeSettings("bad")).toBeNull();
  expect(await invalid.saveWorkspaceClaudeSettings("bad", { apiKeyEnv: ref })).toBe(false);
  expect(noDb).not.toHaveBeenCalled();
  vi.spyOn(console, "error").mockImplementation(() => {});
  const broken = createWorkspaceClaudeDb({ db: async () => { throw Error("private-secret"); } });
  const error = await broken.getWorkspaceClaudeSettings(id).catch(e => e);
  expect(error).toBeInstanceOf(WorkspaceStoreError);
  expect(String(error)).not.toContain("private-secret");
  expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("private-secret");
});
it("upgrades an existing database without changing stored workspaces or scans", async () => {
  const old = new MemoryDb();
  try {
    for (const file of ["0001_init.sql", "0002_scans.sql", "0003_llm_calls.sql"]) {
      await old.exec(await readFile(`db/migrations/${file}`, "utf8"));
    }
    const existing = await insertTestWorkspace(old, "Synthetic Company");
    const scan = (await old.query("insert into scans(workspace_id, source, status, inventory, summary, collected_at) values ($1, 'import', 'succeeded', $2, $3, now()) returning *", [existing, { synthetic: true }, { resourceCount: 0 }])).rows[0];
    await old.exec(await readFile("db/migrations/0004_workspace_claude.sql", "utf8"));
    expect((await old.query("select * from scans")).rows).toEqual([scan]);
    expect(await createWorkspaceClaudeDb({ db: async () => old }).getWorkspaceClaudeSettings(existing)).toEqual({ apiKeyEnv: null });
    expect((await old.query("select name from workspaces")).rows).toEqual([{ name: "Synthetic Company" }]);
  } finally { await old.close(); }
});
