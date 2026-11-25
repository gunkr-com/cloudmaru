import { z } from "zod";
import { readStoredText, validationLimit } from "@/lib/llm/localized-text";
import { getStaleBefore, isJobStale } from "@/lib/jobs/timing";
import { runArtifact } from "@/lib/artifacts/run-artifact";
import { ARTIFACT_KINDS } from "@/lib/artifacts/labels";
import { bicepOutputSchema, guideOutputSchema } from "@/lib/artifacts/schemas";
import { tierSchema } from "@/lib/catalog/schema";
import type { AnalysisResult, StructuredLlm } from "@/types/analysis";
import type { ArtifactContent, ArtifactKind, EvaluationAxis } from "@/types/artifact";
import type { AnalysisRecord, ArtifactRecord } from "@/types/db";
import type { Catalog, Tier } from "@/types/catalog";
import type { JobStatus } from "@/types/job";
import type { LlmUsage } from "@/types/llm";

export { buildArtifactDownloadHref } from "@/lib/artifacts/links";
export type ArtifactView = { tier: Tier; kind: ArtifactKind; status: JobStatus; content: ArtifactContent | null; createdAt: string; completedAt: string | null };
export type RequestArtifactResult =
  | { status: 200 | 202; artifact: ArtifactView }
  | { status: 400; errors: string[] }
  | { status: 409; message: "workspace.claude.unavailable"; workspaceId: string }
  | { status: 404 | 500; message: string }
  | { status: 503; message: string };
export type ArtifactJob = { id: string; kind: ArtifactKind; tier: Tier; result: AnalysisResult };
export type RequestArtifactDeps = {
  hasWorkspaceClaudeKey: (workspaceId: string) => Promise<boolean>;
  getAnalysis: (id: string) => Promise<AnalysisRecord | null>;
  listArtifacts: (analysisId: string) => Promise<ArtifactRecord[]>;
  reserveArtifact: (args: { analysisId: string; tier: Tier; kind: ArtifactKind; staleBefore: Date }) => Promise<{ ok: true; id: string; status: JobStatus; created: boolean } | { ok: false; reason: "analysis-unavailable" }>;
  schedule: (task: () => Promise<void>) => void;
  runJob: (job: ArtifactJob) => Promise<void>;
};

export const ARTIFACT_MESSAGES = {
  analysisUnavailable: "artifacts.analysisUnavailable",
  generationFailed: "artifacts.generationFailed",
} as const;

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const requestSchema = z.object({ tier: tierSchema, kind: z.enum(ARTIFACT_KINDS) }).strip();
const axisOrder: EvaluationAxis[] = ["reliability", "security", "cost", "operations", "performance"];
// 저장된 옛 한국어 문자열에는 새 출력의 영어 한글 금지 규칙을 소급하지 않는다.
// 길이는 생성 검증과 같은 한도(프롬프트 글자 수의 1.25배, ADR-022)다. 더 좁으면 저장한 결과물을 읽지 못한다.
const storedText = (ko: number) => z.preprocess(readStoredText, z.object({
  en: z.string().min(1).max(validationLimit(ko * 2)), ko: z.string().min(1).max(validationLimit(ko)),
}));
const guideStoredSchema = guideOutputSchema.extend({
  overview: storedText(300),
  prerequisites: z.array(storedText(120)).min(1).max(6),
  steps: z.array(guideOutputSchema.shape.steps.element.extend({
    title: storedText(40), goal: storedText(120),
    instructions: z.array(storedText(200)).min(1).max(8), verification: storedText(120),
  })).min(5).max(12),
  cautions: z.array(storedText(160)).max(5),
});
const bicepStoredSchema = bicepOutputSchema.extend({
  parameters: z.array(bicepOutputSchema.shape.parameters.element.extend({ description: storedText(Number.MAX_SAFE_INTEGER) })),
  deploymentNotes: z.array(storedText(200)).min(1).max(6),
});
const evaluationStoredSchema = z.object({
  summary: storedText(200),
  axes: z.array(z.object({ axis: z.enum(axisOrder), grade: z.enum(["high", "medium", "low"]), rationale: storedText(120), improvement: storedText(120) }).strict()).length(5),
}).strict().superRefine((value, context) => {
  value.axes.forEach((entry, index) => {
    if (entry.axis !== axisOrder[index]) context.addIssue({ code: "custom", path: ["axes", index, "axis"], message: "평가 축 순서가 올바르지 않습니다." });
  });
});

export function parseStoredArtifactContent(kind: ArtifactKind, content: unknown): ArtifactContent | null {
  const schema = kind === "guide" ? guideStoredSchema : kind === "bicep" ? bicepStoredSchema : evaluationStoredSchema;
  const parsed = schema.safeParse(content);
  return parsed.success ? parsed.data as ArtifactContent : null;
}

