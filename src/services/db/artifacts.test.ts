// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDatabase, insertTestWorkspace } from "@/lib/db/test-db.test-data";
import sample from "@/lib/analysis/fixtures/sample-result.json";
import type { AnalysisResult } from "@/types/analysis";
import { createAnalysesDb } from "./analyses";
import { createArtifactsDb } from "./artifacts";
import { summarizeMonthlyCost } from "@/lib/llm/monthly-cost";
import { WorkspaceStoreError } from "./workspaces";

const usage = { promptTokens: 10, completionTokens: 20, costUsd: 0.1 };
const missing = "00000000-0000-4000-8000-000000000000";
let db: PGlite;
let store: ReturnType<typeof createArtifactsDb>;
let analysisId: string;
beforeEach(async () => {
  db = await createTestDatabase(); store = createArtifactsDb({ db: async () => db });
  const analyses = createAnalysesDb({ db: async () => db });
  analysisId = await analyses.createAnalysis({ workspaceId: await insertTestWorkspace(db), input: (sample as AnalysisResult).input, sourceAnalysisId: null });
});
afterEach(async () => { await db.close(); });
const args = () => ({ analysisId, tier: "low" as const, kind: "guide" as const, staleBefore: new Date("2000-01-01") });
async function succeed() { await createAnalysesDb({ db: async () => db }).completeAnalysis(analysisId, sample as AnalysisResult, null); }
async function reserve() { const r = await store.reserveArtifact(args()); if (!r.ok) throw new Error("reservation failed"); return r; }
it("rejects unavailable analyses and avoids DB access for malformed IDs", async () => {
  expect(await store.reserveArtifact(args())).toEqual({ ok: false, reason: "analysis-unavailable" });
  await db.query("update analyses set status='failed' where id=$1", [analysisId]);
  expect(await store.reserveArtifact(args())).toEqual({ ok: false, reason: "analysis-unavailable" });
  expect(await store.reserveArtifact({ ...args(), analysisId: missing })).toEqual({ ok: false, reason: "analysis-unavailable" });
  const dependency = vi.fn(); const isolated = createArtifactsDb({ db: dependency });
  expect(await isolated.reserveArtifact({ ...args(), analysisId: "bad" })).toEqual({ ok: false, reason: "analysis-unavailable" });
  expect(await isolated.listArtifacts("bad")).toEqual([]);
  expect(dependency).not.toHaveBeenCalled();
});
it("reuses fresh and successful reservations, and resets failed or stale rows", async () => {
  await succeed();
  const first = await reserve();
  expect(first).toMatchObject({ ok: true, status: "pending", created: true });
  expect(await reserve()).toEqual({ ...first, created: false });
  await store.failArtifact(first.id, usage);
  expect(await reserve()).toEqual(first);
  expect((await db.query("select usage,content,completed_at from artifacts where id=$1", [first.id])).rows[0]).toEqual({ usage, content: null, completed_at: null });
  await db.query("update artifacts set created_at='1999-01-01' where id=$1", [first.id]);
  expect(await reserve()).toEqual(first);
  await store.completeArtifact(first.id, { steps: [] }, usage);
  expect(await reserve()).toEqual({ ...first, created: false, status: "succeeded" });
});
it("keeps the API usage of failed attempts when a revived artifact finishes", async () => {
  await succeed();
  const first = await reserve();
  await store.failArtifact(first.id, usage);
  await reserve();
  await store.failArtifact(first.id, { promptTokens: 1, completionTokens: 2, costUsd: 0.25 });
  await reserve();
  await store.failArtifact(first.id);
  await reserve();
  await store.completeArtifact(first.id, { steps: [] }, { promptTokens: 100, completionTokens: 200, costUsd: 1 });
  expect((await db.query("select usage from artifacts where id=$1", [first.id])).rows[0]).toEqual({ usage: { promptTokens: 111, completionTokens: 222, costUsd: 1.35 } });
  const other = await store.reserveArtifact({ ...args(), kind: "bicep" });
  if (!other.ok) throw new Error("reservation failed");
  await store.failArtifact(other.id, usage);
  await store.reserveArtifact({ ...args(), kind: "bicep" });
  await store.completeArtifact(other.id, { steps: [] }, { ...usage, costUsd: null });
  expect((await db.query("select usage from artifacts where id=$1", [other.id])).rows[0]).toEqual({ usage: { promptTokens: 20, completionTokens: 40, costUsd: null } });
});
it("allows concurrent requests to create only one reservation", async () => {
  await succeed();
  const results = await Promise.all([store.reserveArtifact(args()), createArtifactsDb({ db: async () => db }).reserveArtifact(args())]);
  expect(results.filter(r => r.ok && r.created)).toHaveLength(1);
  expect(await store.listArtifacts(analysisId)).toHaveLength(1);
});
it("updates only pending artifacts and lists only the requested analysis", async () => {
  await succeed(); const first = await reserve();
  expect(await store.listArtifacts(missing)).toEqual([]);
  await store.completeArtifact(first.id, { steps: [] }, usage);
  const completed = await store.listArtifacts(analysisId);
  expect(completed[0]).toMatchObject({ analysisId, status: "succeeded", content: { steps: [] }, completedAt: expect.any(String) });
  await store.failArtifact(first.id, null); await store.completeArtifact(first.id, {}, null);
  expect(await store.listArtifacts(analysisId)).toEqual(completed);
  expect((await db.query("select usage from artifacts where id=$1", [first.id])).rows[0]).toEqual({ usage });
  const failed = await store.reserveArtifact({ ...args(), kind: "bicep" });
  if (!failed.ok) throw new Error("reservation failed");
  await store.failArtifact(failed.id, usage);
  const before = await store.listArtifacts(analysisId);
  await store.completeArtifact(failed.id, {}, null); await store.failArtifact(failed.id);
  expect(await store.listArtifacts(analysisId)).toEqual(before);
  expect(before.find(a => a.id === failed.id)).toMatchObject({ status: "failed", completedAt: expect.any(String) });
  await store.reserveArtifact({ ...args(), kind: "evaluation" }).then(async r => { if (r.ok) await store.failArtifact(r.id); });
  expect((await db.query("select usage from artifacts where kind='evaluation'")).rows[0]).toEqual({ usage: null });
});
it("sanitizes database and connection errors", async () => {
  const logged = vi.spyOn(console, "error").mockImplementation(() => {});
  const broken = createArtifactsDb({ db: async () => { throw new Error("secret"); } });
  for (const call of [() => broken.reserveArtifact(args()), () => broken.listArtifacts(analysisId), () => broken.completeArtifact(missing, {}, usage), () => broken.failArtifact(missing)]) {
    await expect(call()).rejects.toBeInstanceOf(WorkspaceStoreError);
    await expect(call()).rejects.not.toThrow("secret");
  }
  // 화면에는 일반 오류만 가고, 원인은 서버 로그에 남는다.
  expect(logged).toHaveBeenCalledWith(expect.stringContaining("Error: secret"));
  logged.mockRestore();
  await succeed();
  await expect(store.reserveArtifact({ ...args(), tier: "invalid" as never })).rejects.toBeInstanceOf(WorkspaceStoreError);
});

