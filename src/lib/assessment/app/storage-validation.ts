import { readAssessmentEvidence } from "./saved-evidence";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { assessmentResultSchema, reasonCodeSchema, roadmapSchema } from "@/lib/completion/schema";
import { toCompletionSourceScan } from "@/lib/completion/source-scan";
import { evaluateAssessmentRules } from "@/lib/assessment/rules/engine";
import { advisorCatalog } from "@/lib/assessment/advisor-catalog";
import { mapAdvisorRows } from "@/lib/assessment/advisor-parse";
import { compareScans, type SavedScanSnapshot } from "@/lib/inventory/diff";
import { canonicalId } from "@/lib/inventory/normalize";
import type { AssessmentResult,AssessmentRecord } from "@/types/assessment";

export const assessmentInputSchema = z.strictObject({
  schemaVersion: z.literal(1), workspaceId: z.uuid(), sourceScanId: z.uuid(), previousScanId: z.uuid().nullable(),
});
export type {AssessmentInput,AssessmentRecord} from "@/types/assessment";
import type {AssessmentInput} from "@/types/assessment";
export type AssessmentSnapshot = SavedScanSnapshot;
export class AssessmentStorageValidationError extends Error {
  constructor() { super("assessment-storage-invalid"); this.name = "AssessmentStorageValidationError"; }
}
function invalid(): never { throw new AssessmentStorageValidationError(); }
const equal = (a: unknown, b: unknown) => { if (!isDeepStrictEqual(a, b)) invalid(); };
const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every(id => b.includes(id));

/** 같은 저장 행에서 읽은 scan/inventory를 받는다. 최신 스캔이나 cookie를 참조하지 않는다. */
export function validateAssessmentSources(input: AssessmentInput, source: AssessmentSnapshot, previous: AssessmentSnapshot | null) {
  try {
    assessmentInputSchema.parse(input);
    const header = toCompletionSourceScan(source.scan, source.inventory);
    if (header.id !== input.sourceScanId || header.workspaceId !== input.workspaceId
      || !source.inventory.resources.length || header.completeness.reasons.some(code => code === "invalid-data")) invalid();
    let baseline = null;
    if (input.previousScanId !== null) {
      if (!previous) invalid();
      baseline = toCompletionSourceScan(previous.scan, previous.inventory);
      if (baseline.id !== input.previousScanId || baseline.workspaceId !== input.workspaceId || baseline.id === header.id
        || !previous.inventory.resources.length || baseline.completeness.reasons.some(code => code === "invalid-data")
        || Date.parse(baseline.collectedAt) >= Date.parse(header.collectedAt)) invalid();
    } else if (previous !== null) invalid();
    return { sourceScan: header, previousScan: baseline };
  } catch { return invalid(); }
}

function validateAssessmentResultInternal(raw: unknown, binding: {
  id: string; input: AssessmentInput; createdAt: string; source: AssessmentSnapshot; previous: AssessmentSnapshot | null;
}, savedEvidence?: unknown): AssessmentResult {
  try {
    const result = assessmentResultSchema.parse(raw);
    const { sourceScan } = validateAssessmentSources(binding.input, binding.source, binding.previous);
    if (result.id !== binding.id || result.workspaceId !== binding.input.workspaceId
      || result.sourceScanId !== binding.input.sourceScanId || result.createdAt !== binding.createdAt
      || Date.parse(result.local.evaluatedAt) < Date.parse(binding.createdAt) || result.roadmap.state !== "not-requested") invalid();
    equal(result.sourceScan, sourceScan);
    if (savedEvidence !== undefined) {
      readAssessmentEvidence(savedEvidence, result, {source:binding.source, previous:binding.previous});
      return result;
    }
    // 결정론적 엔진과 대조해 카탈로그 버전·대상·전체 판정·관측값·coverage를 검증한다.
    equal(result.local, evaluateAssessmentRules(binding.source.inventory.resources, result.local.evaluatedAt));
    if (binding.previous === null) {
      equal(result.diff, { state: "not-requested" });
    } else {
      if (result.diff.state === "not-requested") invalid();
      if ("data" in result.diff) {
        if (Date.parse(result.diff.data.comparedAt) < Date.parse(binding.createdAt)) invalid();
        // 이전 스캔에만 있는 자원을 포함한 합집합과 가려진 전후 값을 확인한다.
        equal(result.diff.data, compareScans(binding.previous, binding.source, result.diff.data.comparedAt));
      }
    }
    const members = binding.source.inventory.resources.map(r => canonicalId(r.id));
    const advisor = result.advisor;
    const windows = [result.actualCost.monthToDate, result.actualCost.trailing30Days];
    if (advisor.state === "not-requested" || windows.some(w => w.state === "not-requested")) invalid();
    if (sourceScan.source === "import") {
      for (const component of [advisor, ...windows]) equal(component, { state: "unavailable", reason: "not-supported" });
    }
    if ("data" in advisor) {
      if (advisor.data.mappingVersion !== advisorCatalog.version || Date.parse(advisor.data.retrievedAt) < Date.parse(binding.createdAt)) invalid();
      const mapped = mapAdvisorRows(advisor.data.recommendations.map(rec => ({
        subscriptionId: rec.resourceId.split("/")[2], value: { id: rec.recommendationId,
          properties: { recommendationTypeId: rec.recommendationTypeId, resourceMetadata: { resourceId: rec.resourceId } } },
      })), members, advisor.data.retrievedAt);
      equal(advisor.data.recommendations, mapped.recommendations);
    }
    for (const window of windows) {
      if (!("data" in window)) continue;
      const data = window.data;
      if (!sameSet(data.scope.requestedSubscriptionIds, sourceScan.subscriptionIds)
        || Date.parse(data.retrievedAt) < Date.parse(binding.createdAt)) invalid();
      for (const row of data.rows) {
        const attribution = row.attribution;
        if (attribution.kind === "resource" ? !members.includes(attribution.resourceId)
          : attribution.reason === "outside-inventory" && members.includes(attribution.resourceId)) invalid();
      }
    }
    return result;
  } catch { return invalid(); }
}