export function toArtifactView(record: ArtifactRecord, now: Date): ArtifactView {
  let status = record.status;
  let content: ArtifactContent | null = null;
  if (status === "pending" && isJobStale(record.createdAt, now)) status = "failed";
  if (record.status === "succeeded") {
    content = parseStoredArtifactContent(record.kind, record.content);
    if (!content) status = "failed";
  }
  return { tier: record.tier, kind: record.kind, status, content, createdAt: record.createdAt, completedAt: record.completedAt };
}

export function toArtifactViews(records: ArtifactRecord[], now: Date): ArtifactView[] {
  const order = new Map(ARTIFACT_KINDS.map((kind, index) => [kind, index]));
  const tiers: Tier[] = ["low", "balanced", "ha"];
  return records.map((record) => toArtifactView(record, now)).sort((a, b) => (order.get(a.kind)! - order.get(b.kind)!) || (tiers.indexOf(a.tier) - tiers.indexOf(b.tier)));
}

export async function requestArtifact(request: { analysisId: string; body: unknown; now: Date }, deps: RequestArtifactDeps): Promise<RequestArtifactResult> {
  if (!uuidPattern.test(request.analysisId)) return { status: 404, message: ARTIFACT_MESSAGES.analysisUnavailable };
  const parsedBody = requestSchema.safeParse(request.body);
  if (!parsedBody.success) {
    const errors = parsedBody.error.issues.map((issue) => issue.path[0] === "tier" ? "artifacts.selectOption" : "artifacts.invalidKind");
    return { status: 400, errors: [...new Set(errors)] };
  }
  const { tier, kind } = parsedBody.data;
  const analysis = await deps.getAnalysis(request.analysisId);
  if (!analysis || analysis.status !== "succeeded" || !analysis.result) return { status: 404, message: ARTIFACT_MESSAGES.analysisUnavailable };
  const plan = analysis.result.plans.find((entry) => entry.tier === tier);
  if (!plan) return { status: 400, errors: ["artifacts.optionMissing"] };
  const records = await deps.listArtifacts(request.analysisId);
  const existing = records.find((entry) => entry.tier === tier && entry.kind === kind && entry.status === "succeeded" && parseStoredArtifactContent(kind, entry.content));
  if (existing) return { status: 200, artifact: toArtifactView(existing, request.now) };
  if (!await deps.hasWorkspaceClaudeKey(analysis.workspaceId)) return { status: 409, message: "workspace.claude.unavailable", workspaceId: analysis.workspaceId };
  const reservation = await deps.reserveArtifact({ analysisId: request.analysisId, tier, kind, staleBefore: getStaleBefore(request.now) });
  if (!reservation.ok) return { status: 404, message: ARTIFACT_MESSAGES.analysisUnavailable };
  if (reservation.created) {
    deps.schedule(() => deps.runJob({ id: reservation.id, kind, tier, result: analysis.result! }));
    return { status: 202, artifact: { tier, kind, status: "pending", content: null, createdAt: request.now.toISOString(), completedAt: null } };
  }
  const current = (await deps.listArtifacts(request.analysisId)).find((entry) => entry.tier === tier && entry.kind === kind);
  if (current?.status === "succeeded" && parseStoredArtifactContent(kind, current.content)) return { status: 200, artifact: toArtifactView(current, request.now) };
  // A stored success whose content no longer parses is never re-run by reserve_artifact; answering 202 would loop the client forever.
  if (reservation.status !== "pending") return { status: 500, message: ARTIFACT_MESSAGES.generationFailed };
  const createdAt = current?.status === "pending" ? current.createdAt : request.now.toISOString();
  return { status: 202, artifact: { tier, kind, status: "pending", content: null, createdAt, completedAt: null } };
}

export async function runArtifactJob(job: ArtifactJob, deps: { catalog: Catalog; llm: StructuredLlm; complete: (id: string, content: ArtifactContent, usage: LlmUsage | null) => Promise<void>; fail: (id: string, usage?: LlmUsage | null) => Promise<void> }): Promise<void> {
  let usage: LlmUsage | null = null;
  try {
    const outcome = await runArtifact(job.kind, { result: job.result, tier: job.tier }, { catalog: deps.catalog, llm: deps.llm });
    usage = outcome.usage;
    if (!outcome.ok) {
      // 행에는 실패 상태만 남으므로 검증 오류 같은 원인은 로그로 남긴다.
      console.warn("구축 결과물 생성 실패", { id: job.id, kind: job.kind, tier: job.tier, stage: outcome.stage, errors: outcome.errors });
      try { await deps.fail(job.id, usage); } catch { /* stale pending rows are handled by the job timeout policy */ }
      return;
    }
    await deps.complete(job.id, outcome.content, usage);
  } catch {
    try { await deps.fail(job.id, usage); } catch { /* stale pending rows are handled by the job timeout policy */ }
  }
}
