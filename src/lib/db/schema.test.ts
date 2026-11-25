// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, insertTestWorkspace } from "./test-db.test-data";
import { applyMigrations } from "@/services/db/migrate";
import type { PGlite } from "@electric-sql/pglite";

describe("PGlite database schema", () => {
  let db: PGlite;
  let workspace: string;
  beforeEach(async () => {
    db = await createTestDatabase();
    workspace = await insertTestWorkspace(db);
  });
  afterEach(async () => { await db?.close(); });

  async function analysis(status = "succeeded") {
    return (await db.query<{ id: string }>(
      "insert into analyses(workspace_id,input,status,result) values ($1,'{}',$2,$3) returning id",
      [workspace, status, status === "succeeded" ? {} : null],
    )).rows[0]!.id;
  }

  it("exposes only the expected tables and reapplies migrations harmlessly", async () => {
    expect((await db.query<{ table_name: string }>("select table_name from information_schema.tables where table_schema='public'")).rows.map(r => r.table_name).sort())
      .toEqual(["analyses", "artifacts", "assessment_roadmap_attempts", "assessment_roadmap_evidence", "assessments", "extension_artifact_attempts", "extension_artifact_evidence", "extension_artifacts", "extensions", "llm_calls", "network_diagnostics", "scans", "schema_migrations", "workspaces"]);
    expect(await applyMigrations(db)).toEqual([]);
    expect(await applyMigrations(db)).toEqual([]);
    expect((await db.query("select * from pg_policies where schemaname='public'")).rows).toEqual([]);
    expect((await db.query("select proname from pg_proc where proname in ('reserve_analysis','analysis_usage_count')")).rows).toEqual([]);
  });

  it("cascades workspace deletion and clears deleted source references", async () => {
    const source = await analysis();
    const child = await analysis();
    await db.query("update analyses set source_analysis_id=$1 where id=$2", [source, child]);
    await db.query("delete from analyses where id=$1", [source]);
    expect((await db.query("select source_analysis_id from analyses where id=$1", [child])).rows).toEqual([{ source_analysis_id: null }]);
    await db.query("insert into artifacts(analysis_id,tier,kind) values ($1,'low','guide')", [child]);
    await db.query("delete from workspaces where id=$1", [workspace]);
    expect((await db.query("select * from analyses")).rows).toEqual([]);
    expect((await db.query("select * from artifacts")).rows).toEqual([]);
  });

  it("enforces workspace defaults, required values, checks and artifact uniqueness", async () => {
    expect((await db.query("select default_region,currency,subscription_ids from workspaces where id=$1", [workspace])).rows[0])
      .toEqual({ default_region: "canadacentral", currency: "CAD", subscription_ids: [] });
    for (const name of ["", "  ", "x".repeat(81)]) {
      await expect(db.query("insert into workspaces(name) values ($1)", [name])).rejects.toThrow();
    }
    await expect(db.query("insert into workspaces(name,currency) values ('test','USD')")).rejects.toThrow();
    await expect(db.query("insert into analyses(workspace_id,input,status) values ($1,'{}','succeeded')", [workspace])).rejects.toThrow();
    await expect(db.query("insert into analyses(input) values ('{}')")).rejects.toThrow();
    await expect(db.query("insert into analyses(workspace_id,input,status) values ($1,'{}','bad')", [workspace])).rejects.toThrow();
    await expect(db.query("insert into analyses(workspace_id,input,error_stage) values ($1,'{}','bad')", [workspace])).rejects.toThrow();
    const id = await analysis();
    for (const values of [["bad", "guide", "pending"], ["low", "bad", "pending"], ["low", "guide", "other"], ["low", "guide", "succeeded"]]) {
      await expect(db.query("insert into artifacts(analysis_id,tier,kind,status) values ($1,$2,$3,$4)", [id, ...values])).rejects.toThrow();
    }
    await db.query("insert into artifacts(analysis_id,tier,kind,usage) values ($1,'low','guide','{}')", [id]);
    await expect(db.query("insert into artifacts(analysis_id,tier,kind) values ($1,'low','guide')", [id])).rejects.toThrow();
  });

  it("reserves once, reuses success, and revives failed or stale artifacts", async () => {
    const call = (id: string) => db.query<{ id: string; status: string; created: boolean }>(
      "select * from reserve_artifact($1,'balanced','guide',now() - interval '1 hour')", [id]);
    for (const id of [crypto.randomUUID(), await analysis("failed"), await analysis("pending")]) {
      expect((await call(id)).rows).toEqual([]);
    }
    const id = await analysis();
    const [first, again] = await Promise.all([call(id), call(id)]);
    const artifact = first.rows[0]!;
    expect(artifact).toMatchObject({ created: true, status: "pending" });
    expect(again.rows[0]).toEqual({ ...artifact, created: false });
    await db.query("update artifacts set status='succeeded',content='{}',usage='{}',completed_at=now() where id=$1", [artifact.id]);
    expect((await call(id)).rows[0]).toEqual({ ...artifact, status: "succeeded", created: false });
    await db.query("update artifacts set status='failed',content=null,usage=$2 where id=$1", [artifact.id, { promptTokens: 1, completionTokens: 2, costUsd: 0.5 }]);
    expect((await call(id)).rows[0]).toEqual(artifact);
    // 실패한 시도도 API 비용을 썼으므로 되살려도 usage는 남긴다.
    expect((await db.query("select content,usage,completed_at from artifacts where id=$1", [artifact.id])).rows[0])
      .toEqual({ content: null, usage: { promptTokens: 1, completionTokens: 2, costUsd: 0.5 }, completed_at: null });
    await db.query("update artifacts set created_at=now() - interval '2 hours' where id=$1", [artifact.id]);
    expect((await call(id)).rows[0]).toEqual(artifact);
  });
});
