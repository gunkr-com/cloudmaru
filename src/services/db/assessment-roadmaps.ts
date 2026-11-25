import "server-only";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import type { PGlite, Transaction } from "@electric-sql/pglite";
import { parseAssessmentRow, type AssessmentSnapshot } from "@/lib/assessment/app/storage-validation";
import { readAssessmentEvidence } from "@/lib/assessment/app/saved-evidence";
import { validateStoredRoadmap } from "@/lib/assessment/roadmap/storage-validation";
import { validateRoadmapForWrite, ROADMAP_WRITE_POLICY_VERSION } from "@/lib/assessment/roadmap/write-validation";
import { sealAttemptEvidence, verifyAttemptEvidence } from "@/lib/completion/attempt-evidence";
import { reasonCodeSchema } from "@/lib/completion/schema";
import { parseScanInventory, parseScanRow } from "@/lib/scans/rows";
import type { AssessmentRecord, AssessmentCatalogData } from "@/types/assessment";
import type { CompletionReasonCode } from "@/types/completion";
import type { LlmUsage } from "@/types/llm";
import { getDb } from "./client";
import { WorkspaceStoreError } from "./workspaces";
import { logStoreError } from "./store-log";

export type AssessmentRoadmapReservation = {
  id: string; status: "pending" | "succeeded"; created: boolean; attemptId: string;
};
/** 검증된 Assess DTO와 별도 로드맵 상태만 반환한다. private 증거·카탈로그·인벤토리는 제외한다. */
export type AssessmentRoadmapRecord = AssessmentRecord;
const uuid = z.uuid();
const usageSchema = z.strictObject({
  promptTokens: z.number().int().min(0).max(2_147_483_647),
  completionTokens: z.number().int().min(0).max(2_147_483_647),
  costUsd: z.number().finite().nonnegative().nullable(),
});
const reservationSchema = z.strictObject({ id: uuid, status: z.enum(["pending", "succeeded"]), created: z.boolean(), attempt_id: uuid });
const binding = (rowId: string, attemptId: string) => ({ source: "assessment-roadmap" as const, rowId, attemptId, kind: "roadmap" as const });

