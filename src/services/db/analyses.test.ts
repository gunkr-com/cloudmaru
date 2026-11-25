// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDatabase, insertTestWorkspace } from "@/lib/db/test-db.test-data";
import sample from "@/lib/analysis/fixtures/sample-result.json";
import type { AnalysisResult } from "@/types/analysis";
import { createAnalysesDb } from "./analyses";
import { WorkspaceStoreError } from "./workspaces";

const result = sample as AnalysisResult;
const input = result.input;
const usage = { promptTokens: 10, completionTokens: 20, costUsd: 0.1 };
const missing = "00000000-0000-4000-8000-000000000000";
let db: PGlite;
let store: ReturnType<typeof createAnalysesDb>;
let workspaceId: string;
beforeEach(async () => { db = await createTestDatabase(); store = createAnalysesDb({ db: async () => db }); workspaceId = await insertTestWorkspace(db); });
afterEach(async () => { await db.close(); });
const create = (sourceAnalysisId: string | null = null) => store.createAnalysis({ workspaceId, input, sourceAnalysisId });
it("creates pending rows, and a rerun follows the source analysis's workspace", async () => {
  const id = await create();
  expect(await store.getAnalysis(id)).toMatchObject({ id, workspaceId, input, status: "pending", result: null, sourceAnalysisId: null, completedAt: null });
  expect((await store.getAnalysis(await create(id)))?.sourceAnalysisId).toBe(id);
  // ID로 연 분석은 그 행의 워크스페이스를 따른다(ARCHITECTURE §패턴). 다른 워크스페이스를 고른 채
  // 다시 분석해도 원 분석의 고객사에 남기고 원 분석과의 연결을 잃지 않는다.
  const otherWorkspace = await insertTestWorkspace(db, "Other");
  const rerun = await store.createAnalysis({ workspaceId: otherWorkspace, input, sourceAnalysisId: id });
  expect(await store.getAnalysis(rerun)).toMatchObject({ workspaceId, sourceAnalysisId: id });
  for (const source of [missing, "bad"]) expect((await store.getAnalysis(await create(source)))?.sourceAnalysisId).toBeNull();
  expect(await store.getAnalysis(missing)).toBeNull();
});
it("completes or fails pending rows once, preserving terminal data and usage", async () => {
  const id = await create();
  await store.completeAnalysis(id, result, usage);
  const completed = await store.getAnalysis(id);
  expect(completed).toMatchObject({ status: "succeeded", result, completedAt: expect.any(String) });
  await store.failAnalysis(id, "llm", null);
  await store.completeAnalysis(id, { ...result, requestTitle: { en: "Changed", ko: "변경" } }, null);
  expect(await store.getAnalysis(id)).toEqual(completed);
  expect((await db.query("select usage from analyses where id=$1", [id])).rows[0]).toEqual({ usage });
  const failed = await create();
  await store.failAnalysis(failed, "validation", usage);
  const before = await store.getAnalysis(failed);
  expect(before).toMatchObject({ status: "failed", errorStage: "validation", completedAt: expect.any(String) });
  await store.completeAnalysis(failed, result, null);
  await store.failAnalysis(failed, "internal");
  expect(await store.getAnalysis(failed)).toEqual(before);
  const noUsage = await create();
  await store.failAnalysis(noUsage, "internal");
  expect((await db.query("select usage from analyses where id=$1", [noUsage])).rows[0]).toEqual({ usage: null });
});
it("lists workspace rows newest first, derives summaries and applies default and explicit limits", async () => {
  const ids = [];
  for (let n = 0; n < 52; n++) {
    const id = await create(); ids.push(id);
    await db.query("update analyses set created_at=$2 where id=$1", [id, new Date(2026, 0, 1, 0, n)]);
  }
  await store.completeAnalysis(ids[51], result, null);
  await store.createAnalysis({ workspaceId: await insertTestWorkspace(db), input, sourceAnalysisId: null });
  const rows = await store.listAnalyses(workspaceId);
  expect(rows).toHaveLength(50);
  expect(rows.map(r => r.id)).toEqual(ids.slice(2).reverse());
  expect(rows[0]).toMatchObject({ workspaceId, requestTitle: result.requestTitle, recommendedTier: result.recommendedTier, recommendedMonthly: result.plans.find(p => p.tier === result.recommendedTier)!.cost.total });
  expect(rows[1]).toMatchObject({ requestTitle: null, recommendedTier: null, recommendedMonthly: null });
  expect(await store.listAnalyses(workspaceId, { limit: 1 })).toEqual([rows[0]]);
});
it("lists calls across workspaces by call time with an inclusive boundary", async () => {
  const since = new Date("2026-11-01T00:00:00Z");
  const id = await create();
  await store.completeAnalysis(id, result, usage);
  await db.query("update analyses set created_at='2026-10-01' where id=$1", [id]);
  await db.query("update llm_calls set created_at=$2 where source_id=$1", [id, since]);
  const other = await store.createAnalysis({ workspaceId: await insertTestWorkspace(db), input, sourceAnalysisId: null });
  const unknownCost = { ...usage, costUsd: null };
  await store.failAnalysis(other, "llm", unknownCost);
  const old = await create(); await store.failAnalysis(old, "llm", usage);
  await db.query("update llm_calls set created_at=$2 where source_id=$1", [old, new Date(since.getTime() - 1)]);
  await create();
  expect(await store.listLlmUsageSince(since)).toEqual(expect.arrayContaining([usage, unknownCost]));
  expect(await store.listLlmUsageSince(since)).toHaveLength(2);
  expect(await store.listLlmUsageSince(new Date("2100-01-01"))).toEqual([]);
});
it("records late completion and failure calls without changing terminal analyses", async () => {
  const id = await create();
  await store.failAnalysis(id, "internal");
  const before = await store.getAnalysis(id);
  await store.completeAnalysis(id, result, usage);
  await store.failAnalysis(id, "llm", { ...usage, costUsd: null });
  expect(await store.getAnalysis(id)).toEqual(before);
  expect(await store.listLlmUsageSince(new Date(0))).toEqual(expect.arrayContaining([usage, { ...usage, costUsd: null }]));
  expect(await store.listLlmUsageSince(new Date(0))).toHaveLength(2);
});
it("rolls back the call record when updating the analysis fails", async () => {
  const id = await create();
  await expect(store.completeAnalysis(id, null as never, usage)).rejects.toBeInstanceOf(WorkspaceStoreError);
  expect(await store.listLlmUsageSince(new Date(0))).toEqual([]);
  expect((await store.getAnalysis(id))?.status).toBe("pending");
});
it("skips malformed lookup IDs and sanitizes all DB failures", async () => {
  const dependency = vi.fn();
  expect(await createAnalysesDb({ db: dependency }).getAnalysis("bad")).toBeNull();
  expect(dependency).not.toHaveBeenCalled();
  const broken = createAnalysesDb({ db: async () => { throw new Error("secret"); } });
  for (const call of [() => broken.createAnalysis({ workspaceId, input, sourceAnalysisId: null }), () => broken.getAnalysis(missing), () => broken.listAnalyses(workspaceId), () => broken.listLlmUsageSince(new Date()), () => broken.completeAnalysis(missing, result, usage), () => broken.failAnalysis(missing, "llm")]) {
    await expect(call()).rejects.toBeInstanceOf(WorkspaceStoreError);
    await expect(call()).rejects.not.toThrow("secret");
  }
  await expect(store.createAnalysis({ workspaceId: missing, input, sourceAnalysisId: null })).rejects.toBeInstanceOf(WorkspaceStoreError);
});
