import "server-only";
import {sealAssessmentEvidence,readAssessmentEvidence,currentAssessmentCatalogData} from "@/lib/assessment/app/saved-evidence";
import { z } from "zod";
import type { PGlite } from "@electric-sql/pglite";
import { reasonCodeSchema } from "@/lib/completion/schema";
import { parseScanInventory, parseScanRow } from "@/lib/scans/rows";
import { assessmentInputSchema, parseAssessmentRow, validateAssessmentResult, validateAssessmentSources } from "@/lib/assessment/app/storage-validation";
import type { AssessmentInput, AssessmentRecord, AssessmentSnapshot } from "@/lib/assessment/app/storage-validation";
import type { CompletionReasonCode } from "@/types/completion";
import { getDb } from "./client";
import { WorkspaceStoreError } from "./workspaces";
import { logStoreError } from "./store-log";

export type { AssessmentInput, AssessmentRecord, AssessmentSnapshot } from "@/lib/assessment/app/storage-validation";
type QueryDb = Pick<PGlite, "query">;
const uuid = z.uuid();
const columns = `saved_evidence, id, workspace_id, source_scan_id, previous_scan_id, status, input, result, error, created_at, completed_at,
  roadmap_status, roadmap_attempt_id, roadmap_content, roadmap_error, roadmap_usage, roadmap_created_at, roadmap_completed_at`;