// New writes cannot opt out of semantic evaluation. Evidence is used only by saved-row parsing.
export function validateAssessmentResult(raw: unknown, binding: Parameters<typeof validateAssessmentResultInternal>[1]): AssessmentResult {
  return validateAssessmentResultInternal(raw,binding);
}

const timestamp = z.union([z.iso.datetime({ offset: true }), z.date()]).transform(value => new Date(value).toISOString());
const codedError = z.strictObject({ schemaVersion: z.literal(1), code: reasonCodeSchema });
const usage = z.strictObject({ promptTokens: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  completionTokens: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), costUsd: z.number().finite().nonnegative().nullable() });
const rowSchema = z.strictObject({
  id: z.uuid(), workspace_id: z.uuid(), source_scan_id: z.uuid(), previous_scan_id: z.uuid().nullable(),
  status: z.enum(["pending", "succeeded", "failed"]), input: assessmentInputSchema,
  result: z.unknown(), error: codedError.nullable(), created_at: timestamp, completed_at: timestamp.nullable(),
  saved_evidence:z.unknown().optional().default(null),
  roadmap_status: z.enum(["not-requested", "pending", "succeeded", "failed"]), roadmap_attempt_id: z.uuid().nullable(),
  roadmap_content: z.unknown(), roadmap_error: codedError.nullable(), roadmap_usage: usage.nullable(),
  roadmap_created_at: timestamp.nullable(), roadmap_completed_at: timestamp.nullable(),
});

/** 로드맵의 권위는 별도 컬럼이다. 진행·실패·중단 상태를 완료된 AI payload로 바꾸지 않는다. */
export function parseAssessmentRow(raw: unknown, source: AssessmentSnapshot, previous: AssessmentSnapshot | null): AssessmentRecord {
  try {
    const row = rowSchema.parse(raw);
    if (row.workspace_id !== row.input.workspaceId || row.source_scan_id !== row.input.sourceScanId
      || row.previous_scan_id !== row.input.previousScanId) invalid();
    const { sourceScan } = validateAssessmentSources(row.input, source, previous);
    if (Date.parse(row.created_at) < Date.parse(sourceScan.collectedAt)) invalid();
    if (row.status === "pending" ? row.result !== null || row.error !== null || row.completed_at !== null
      : row.completed_at === null || Date.parse(row.completed_at) < Date.parse(row.created_at)
        || (row.status === "succeeded" ? row.result == null || row.error !== null : row.result !== null || row.error === null)) invalid();
    if (row.status !== "succeeded" && row.saved_evidence !== null) invalid();
    const result = row.status === "succeeded" ? validateAssessmentResultInternal(row.result, {
      id: row.id, input: row.input, createdAt: row.created_at, source, previous,
    }, row.saved_evidence ?? undefined) : null;
    if (result && row.completed_at !== null && Date.parse(row.completed_at) < Date.parse(result.local.evaluatedAt)) invalid();
    let content = null;
    if (row.roadmap_status === "not-requested") {
      if ([row.roadmap_attempt_id, row.roadmap_content, row.roadmap_error, row.roadmap_usage, row.roadmap_created_at, row.roadmap_completed_at].some(v => v !== null)) invalid();
    } else {
      if (!result || !row.roadmap_attempt_id || !row.roadmap_created_at
        || Date.parse(row.roadmap_created_at) < Date.parse(row.completed_at!)) invalid();
      if (row.roadmap_status === "pending" ? row.roadmap_content !== null || row.roadmap_error !== null || row.roadmap_completed_at !== null
        : row.roadmap_completed_at === null || Date.parse(row.roadmap_completed_at) < Date.parse(row.roadmap_created_at)
          || (row.roadmap_status === "succeeded" ? row.roadmap_content == null || row.roadmap_error !== null
            : row.roadmap_content !== null || row.roadmap_error === null)) invalid();
      if (row.roadmap_status === "succeeded") {
        content = roadmapSchema.parse(row.roadmap_content);
        if (Date.parse(content.generatedAt) < Date.parse(row.roadmap_created_at)
          || Date.parse(content.generatedAt) > Date.parse(row.roadmap_completed_at!)) invalid();
        assessmentResultSchema.parse({ ...result, roadmap: { state: "available", data: content } });
      }
    }
    return {
      id: row.id, workspaceId: row.workspace_id, sourceScanId: row.source_scan_id, previousScanId: row.previous_scan_id,
      input: row.input, status: row.status, result, error: row.error, createdAt: row.created_at, completedAt: row.completed_at,
      roadmap: { status: row.roadmap_status, attemptId: row.roadmap_attempt_id, content, error: row.roadmap_error,
        usage: row.roadmap_usage, createdAt: row.roadmap_created_at, completedAt: row.roadmap_completed_at },
    };
  } catch { return invalid(); }
}
