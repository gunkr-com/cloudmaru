// @vitest-environment node
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, expect, expectTypeOf, it, vi } from "vitest";
import { createTestDatabase, insertTestWorkspace } from "@/lib/db/test-db.test-data";
import { applyMigrations } from "./migrate";
import { createLlmCallsDb, recordLlmCall } from "./llm-calls";
import { WorkspaceStoreError } from "./workspaces";
import type { LlmCallSource, LlmUsage } from "@/types/llm";
import { requestWithValidationRetry } from "@/lib/llm/validation-retry";
import { requestStructuredOutput } from "@/services/claude";

let db: PGlite;
const sourceId = "00000000-0000-4000-8000-000000000000";
const usage = { promptTokens: 10, completionTokens: 20, costUsd: 0.1 };
beforeEach(async () => { db = await createTestDatabase(); });
afterEach(async () => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); await db.close(); });
it("records only token counts and cost, accepts transactions, skips null and survives source deletion", async () => {
  const store = createLlmCallsDb({ db: async () => db });
  const workspaceId = await insertTestWorkspace(db);
  const id = (await db.query<{ id: string }>("insert into analyses(workspace_id,input) values ($1,'{}') returning id", [workspaceId])).rows[0].id;
  await recordLlmCall(db, { source: "analysis", sourceId: id, usage: null });
  expect(await store.listLlmUsageSince(new Date(0))).toEqual([]);
  await recordLlmCall(db, { source: "analysis", sourceId: id, usage: { ...usage, prompt: "secret", response: "secret" } as typeof usage });
  await db.transaction(tx => recordLlmCall(tx, { source: "artifact", sourceId, usage: { ...usage, costUsd: null } }));
  await db.query("delete from analyses where id=$1", [id]);
  const rows = (await db.query("select * from llm_calls")).rows;
  expect(rows).toHaveLength(2);
  expect(rows[0]).toEqual({ id: expect.any(String), source: "analysis", source_id: id, prompt_tokens: 10, completion_tokens: 20, cost_usd: 0.1, created_at: expect.any(Date) });
  expect(await store.listLlmUsageSince(new Date(0))).toEqual(expect.arrayContaining([usage, { ...usage, costUsd: null }]));
});
it("sanitizes read and write errors and logs their cause", async () => {
  const logged = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const broken = createLlmCallsDb({ db: async () => { throw new Error("private cause"); } });
    await expect(broken.listLlmUsageSince(new Date())).rejects.toBeInstanceOf(WorkspaceStoreError);
    await expect(recordLlmCall(db, { source: "analysis", sourceId: "bad", usage })).rejects.toBeInstanceOf(WorkspaceStoreError);
    expect(logged).toHaveBeenCalledWith(expect.stringContaining("private cause"));
  } finally { logged.mockRestore(); }
});
it("migrates valid legacy usage once using completion time or creation time, skipping malformed JSON", async () => {
  await db.close();
  db = new PGlite();
  await db.exec("set timezone='UTC'");
  for (const file of ["0001_init.sql", "0002_scans.sql"]) await db.exec(await readFile(`db/migrations/${file}`, "utf8"));
  await db.exec("create table schema_migrations(version text primary key); insert into schema_migrations values ('0001_init.sql'), ('0002_scans.sql')");
  const workspaceId = await insertTestWorkspace(db);
  async function analysis(value: unknown, completed = true) {
    return (await db.query<{ id: string }>("insert into analyses(workspace_id,input,usage,created_at,completed_at) values ($1,'{}',$2,'2026-10-01',$3) returning id", [workspaceId, value === null ? null : JSON.stringify(value), completed ? new Date("2026-11-01T00:00:00Z") : null])).rows[0].id;
  }
  const analysisId = await analysis(usage);
  const unknownId = await analysis({ ...usage, costUsd: null }, false);
  await db.query("insert into artifacts(analysis_id,tier,kind,usage,created_at,completed_at) values ($1,'low','guide',$2,'2026-10-02','2026-11-02'),($1,'low','bicep',$2,'2026-10-03',null),($1,'ha','guide',null,now(),null),($1,'ha','bicep','[]',now(),null)", [analysisId, usage]);
  for (const invalid of [null, [], "bad", 2, {}, { ...usage, promptTokens: "10" }, { ...usage, completionTokens: -1 }, { ...usage, promptTokens: 0.5 }, { ...usage, promptTokens: 2147483648 }, { ...usage, costUsd: "bad" }, { ...usage, costUsd: -1 }, { promptTokens: 1, completionTokens: 2 }]) await analysis(invalid);
  await db.exec(`insert into analyses(workspace_id,input,usage) values ('${workspaceId}','{}','{"promptTokens":1,"completionTokens":2,"costUsd":1e400}')`);
  expect(await applyMigrations(db)).toEqual(["0003_llm_calls.sql", "0004_workspace_claude.sql", "0005_completion.sql", "0006_extension_saved_evidence.sql", "0007_assessment_saved_evidence.sql", "0008_completion_attempt_evidence.sql", "0009_completion_attempt_ledger.sql", "0010_compiler_error.sql"]);
  expect(await applyMigrations(db)).toEqual([]);
  const rows = (await db.query<{ source: string; source_id: string; created_at: Date; cost_usd: number | null }>("select * from llm_calls order by created_at")).rows;
  expect(rows).toHaveLength(4);
  expect(rows.map(row => [row.source, row.created_at.toISOString()])).toEqual([["analysis", "2026-10-01T00:00:00.000Z"], ["artifact", "2026-10-03T00:00:00.000Z"], ["analysis", "2026-11-01T00:00:00.000Z"], ["artifact", "2026-11-02T00:00:00.000Z"]]);
  expect(rows[0]).toMatchObject({ source_id: unknownId, cost_usd: null });
  expect(rows[2]).toMatchObject({ source_id: analysisId, cost_usd: usage.costUsd });
  expect(await createLlmCallsDb({ db: async () => db }).listLlmUsageSince(new Date("2026-11-01T00:00:00Z"))).toEqual([usage, usage]);
});