export function createAssessmentRoadmapsDb(deps: { db: () => Promise<PGlite> }) {
  async function run<T>(operation: (db: Transaction) => Promise<T>): Promise<T> {
    try { return await (await deps.db()).transaction(operation); }
    catch {
      logStoreError("assessment-roadmaps", new Error("operation failed"));
      throw new WorkspaceStoreError();
    }
  }
  async function snapshot(db: Transaction, id: string): Promise<AssessmentSnapshot | null> {
    const { rows } = await db.query<{ inventory: unknown }>("select * from scans where id=$1", [id]);
    if (!rows.length) return null;
    const scan = parseScanRow(rows[0]);
    return scan.status === "succeeded" && rows[0].inventory != null
      ? { scan, inventory: parseScanInventory(rows[0].inventory) } : null;
  }
  async function load(db: Transaction, id: string, lock = false): Promise<{
    parent: AssessmentRecord; catalogData: AssessmentCatalogData | null;
  } | null> {
    const { rows } = await db.query("select * from assessments where id=$1" + (lock ? " for update" : ""), [id]);
    if (!rows.length) return null;
    const refs = z.object({ source_scan_id: uuid, previous_scan_id: uuid.nullable(), saved_evidence: z.unknown() }).parse(rows[0]);
    // 로드맵은 근거가 고정된 성공 부모만 사용한다. phase16의 legacy 재평가에 진입하지 않는다.
    if ((rows[0] as {status: unknown}).status === "succeeded" && refs.saved_evidence == null) throw new WorkspaceStoreError();
    const source = await snapshot(db, refs.source_scan_id);
    const previous = refs.previous_scan_id === null ? null : await snapshot(db, refs.previous_scan_id);
    if (!source) throw new WorkspaceStoreError();
    if ((rows[0] as {status: unknown}).status === "succeeded")
      readAssessmentEvidence(refs.saved_evidence, (rows[0] as {result: unknown}).result, { source, previous });
    // phase16의 저장 소속·원본·불변 근거 검증을 그대로 사용한다.
    const parent = parseAssessmentRow(rows[0], source, previous);
    const catalogData = parent.result === null ? null : readAssessmentEvidence(refs.saved_evidence, parent.result, { source, previous });
    if (parent.roadmap.status === "succeeded") {
      if (!parent.result || !catalogData || !parent.roadmap.content || !parent.roadmap.attemptId
        || !parent.roadmap.createdAt || !parent.roadmap.completedAt) throw new WorkspaceStoreError();
      validateStoredRoadmap(parent.roadmap.content, { assessment: parent.result, catalogData,
        createdAt: parent.roadmap.createdAt, completedAt: parent.roadmap.completedAt });
      const proofs = await db.query<{ evidence: unknown }>(
        "select evidence from assessment_roadmap_evidence where assessment_id=$1 and attempt_id=$2", [id, parent.roadmap.attemptId]);
      if (proofs.rows.length !== 1) throw new WorkspaceStoreError();
      verifyAttemptEvidence(proofs.rows[0].evidence, binding(id, parent.roadmap.attemptId), parent.roadmap.content,
        { assessment: parent.result, catalogData });
    }
    return { parent, catalogData };
  }
  /** 신뢰한 서버 작업의 콜백 전용이다. 검증·종료 SQL 실패나 오래된 시도의 0-write와 별도로 커밋한다.
   * attemptId는 예약 UUID이며 Claude 키의 source ID가 아니다. 클라이언트 사용량 API는 두지 않는다.
   */
  async function bill(id: string, attemptId: string, raw: LlmUsage | null): Promise<boolean> {
    return run(async db => {
      const saved = await load(db, id, true);
      if (!saved || saved.parent.status !== "succeeded" || saved.parent.result === null
        || saved.parent.roadmap.status === "not-requested") return false;
      const ledger = await db.query<{ usage: unknown }>(
        "select usage from assessment_roadmap_attempts where assessment_id=$1 and attempt_id=$2 for update", [id, attemptId]);
      if (ledger.rows.length !== 1) return false;
      const known = ledger.rows[0].usage === null ? null : usageSchema.parse(ledger.rows[0].usage);
      const usage = raw === null ? null : usageSchema.parse(raw);
      const calls = await db.query<{ prompt_tokens: number; completion_tokens: number; cost_usd: number | null }>(
        "select prompt_tokens,completion_tokens,cost_usd from llm_calls where source='assessment-roadmap' and source_id=$1", [attemptId]);
      if (known !== null) {
        const call = calls.rows[0];
        if (calls.rows.length !== 1 || !isDeepStrictEqual(known, {
          promptTokens: call.prompt_tokens, completionTokens: call.completion_tokens, costUsd: call.cost_usd,
        }) || usage !== null && !isDeepStrictEqual(known, usage)) throw new WorkspaceStoreError();
        return true;
      }
      // 원장에 귀속되지 않은 과거 청구는 누적 사용량으로 역추정하지 않는다.
      if (calls.rows.length !== 0) throw new WorkspaceStoreError();
      if (usage === null) return true; // 미확인 사용량을 0이나 확정 청구로 만들지 않는다.
      const old = saved.parent.roadmap.usage;
      const combined: LlmUsage = old === null ? usage : {
        promptTokens: old.promptTokens + usage.promptTokens, completionTokens: old.completionTokens + usage.completionTokens,
        costUsd: old.costUsd === null || usage.costUsd === null ? null : old.costUsd + usage.costUsd,
      };
      if (!Number.isSafeInteger(combined.promptTokens) || !Number.isSafeInteger(combined.completionTokens)
        || combined.costUsd !== null && !Number.isFinite(combined.costUsd)) throw new WorkspaceStoreError();
      // 부모 → 원장 순서로 잠그고 세 청구 쓰기를 같은 트랜잭션에서 확정한다.
      await db.query("update assessment_roadmap_attempts set usage=$3 where assessment_id=$1 and attempt_id=$2 and usage is null", [id, attemptId, usage]);
      await db.query(`insert into llm_calls(source,source_id,prompt_tokens,completion_tokens,cost_usd)
        values ('assessment-roadmap',$1,$2,$3,$4)`, [attemptId, usage.promptTokens, usage.completionTokens, usage.costUsd]);
      await db.query("update assessments set roadmap_usage=$2 where id=$1", [id, combined]);
      return true;
    });
  }
  return {
    async reserveAssessmentRoadmap(id: string, staleBefore: Date): Promise<AssessmentRoadmapReservation | null> {
      if (!uuid.safeParse(id).success) return null;
      return run(async db => {
        z.date().parse(staleBefore);
        const saved = await load(db, id, true);
        if (!saved || saved.parent.status !== "succeeded" || !saved.parent.result) return null;
        const { rows } = await db.query("select * from reserve_assessment_roadmap($1,$2)", [id, staleBefore]);
        if (!rows.length) return null;
        const row = reservationSchema.parse(rows[0]);
        await load(db, id);
        return { id: row.id, status: row.status, created: row.created, attemptId: row.attempt_id };
      });
    },
    async completeAssessmentRoadmap(id: string, attemptId: string, raw: unknown, usage: LlmUsage | null): Promise<boolean> {
      if (!uuid.safeParse(id).success || !uuid.safeParse(attemptId).success) return false;
      if (!await bill(id, attemptId, usage)) return false;
      return run(async db => {
        const saved = await load(db, id, true);
        if (!saved || saved.parent.roadmap.status !== "pending" || saved.parent.roadmap.attemptId !== attemptId) return false;
        const { parent, catalogData } = saved;
        if (!parent.result || !catalogData || !parent.roadmap.createdAt) throw new WorkspaceStoreError();
        const { rows: clock } = await db.query<{ completed_at: Date }>("select clock_timestamp() as completed_at");
        const completedAt = clock[0].completed_at.toISOString();
        const content = validateRoadmapForWrite(raw, { assessment: parent.result, catalogData, createdAt: parent.roadmap.createdAt, completedAt });
        const proof = sealAttemptEvidence(binding(id, attemptId), content, { assessment: parent.result, catalogData },
          { policyVersion: ROADMAP_WRITE_POLICY_VERSION });
        const { rows } = await db.query(`update assessments set roadmap_status='succeeded',roadmap_content=$3,
          roadmap_error=null,roadmap_completed_at=$4 where id=$1 and roadmap_attempt_id=$2 and roadmap_status='pending' returning id`,
        [id, attemptId, content, completedAt]);
        if (!rows.length) return false;
        await db.query("insert into assessment_roadmap_evidence(assessment_id,attempt_id,evidence) values ($1,$2,$3)", [id, attemptId, proof]);
        await load(db, id);
        return true;
      });
    },
    async failAssessmentRoadmap(id: string, attemptId: string, code: CompletionReasonCode, usage: LlmUsage | null): Promise<boolean> {
      if (!uuid.safeParse(id).success || !uuid.safeParse(attemptId).success) return false;
      if (!await bill(id, attemptId, usage)) return false;
      return run(async db => {
        const error = { schemaVersion: 1, code: reasonCodeSchema.parse(code) };
        const { rows } = await db.query(`update assessments set roadmap_status='failed',roadmap_content=null,roadmap_error=$3,
          roadmap_completed_at=clock_timestamp() where id=$1 and roadmap_attempt_id=$2 and roadmap_status='pending' returning id`, [id, attemptId, error]);
        return rows.length === 1;
      });
    },
    async getAssessmentRoadmapCatalogData(id: string): Promise<AssessmentCatalogData | null> {
      if (!uuid.safeParse(id).success) return null;
      return run(async db => (await load(db, id))?.catalogData ?? null);
    },
    async getAssessmentRoadmap(id: string): Promise<AssessmentRoadmapRecord | null> {
      if (!uuid.safeParse(id).success) return null;
      return run(async db => (await load(db, id))?.parent ?? null);
    },
  };
}
export const { reserveAssessmentRoadmap, completeAssessmentRoadmap, failAssessmentRoadmap, getAssessmentRoadmap, getAssessmentRoadmapCatalogData }
  = createAssessmentRoadmapsDb({ db: getDb });
