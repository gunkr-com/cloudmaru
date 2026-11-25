import { readStoredText } from "@/lib/llm/localized-text";
import { analysisInputSchema } from "@/lib/analysis/input-schema";
import { tierSchema } from "@/lib/catalog/schema";
import type { AnalysisResult } from "@/types/analysis";
import type { ArtifactKind } from "@/types/artifact";
import type { AnalysisErrorStage, AnalysisListItem, AnalysisRecord, ArtifactRecord } from "@/types/db";
import type { JobStatus } from "@/types/job";
import type { LlmUsage } from "@/types/llm";

export class RowParseError extends Error {
  constructor() {
    super("저장된 데이터 형식이 올바르지 않습니다.");
    this.name = "RowParseError";
  }
}

const statuses = ["pending", "succeeded", "failed"] as const;
const artifactKinds = ["guide", "evaluation", "bicep"] as const;
const errorStages = ["llm", "validation", "internal"] as const;
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isString = (value: unknown): value is string => typeof value === "string";
const nullableString = (value: unknown): value is string | null => value === null || isString(value);
function parseStatus(value: unknown): JobStatus { if (typeof value === "string" && (statuses as readonly string[]).includes(value)) return value as JobStatus; throw new RowParseError(); }
function parseTier(value: unknown) { const parsed = tierSchema.safeParse(value); if (!parsed.success) throw new RowParseError(); return parsed.data; }
function parseErrorStage(value: unknown): AnalysisErrorStage | null { if (value === null) return null; if (typeof value === "string" && (errorStages as readonly string[]).includes(value)) return value as AnalysisErrorStage; throw new RowParseError(); }
function parseResult(value: unknown): AnalysisResult | null {
  if (value === null) return null;
  if (!isObject(value) || !isString(value.priceAsOf) || !isString(value.region) || value.currency !== "CAD") throw new RowParseError();
  parseTier(value.recommendedTier);
  if (!Array.isArray(value.plans) || value.plans.length !== 3 || !value.plans.every((plan) => isObject(plan) && tierSchema.safeParse(plan.tier).success && isObject(plan.cost) && plan.cost.currency === "CAD" && typeof plan.cost.total === "number" && Number.isFinite(plan.cost.total))) throw new RowParseError();
  const requestTitle = readStoredText(value.requestTitle);
  const recommendationReason = readStoredText(value.recommendationReason);
  if (!requestTitle || !recommendationReason) throw new RowParseError();
  const plans = value.plans.map((plan: Record<string, unknown>) => {
    const title = readStoredText(plan.title);
    if (!title || !Array.isArray(plan.pros)) throw new RowParseError();
    const pros = plan.pros.map(pro => {
      const text = readStoredText(pro);
      if (!text) throw new RowParseError();
      return text;
    });
    return { ...plan, title, pros };
  });
  return { ...value, requestTitle, recommendationReason, plans } as unknown as AnalysisResult;
}
function parseInput(value: unknown) { const parsed = analysisInputSchema.safeParse(value); if (!parsed.success) throw new RowParseError(); return parsed.data; }
function parseTime(value: unknown): string { if (!isString(value) || Number.isNaN(Date.parse(value))) throw new RowParseError(); return value; }
function asRow(value: unknown): Record<string, unknown> { if (!isObject(value)) throw new RowParseError(); return value; }

function parseAnalysisRow(value: unknown): AnalysisRecord {
  const row = asRow(value);
  if (!isString(row.id) || !nullableString(row.source_analysis_id) || !nullableString(row.completed_at)) throw new RowParseError();
  return { workspaceId: workspaceId(row), id: row.id, status: parseStatus(row.status), input: parseInput(row.input), result: parseResult(row.result), errorStage: parseErrorStage(row.error_stage), sourceAnalysisId: row.source_analysis_id, createdAt: parseTime(row.created_at), completedAt: row.completed_at === null ? null : parseTime(row.completed_at) };
}
function parseAnalysisListRow(value: unknown): AnalysisListItem {
  const row = asRow(value);
  if (!isString(row.id) || !nullableString(row.source_analysis_id)) throw new RowParseError();
  const status = parseStatus(row.status); const result = parseResult(row.result);
  const recommendedTier = result?.recommendedTier ?? null;
  const recommendedMonthly = result && recommendedTier ? result.plans.find((plan) => plan.tier === recommendedTier)?.cost.total ?? null : null;
  return { workspaceId: workspaceId(row), id: row.id, status, input: parseInput(row.input), requestTitle: result?.requestTitle ?? null, recommendedTier, recommendedMonthly, sourceAnalysisId: row.source_analysis_id, createdAt: parseTime(row.created_at) };
}
function parseArtifactRow(value: unknown): ArtifactRecord {
  const row = asRow(value);
  if (!isString(row.id) || !isString(row.analysis_id) || !nullableString(row.completed_at) || typeof row.tier !== "string" || !(artifactKinds as readonly string[]).includes(row.kind as string)) throw new RowParseError();
  return { id: row.id, analysisId: row.analysis_id, tier: parseTier(row.tier), kind: row.kind as ArtifactKind, status: parseStatus(row.status), content: row.content, createdAt: parseTime(row.created_at), completedAt: row.completed_at === null ? null : parseTime(row.completed_at) };
}


function normalizeRow(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new RowParseError();
  const row = { ...value } as Record<string, unknown>;
  for (const key of ["created_at", "completed_at"]) {
    const time = row[key];
    if (time instanceof Date) {
      if (!Number.isFinite(time.getTime())) throw new RowParseError();
      row[key] = time.toISOString();
    }
  }
  return row;
}
function workspaceId(row: Record<string, unknown>): string {
  if (typeof row.workspace_id !== "string") throw new RowParseError();
  return row.workspace_id;
}
export function parsePgAnalysisRow(value: unknown): AnalysisRecord {
  return parseAnalysisRow(normalizeRow(value));
}
export function parsePgAnalysisListRow(value: unknown): AnalysisListItem {
  return parseAnalysisListRow(normalizeRow(value));
}
export function parsePgArtifactRow(value: unknown): ArtifactRecord {
  return parseArtifactRow(normalizeRow(value));
}
export function parsePgUsage(value: unknown): LlmUsage | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const { promptTokens, completionTokens, costUsd } = value as Record<string, unknown>;
  if (typeof promptTokens !== "number" || !Number.isSafeInteger(promptTokens) || promptTokens < 0 ||
    typeof completionTokens !== "number" || !Number.isSafeInteger(completionTokens) || completionTokens < 0 ||
    !(costUsd === null || (typeof costUsd === "number" && Number.isFinite(costUsd) && costUsd >= 0))) return null;
  return { promptTokens, completionTokens, costUsd };
}