it("records every completion source and aggregates it with legacy usage at the same monthly boundary", async () => {
  expectTypeOf<Parameters<typeof recordLlmCall>[1]["source"]>().toEqualTypeOf<LlmCallSource>();
  const sources = ["analysis", "artifact", "assessment-roadmap", "extension", "extension-artifact"] as const;
  for (const source of sources) await recordLlmCall(db, { source, sourceId, usage });
  await db.query("update llm_calls set created_at='2026-11-01T00:00:00Z'");
  await db.query("insert into llm_calls(source,source_id,prompt_tokens,completion_tokens,cost_usd,created_at) values ('artifact',$1,9,9,9,'2026-10-31T23:59:59Z')", [sourceId]);
  expect(await createLlmCallsDb({ db: async () => db }).listLlmUsageSince(new Date("2026-11-01T00:00:00Z"))).toEqual(sources.map(() => usage));
  await expect(db.query("insert into llm_calls(source,source_id,prompt_tokens,completion_tokens) values ('network',$1,1,1)", [sourceId])).rejects.toThrow();
});

it.each(["assessment-roadmap", "extension", "extension-artifact"] as const)(
  "records all returned billable usage for failed %s generation and retries, without requiring a successful source", async source => {
    vi.stubEnv("CLOUDSIGHT_CLAUDE_KEY_SYNTHETIC", "fake-test-only-key");
    vi.stubEnv("CLAUDE_MODEL", "claude-opus-5-5");
    const http = vi.fn<typeof fetch>().mockRejectedValue(Error("unexpected network"));
    vi.stubGlobal("fetch", http);
    const response = (text: string, unknownCost = false) => Response.json({ model: "claude-opus-5-5",
      content: [{ type: "text", text }], stop_reason: "end_turn",
      usage: { input_tokens: 100, output_tokens: 20, ...(unknownCost ? { iterations: [{ type: "fallback_message" }] } : {}) } });
    const request: Parameters<typeof requestStructuredOutput>[0] = { system: "synthetic", user: "synthetic", schemaName: "test", jsonSchema: { type: "object", properties: {}, additionalProperties: false } };
    const llm = (r: typeof request) => requestStructuredOutput({ ...r, apiKeyEnv: "CLOUDSIGHT_CLAUDE_KEY_SYNTHETIC" });
    const validate = () => ({ ok: false as const, errors: ["synthetic rejection"] });
    const expected: LlmUsage[] = [];
    for (const scenario of ["validation-failed", "retry-json-failed", "initial-json-failed", "retry-http-failed"]) {
      http.mockResolvedValueOnce(response(scenario === "initial-json-failed" ? "invalid JSON" : "{}"));
      if (scenario === "validation-failed") http.mockResolvedValueOnce(response("{}"));
      if (scenario === "retry-json-failed") http.mockResolvedValueOnce(response("invalid JSON", true));
      if (scenario === "retry-http-failed") http.mockRejectedValueOnce(Error("private transport detail"));
      const result = await requestWithValidationRetry(llm, request, validate);
      expect(result.kind).toBe(scenario === "initial-json-failed" ? "llm-error" : "invalid");
      const calls = scenario === "initial-json-failed" || scenario === "retry-http-failed" ? 1 : 2;
      const expectedUsage = { promptTokens: 100 * calls, completionTokens: 20 * calls,
        costUsd: scenario === "retry-json-failed" ? null : 0.0008 * calls };
      expect(result).toMatchObject({ usage: expectedUsage });
      await recordLlmCall(db, { source, sourceId, usage: result.usage ?? null });
      expected.push(expectedUsage);
    }
    expect(http).toHaveBeenCalledTimes(7);
    // 같은 시각 행은 UUID 순이므로 중복을 포함한 사용량을 비교한다.
    await db.query("update llm_calls set created_at='2026-11-01T00:00:00Z'");
    const returnedUsage = await createLlmCallsDb({ db: async () => db }).listLlmUsageSince(new Date(0));
    const usageValues = (values: readonly LlmUsage[]) => values.map(value =>
      JSON.stringify([value.promptTokens, value.completionTokens, value.costUsd])).sort();
    expect(usageValues(returnedUsage)).toEqual(usageValues(expected));
    const rows = (await db.query<{ source: string; source_id: string }>("select * from llm_calls")).rows;
    expect(rows).toHaveLength(4);
    expect(rows.every(row => row.source === source && row.source_id === sourceId)).toBe(true);
    expect(JSON.stringify(rows)).not.toMatch(/synthetic rejection|invalid JSON|private|fake-test/);
  },
);
