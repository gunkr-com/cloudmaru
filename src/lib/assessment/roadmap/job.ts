import "server-only";
import { buildRoadmapContext, type RoadmapPayload } from "./context";
import { buildRoadmapRequest, createRoadmapValidator } from "./model";
import { requestWithValidationRetry } from "@/lib/llm/validation-retry";
import { getStaleBefore, isJobStale, JOB_MAX_DURATION_SECONDS } from "@/lib/jobs/timing";
import type { StructuredLlm } from "@/types/analysis";
import type { AssessmentCatalogData, AssessmentRecord } from "@/types/assessment";
import type { CompletionReasonCode } from "@/types/completion";
import type { LlmUsage } from "@/types/llm";
import type { AssessmentRoadmapReservation } from "@/services/db/assessment-roadmaps";

type Dependencies = {
  getAssessmentRoadmap(id: string): Promise<AssessmentRecord | null>;
  getAssessmentRoadmapCatalogData(id: string): Promise<AssessmentCatalogData | null>;
  reserveAssessmentRoadmap(id: string, staleBefore: Date): Promise<AssessmentRoadmapReservation | null>;
  completeAssessmentRoadmap(id: string, attemptId: string, content: unknown, usage: LlmUsage | null): Promise<boolean>;
  failAssessmentRoadmap(id: string, attemptId: string, code: CompletionReasonCode, usage: LlmUsage | null): Promise<boolean>;
  hasKey(id: string): Promise<boolean>;
  request: (id: string, request: Parameters<StructuredLlm>[0]) => ReturnType<StructuredLlm>;
  now: () => Date;
};
export type RoadmapStatusData = {
  id: string; workspaceId: string; sourceScanId: string; workspaceMismatch: boolean;
  roadmap: AssessmentRecord["roadmap"];
  coverage: RoadmapPayload["coverage"] | null;
  availability: "ready" | "no-data" | "unavailable";
};
type StartResult = { status: number; id?: string; code?: string; workspaceId?: string };
/** 순수 작업 제어: DB/키/모델 I/O와 clock을 주입받는다. 현재 cookie는 시작 요청만 검사한다. */
export function createRoadmapJobs(deps: Dependencies) {
  // Preserve the trusted callback, including its exact final aggregate, when all
  // bounded writes fail. Re-entering runJob retries persistence, never the model.
  const pendingPersistence = new Map<string, { save: () => Promise<void>; running?: Promise<void> }>();
  const key = (id: string, attemptId: string) => `${id}:${attemptId}`;
  async function retryWrite(write: () => Promise<unknown>) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try { await write(); return; } catch { /* exact same idempotent callback */ }
    }
    throw new Error("assessment-roadmap-persistence-pending");
  }
  async function persist(id: string, attemptId: string) {
    const token = key(id, attemptId), pending = pendingPersistence.get(token);
    if (!pending) return;
    pending.running ??= pending.save().then(() => { pendingPersistence.delete(token); })
      .finally(() => { pending.running = undefined; });
    await pending.running;
  }
  async function context(row: AssessmentRecord) {
    if (row.status !== "succeeded" || !row.result) return null;
    const catalog = await deps.getAssessmentRoadmapCatalogData(row.id);
    if (!catalog) throw new Error("assessment-roadmap-unavailable");
    return buildRoadmapContext(row.result, catalog);
  }
  async function runJob(id: string, attemptId: string): Promise<void> {
    if (pendingPersistence.has(key(id, attemptId))) { await persist(id, attemptId); return; }
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let expired = false;
    try {
      const row = await deps.getAssessmentRoadmap(id);
      if (!row || row.roadmap.status !== "pending" || row.roadmap.attemptId !== attemptId) return;
      const createdAt = row.roadmap.createdAt!;
      if (isJobStale(createdAt, deps.now())) { await deps.failAssessmentRoadmap(id, attemptId, "interrupted", null); return; }
      const basis = await context(row);
      if (!basis || basis.state === "no-data") { await deps.failAssessmentRoadmap(id, attemptId, "no-data", null); return; }
      if (!await deps.hasKey(id)) { await deps.failAssessmentRoadmap(id, attemptId, "not-configured", null); return; }
      const end = Date.parse(createdAt) + (JOB_MAX_DURATION_SECONDS - 20) * 1000;
      const remaining = end - deps.now().getTime();
      if (remaining <= 0) { await deps.failAssessmentRoadmap(id, attemptId, "timeout", null); return; }
      const computation = requestWithValidationRetry(async request => {
        // 재시도는 만료/교체된 시도에서 새 유료 호출을 시작할 수 없다.
        if (expired || deps.now().getTime() >= end) throw new Error("timeout");
        const saved = await deps.getAssessmentRoadmap(id);
        if (!saved || saved.roadmap.status !== "pending" || saved.roadmap.attemptId !== attemptId) throw new Error("interrupted");
        return deps.request(id, { ...request, timeoutMs: Math.min(request.timeoutMs ?? remaining, end - deps.now().getTime()) });
      }, buildRoadmapRequest(basis), createRoadmapValidator(basis, () => deps.now().toISOString()),
      { now: () => deps.now().getTime(), budgetMs: remaining, minRetryMs: 90_000 });
      const finish = computation.then(async outcome => {
        const usage = outcome.usage ?? null;
        pendingPersistence.set(key(id, attemptId), { save: async () => {
          if (expired || deps.now().getTime() >= end) {
            await retryWrite(() => deps.failAssessmentRoadmap(id, attemptId, "timeout", usage));
          } else if (outcome.kind === "ok") {
            try { await retryWrite(() => deps.completeAssessmentRoadmap(id, attemptId, outcome.value, usage)); }
            catch { await retryWrite(() => deps.failAssessmentRoadmap(id, attemptId, "internal", usage)); }
          } else await retryWrite(() => deps.failAssessmentRoadmap(id, attemptId, outcome.kind === "invalid" ? "validation-failed" : "internal", usage));
        } });
        await persist(id, attemptId);
      });
      // A late failure is observable and retained for runJob(id, attemptId).
      // Attaching this handler immediately also prevents unhandled rejections.
      void finish.catch(() => { console.error("assessment-roadmap-persistence-pending"); });
      const deadline = new Promise<void>(resolve => {
        timeout = setTimeout(() => { expired = true; resolve(); }, remaining);
      });
      await Promise.race([finish, deadline]);
      if (expired) {
        // 0/미확인 청구를 만들지 않는다. finish는 뒤늦게 알려진 사용량을 독립 보존한다.
        if (pendingPersistence.has(key(id, attemptId))) await persist(id, attemptId);
        else await retryWrite(() => deps.failAssessmentRoadmap(id, attemptId, "timeout", null));
      }
    } catch {
      if (pendingPersistence.has(key(id, attemptId))) throw new Error("assessment-roadmap-persistence-pending");
      // provider/저장소 원문을 로그나 화면에 반사하지 않는다.
      await retryWrite(() => deps.failAssessmentRoadmap(id, attemptId, "internal", null));
    } finally { clearTimeout(timeout); }
  }
  return {
    runJob,
    async start(id: string, currentWorkspaceId: string, requestedWorkspaceId: string, schedule: (task: () => Promise<void>) => void): Promise<StartResult> {
      try {
        const row = await deps.getAssessmentRoadmap(id);
        if (!row) return { status: 404, code: "assessment-missing" };
        if (currentWorkspaceId !== requestedWorkspaceId || currentWorkspaceId !== row.workspaceId)
          return { status: 409, code: "workspace-changed" };
        if (row.status !== "succeeded") return { status: 409, code: "assessment-not-succeeded" };
        if (row.roadmap.status === "succeeded") return { status: 200, id };
        if (row.roadmap.status === "pending" && !isJobStale(row.roadmap.createdAt!, deps.now())) return { status: 202, id };
        const basis = await context(row);
        if (!basis || basis.state === "no-data") return { status: 409, code: "no-data" };
        if (!await deps.hasKey(id)) return { status: 409, code: "key-unavailable", workspaceId: row.workspaceId };
        const reserved = await deps.reserveAssessmentRoadmap(id, getStaleBefore(deps.now()));
        if (!reserved) return { status: 409, code: "assessment-not-succeeded" };
        if (reserved.created) {
          try { schedule(() => runJob(id, reserved.attemptId)); }
          catch { await deps.failAssessmentRoadmap(id, reserved.attemptId, "internal", null); return { status: 500, code: "internal" }; }
        }
        return { status: reserved.status === "succeeded" ? 200 : 202, id };
      } catch { return { status: 500, code: "internal" }; }
    },
    async get(id: string, currentWorkspaceId: string): Promise<RoadmapStatusData | null> {
      let row = await deps.getAssessmentRoadmap(id);
      if (!row) return null;
      if (row.roadmap.status === "pending" && isJobStale(row.roadmap.createdAt!, deps.now())) {
        await deps.failAssessmentRoadmap(id, row.roadmap.attemptId!, "interrupted", null);
        row = await deps.getAssessmentRoadmap(id);
        if (!row) return null;
      }
      const basis = await context(row);
      return { id: row.id, workspaceId: row.workspaceId, sourceScanId: row.sourceScanId,
        workspaceMismatch: row.workspaceId !== currentWorkspaceId, roadmap: row.roadmap,
        coverage: basis?.payload.coverage ?? null, availability: basis?.state ?? "unavailable" };
    },
  };
}
