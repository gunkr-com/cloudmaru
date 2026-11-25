import { z } from "zod";
import { analysisInputSchema } from "@/lib/analysis/input-schema";
import { runAnalysis } from "@/lib/analysis/run-analysis";
import { isJobStale } from "@/lib/jobs/timing";
import type { AnalysisInput, AnalysisResult, StructuredLlm } from "@/types/analysis";
import type { OperatorPrices } from "@/services/operator-prices";
import type { Catalog } from "@/types/catalog";
import type { AnalysisErrorStage, AnalysisRecord } from "@/types/db";
import type { JobStatus } from "@/types/job";
import type { LlmUsage } from "@/types/llm";

export const ANALYSIS_LLM_TIMEOUT_MS = 240_000;
export const startAnalysisBodySchema = z.object({ input: z.unknown(), sourceAnalysisId: z.uuid().nullable().optional(), workspaceId: z.string().min(1).max(64) });
export const WORKSPACE_CHANGED_MESSAGE = "analysis.workspaceChanged";

type AnalysisJob = { id: string; input: AnalysisInput; catalog: Catalog };

export type StartAnalysisDeps = {
  acquireOperatorPrices: () => Promise<OperatorPrices>;
  getAnalysis: (id: string) => Promise<Pick<AnalysisRecord, "workspaceId"> | null>;
  hasWorkspaceClaudeKey: (workspaceId: string) => Promise<boolean>;
  createAnalysis: (args: { workspaceId: string; input: AnalysisInput; sourceAnalysisId: string | null }) => Promise<string>;
  schedule: (task: () => Promise<void>) => void;
  runJob: (job: AnalysisJob) => Promise<void>;
};
export type StartAnalysisResult = { status: 202; id: string } | { status: 400 | 409; errors: string[]; workspaceId?: string } | { status: 500; message: string };

export async function startAnalysis(request: { workspaceId: string; body: unknown; now: Date }, deps: StartAnalysisDeps): Promise<StartAnalysisResult> {
  if (typeof request.body === "object" && request.body !== null && "sourceAnalysisId" in request.body) {
    const sourceId = (request.body as { sourceAnalysisId?: unknown }).sourceAnalysisId;
    if (sourceId !== undefined && sourceId !== null && !z.uuid().safeParse(sourceId).success) {
      return { status: 400, errors: ["analysis.sourceNotFound"] };
    }
  }
  const body = startAnalysisBodySchema.safeParse(request.body);
  if (!body.success) return { status: 400, errors: ["analysis.invalidInput"] };
  // 폼을 연 뒤 다른 탭에서 워크스페이스를 바꿨다. 쓰던 요구사항을 바뀐 고객사에 저장하지 않는다.
  if (body.data.workspaceId !== request.workspaceId) return { status: 409, errors: [WORKSPACE_CHANGED_MESSAGE] };
  const parsed = analysisInputSchema.safeParse(body.data.input);
  if (!parsed.success) return { status: 400, errors: parsed.error.issues.map((issue) => issue.message) };
  let job: AnalysisJob;
  try {
    const sourceAnalysisId = body.data.sourceAnalysisId ?? null;
    const source = sourceAnalysisId ? await deps.getAnalysis(sourceAnalysisId) : null;
    const workspaceId = source?.workspaceId ?? request.workspaceId;
    const pricing = await deps.acquireOperatorPrices();
    if (!pricing.ok) {
      console.warn("Build pricing unavailable", { reason: pricing.reason });
      return { status: 409, errors: ["pricing.unavailable"] };
    }
    if (!await deps.hasWorkspaceClaudeKey(workspaceId)) return { status: 409, errors: ["workspace.claude.unavailable"], workspaceId };
    const id = await deps.createAnalysis({ workspaceId, input: parsed.data, sourceAnalysisId });
    job = { id, input: parsed.data, catalog: pricing.catalog };
  } catch {
    return { status: 500, message: "analysis.startFailed" };
  }
  deps.schedule(() => deps.runJob(job));
  return { status: 202, id: job.id };
}

export type RunAnalysisJobDeps = { llm: StructuredLlm; completeAnalysis: (id: string, result: AnalysisResult, usage: LlmUsage | null) => Promise<void>; failAnalysis: (id: string, stage: AnalysisErrorStage, usage?: LlmUsage | null) => Promise<void> };
export async function runAnalysisJob(job: AnalysisJob, deps: RunAnalysisJobDeps): Promise<void> {
  let failureStage: AnalysisErrorStage = "internal";
  let usage: LlmUsage | null = null;
  try {
    const outcome = await runAnalysis(job.input, { catalog: job.catalog, llm: deps.llm });
    usage = outcome.usage;
    if (!outcome.ok) {
      // 행에는 단계만 남으므로 검증 오류 같은 원인은 로그로 남긴다. 사용자 입력은 넣지 않는다.
      console.warn("분석 실패", { id: job.id, stage: outcome.stage, errors: outcome.errors });
      failureStage = outcome.stage === "input" ? "internal" : outcome.stage;
      await deps.failAnalysis(job.id, failureStage, usage);
      return;
    }
    await deps.completeAnalysis(job.id, outcome.result, usage);
  } catch {
    try { await deps.failAnalysis(job.id, failureStage, usage); } catch { /* pending jobs expire through stale status resolution */ }
  }
}

export function resolveAnalysisStatus(record: Pick<AnalysisRecord, "status" | "createdAt" | "errorStage">, now: Date): { status: JobStatus; failureReason: "failed" | "timeout" | null } {
  if (record.status === "succeeded") return { status: "succeeded", failureReason: null };
  if (record.status === "failed") return { status: "failed", failureReason: "failed" };
  if (isJobStale(record.createdAt, now)) return { status: "failed", failureReason: "timeout" };
  return { status: "pending", failureReason: null };
}
