// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import * as replay from "@/lib/assessment/rules/engine";
import { setupRoadmapIntegration } from "./assessment-roadmap.test-data";
let db: PGlite;
afterEach(async () => { vi.restoreAllMocks(); await db?.close(); });

it("runs actual pinned storage, attempt proof, retry billing and repeated reopen without replay or more calls", async () => {
  const f = await setupRoadmapIntegration(); db = f.db; const tasks: (() => Promise<void>)[] = [];
  f.request.mockResolvedValueOnce({ data: {}, usage: { promptTokens: 1, completionTokens: 1, costUsd: 0.1 } });
  const replaySpy = vi.spyOn(replay, "evaluateAssessmentRules").mockImplementation(() => { throw new Error("NO REPLAY"); });
  expect(await f.jobs.start(f.id, f.workspaceId, f.workspaceId, task => tasks.push(task))).toMatchObject({ status: 202 });
  await f.jobs.start(f.id, f.workspaceId, f.workspaceId, task => tasks.push(task));
  expect(tasks).toHaveLength(1); await tasks[0]();
  const saved = (await f.jobs.get(f.id, "different-cookie"))!;
  expect(saved).toMatchObject({ workspaceMismatch: true, roadmap: { status: "succeeded", usage: { promptTokens: 11, completionTokens: 21, costUsd: expect.closeTo(0.3) } } });
  expect(f.completionRequest).toHaveBeenCalledTimes(2);
  expect(f.completionRequest.mock.calls.every(([source]) => JSON.stringify(source) === JSON.stringify({ source: "assessment-roadmap", sourceId: f.id }))).toBe(true);
  expect((await db.query("select * from assessment_roadmap_evidence")).rows).toHaveLength(1);
  expect((await db.query("select * from llm_calls")).rows).toHaveLength(1);
  await f.jobs.get(f.id, f.workspaceId); await f.jobs.get(f.id, f.workspaceId);
  expect(f.request).toHaveBeenCalledTimes(2); expect(replaySpy).not.toHaveBeenCalled();
  expect((await f.parents.getAssessment(f.id))!.result).toEqual(f.result);
});
it("blocks unpinned parents before key/model/reservation", async () => {
  const f = await setupRoadmapIntegration(); db = f.db; await db.query("update assessments set saved_evidence=null where id=$1", [f.id]);
  expect(await f.jobs.start(f.id, f.workspaceId, f.workspaceId, vi.fn())).toMatchObject({ status: 500, code: "internal" });
  expect(f.hasKey).not.toHaveBeenCalled(); expect(f.request).not.toHaveBeenCalled();
  expect((await db.query("select * from assessment_roadmap_attempts")).rows).toHaveLength(0);
});