it("counts only this month's retry and counts unknown costs per attempt", async () => {
  await succeed();
  const first = await reserve();
  const analyses = createAnalysesDb({ db: async () => db });
  await store.failArtifact(first.id, usage);
  await db.query("update artifacts set created_at='2026-10-01' where id=$1", [first.id]);
  await db.query("update llm_calls set created_at='2026-10-01' where source_id=$1", [first.id]);
  await reserve();
  const unknown = { ...usage, costUsd: null };
  await store.failArtifact(first.id, unknown);
  await reserve();
  await store.completeArtifact(first.id, {}, unknown);
  const calls = await analyses.listLlmUsageSince(new Date("2026-11-01T00:00:00Z"));
  expect(calls).toEqual([unknown, unknown]);
  expect(summarizeMonthlyCost(calls)).toEqual({ totalUsd: 0, uncountedCalls: 2 });
  expect((await db.query("select usage from artifacts where id=$1", [first.id])).rows[0]).toEqual({ usage: { promptTokens: 30, completionTokens: 60, costUsd: null } });
});
it("records late completion and failure calls without changing terminal artifacts", async () => {
  await succeed();
  const first = await reserve();
  await store.failArtifact(first.id);
  const before = await store.listArtifacts(analysisId);
  await store.completeArtifact(first.id, {}, usage);
  await store.failArtifact(first.id, usage);
  expect(await store.listArtifacts(analysisId)).toEqual(before);
  expect(await createAnalysesDb({ db: async () => db }).listLlmUsageSince(new Date(0))).toEqual([usage, usage]);
});
it("rolls back the call record when updating the artifact fails", async () => {
  await succeed();
  const first = await reserve();
  await expect(store.completeArtifact(first.id, null, usage)).rejects.toBeInstanceOf(WorkspaceStoreError);
  expect(await createAnalysesDb({ db: async () => db }).listLlmUsageSince(new Date(0))).toEqual([]);
  expect((await store.listArtifacts(analysisId))[0].status).toBe("pending");
});
