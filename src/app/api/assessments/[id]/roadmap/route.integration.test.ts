// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import type { createAssessmentRoadmapServices } from "@/services/assessment-roadmap";
const state = vi.hoisted(() => ({ workspaceId: "", jobs: null as ReturnType<typeof createAssessmentRoadmapServices> | null, tasks: [] as (() => Promise<void>)[] }));
vi.mock("@/services/current-workspace", () => ({ getCurrentWorkspace: async () => ({ id: state.workspaceId }) }));
vi.mock("next/server", () => ({ after: (task: () => Promise<void>) => state.tasks.push(task) }));
vi.mock("@/services/assessment-roadmap", async original => {
  const real = await original<typeof import("@/services/assessment-roadmap")>();
  return { ...real, roadmapJobs: { start: (...args: Parameters<typeof real.roadmapJobs.start>) => state.jobs!.start(...args), get: (...args: Parameters<typeof real.roadmapJobs.get>) => state.jobs!.get(...args) } };
});
import { setupRoadmapIntegration } from "@/services/assessment-roadmap.test-data";
import { GET, POST } from "./route";
let db: PGlite;
afterEach(async () => { vi.restoreAllMocks(); state.tasks = []; await db?.close(); });
function request(id: string, workspaceId: string) { return new Request(`http://localhost/api/assessments/${id}/roadmap`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workspaceId }) }); }
it("actual memory PGlite route/after/job/reopen preserves owner and local facts across cookies", async () => {
  const f = await setupRoadmapIntegration(); db = f.db; state.jobs = f.jobs; state.workspaceId = f.workspaceId;
  const context = { params: Promise.resolve({ id: f.id }) };
  expect((await POST(request(f.id, f.workspaceId), context)).status).toBe(202);
  expect((await POST(request(f.id, f.workspaceId), context)).status).toBe(202);
  expect(state.tasks).toHaveLength(1);
  state.workspaceId = "00000000-0000-4000-8000-000000001234";
  expect((await POST(request(f.id, f.workspaceId), context)).status).toBe(409);
  await state.tasks[0]();
  for (let i = 0; i < 2; i++) {
    const response = await GET(new Request("http://localhost"), context); expect(response.status).toBe(200);
    const saved = await response.json(); expect(saved).toMatchObject({ id: f.id, workspaceMismatch: true, roadmap: { status: "succeeded" }, coverage: { unit: "findings" } });
    expect(JSON.stringify(saved)).not.toContain("/subscriptions/"); expect(saved).not.toHaveProperty("result"); expect(saved).not.toHaveProperty("saved_evidence");
  }
  expect(f.request).toHaveBeenCalledTimes(1);
  expect((await db.query("select * from llm_calls")).rows).toHaveLength(1);
  expect((await f.parents.getAssessment(f.id))!.result).toEqual(f.result);
});
it("no key produces no pending attempt; provider error records known usage and preserves local success", async () => {
  const f = await setupRoadmapIntegration(); db = f.db; state.jobs = f.jobs; state.workspaceId = f.workspaceId;
  const context = { params: Promise.resolve({ id: f.id }) };
  f.hasKey.mockResolvedValue(false);
  expect(await (await POST(request(f.id, f.workspaceId), context)).json()).toMatchObject({ code: "key-unavailable", workspaceId: f.workspaceId });
  expect((await db.query("select * from assessment_roadmap_attempts")).rows).toHaveLength(0);
  f.hasKey.mockResolvedValue(true); f.request.mockRejectedValue({ usage: { promptTokens: 5, completionTokens: 1, costUsd: null }, message: "SECRET" });
  await POST(request(f.id, f.workspaceId), context); await state.tasks[0]();
  const saved = await (await GET(new Request("http://localhost"), context)).json();
  expect(saved.roadmap).toMatchObject({ status: "failed", error: { code: "internal" }, usage: { promptTokens: 5, completionTokens: 1, costUsd: null } });
  expect(JSON.stringify(saved)).not.toContain("SECRET"); expect((await f.parents.getAssessment(f.id))!.status).toBe("succeeded");
});
it("GET interrupts stale attempt and a retried request rejects the previous worker's late success while billing it", async () => {
  const f = await setupRoadmapIntegration(); db = f.db; state.jobs = f.jobs; state.workspaceId = f.workspaceId;
  const context = { params: Promise.resolve({ id: f.id }) };
  await POST(request(f.id, f.workspaceId), context);
  let resolve!: (value: Awaited<ReturnType<typeof f.request>>) => void;
  const valid = await f.request({ system: "", user: "", jsonSchema: {}, schemaName: "test" }); f.request.mockClear();
  let called!: () => void; const started = new Promise<void>(done => { called = done; });
  f.request.mockImplementationOnce(() => { called(); return new Promise(done => { resolve = done; }); });
  const oldTask = state.tasks[0](); await started;
  const before = (await f.jobs.get(f.id, f.workspaceId))!.roadmap.attemptId;
  f.setClockOffset(400_000);
  expect((await (await GET(new Request("http://localhost"), context)).json()).roadmap).toMatchObject({ status: "failed", error: { code: "interrupted" } });
  f.setClockOffset(0);
  await POST(request(f.id, f.workspaceId), context); const after = (await f.jobs.get(f.id, f.workspaceId))!.roadmap.attemptId;
  expect(after).not.toBe(before);
  resolve(valid); await oldTask;
  expect((await f.jobs.get(f.id, f.workspaceId))!.roadmap).toMatchObject({ status: "pending", attemptId: after });
  await state.tasks[1]();
  expect((await f.jobs.get(f.id, f.workspaceId))!.roadmap.status).toBe("succeeded");
  expect((await db.query("select * from llm_calls")).rows).toHaveLength(2);
  expect((await db.query("select * from assessment_roadmap_evidence")).rows).toHaveLength(1);
});