export function createAssessmentsDb(deps: { db: () => Promise<PGlite> }) {
  async function run<T>(operation: (db: QueryDb) => Promise<T>): Promise<T> {
    try {
      // 소속·결과 검증과 저장은 같은 트랜잭션에서 수행한다. 실패하면 예약도 남기지 않는다.
      return await (await deps.db()).transaction(operation);
    } catch {
      logStoreError("assessments", new Error("operation failed"));
      throw new WorkspaceStoreError();
    }
  }
  async function source(db: QueryDb, id: string): Promise<AssessmentSnapshot | null> {
    // 행과 inventory를 한 번에 읽어 서로 다른 스냅샷을 조합하지 않는다.
    const { rows } = await db.query<{ inventory: unknown }>("select * from scans where id=$1", [id]);
    if (!rows.length) return null;
    const scan = parseScanRow(rows[0]);
    if (scan.status !== "succeeded" || rows[0].inventory == null) return null;
    return { scan, inventory: parseScanInventory(rows[0].inventory) };
  }
  async function parse(db: QueryDb, raw: unknown): Promise<AssessmentRecord> {
    const reference = z.object({ source_scan_id: uuid, previous_scan_id: uuid.nullable() }).parse(raw);
    const saved = await source(db, reference.source_scan_id);
    const previous = reference.previous_scan_id === null ? null : await source(db, reference.previous_scan_id);
    if (!saved) throw new WorkspaceStoreError();
    return parseAssessmentRow(raw, saved, previous);
  }
  async function read(db: QueryDb, id: string) {
    const { rows } = await db.query(`select ${columns} from assessments where id=$1`, [id]);
    return rows.length ? parse(db, rows[0]) : null;
  }
  return {
    async loadSnapshot(id: string): Promise<AssessmentSnapshot | null> {
      if (!uuid.safeParse(id).success) return null;
      return run(db => source(db, id));
    },
    async reserveAssessment(raw: AssessmentInput): Promise<{ id: string; status: "pending"; created: true } | null> {
      return run(async db => {
        const input = assessmentInputSchema.parse(raw);
        if (input.previousScanId === input.sourceScanId) return null;
        const saved = await source(db, input.sourceScanId);
        if (!saved || saved.scan.workspaceId !== input.workspaceId) return null;
        const previous = input.previousScanId === null ? null : await source(db, input.previousScanId);
        if (input.previousScanId !== null && (!previous || previous.scan.workspaceId !== input.workspaceId)) return null;
        validateAssessmentSources({ ...input, previousScanId: null }, saved, null);
        if (previous) {
          validateAssessmentSources({ schemaVersion: 1, workspaceId: input.workspaceId, sourceScanId: previous.scan.id, previousScanId: null }, previous, null);
          if (Date.parse(previous.scan.collectedAt!) >= Date.parse(saved.scan.collectedAt!)) return null;
        }
        validateAssessmentSources(input, saved, previous);
        const { rows } = await db.query("select * from reserve_assessment($1,$2,$3)", [input.workspaceId, input.sourceScanId, input.previousScanId]);
        if (!rows.length) return null;
        const reserved = z.strictObject({ id: uuid, status: z.literal("pending"), created: z.literal(true) }).parse(rows[0]);
        const record = await read(db, reserved.id);
        if (!record) throw new WorkspaceStoreError();
        return reserved;
      });
    },
    async completeAssessment(id: string, raw: unknown): Promise<boolean> {
      if (!uuid.safeParse(id).success) return false;
      return run(async db => {
        const row = await read(db, id);
        if (!row || row.status !== "pending") return false;
        const saved = await source(db, row.sourceScanId);
        const previous = row.previousScanId === null ? null : await source(db, row.previousScanId);
        if (!saved) throw new WorkspaceStoreError();
        const result = validateAssessmentResult(raw, { id, input: row.input, createdAt: row.createdAt, source: saved, previous });
        const { rows } = await db.query(`update assessments set status='succeeded',result=$2,saved_evidence=$3,completed_at=now()
          where id=$1 and status='pending' returning ${columns}`, [id, result, sealAssessmentEvidence(result,{source:saved,previous})]);
        if (rows.length) await parse(db, rows[0]);
        return rows.length === 1;
      });
    },
    async failAssessment(id: string, code: CompletionReasonCode): Promise<boolean> {
      if (!uuid.safeParse(id).success) return false;
      return run(async db => {
        const error = { schemaVersion: 1, code: reasonCodeSchema.parse(code) };
        // 손상/누락된 원본 때문에 실패하는 작업도 예약은 닫아야 한다.
        // 실패에는 결과 payload가 없으며 ID/pending 조건과 DB 소속 FK를 유지한다.
        const { rows } = await db.query(`update assessments set status='failed',error=$2,completed_at=now()
          where id=$1 and status='pending' returning id`, [id, error]);
        return rows.length === 1;
      });
    },
    async getAssessmentCatalogData(id:string) {
      if(!uuid.safeParse(id).success) return null;
      return run(async db => {
        const {rows}=await db.query(`select ${columns} from assessments where id=$1`,[id]);
        if(!rows.length) return null;
        const record=await parse(db,rows[0]);
        if(record.status !== "succeeded" || !record.result) return null;
        const evidence=(rows[0] as {saved_evidence:unknown}).saved_evidence;
        if(evidence == null) return currentAssessmentCatalogData();
        const saved=await source(db,record.sourceScanId);
        const previous=record.previousScanId === null ? null : await source(db,record.previousScanId);
        return readAssessmentEvidence(evidence,record.result,{source:saved,previous});
      });
    },
    async getAssessment(id: string): Promise<AssessmentRecord | null> {
      if (!uuid.safeParse(id).success) return null;
      return run(db => read(db, id));
    },
    async listAssessments(workspaceId: string, options: { sourceScanId?: string; limit?: number } = {}): Promise<AssessmentRecord[]> {
      if (!uuid.safeParse(workspaceId).success || options.sourceScanId !== undefined && !uuid.safeParse(options.sourceScanId).success) return [];
      return run(async db => {
        const limit = z.number().int().min(0).max(100).parse(options.limit ?? 20);
        const { rows } = await db.query(`select ${columns} from assessments where workspace_id=$1
          and ($2::uuid is null or source_scan_id=$2) order by created_at desc,id desc limit $3`, [workspaceId, options.sourceScanId ?? null, limit]);
        const records: AssessmentRecord[] = [];
        for (const row of rows) records.push(await parse(db, row));
        return records;
      });
    },
  };
}
export const { getAssessmentCatalogData, reserveAssessment, completeAssessment, failAssessment, getAssessment, listAssessments } = createAssessmentsDb({ db: getDb });
