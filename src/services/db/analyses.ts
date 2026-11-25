import "server-only";
import type { PGlite } from "@electric-sql/pglite";
import { parsePgAnalysisRow, parsePgAnalysisListRow } from "@/lib/db/pg-rows";
import type { AnalysisInput, AnalysisResult } from "@/types/analysis";
import type { AnalysisRecord, AnalysisListItem, AnalysisErrorStage } from "@/types/db";
import type { LlmUsage } from "@/types/llm";
import { getDb } from "./client";
import { createLlmCallsDb, recordLlmCall } from "./llm-calls";
import { logStoreError } from "./store-log";
import { WorkspaceStoreError } from "./workspaces";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function createAnalysesDb(deps: { db: () => Promise<PGlite> }) {
  async function query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    try { return (await (await deps.db()).query<T>(sql, params)).rows; }
    catch (error) { logStoreError("analyses", error); throw new WorkspaceStoreError(); }
  }
  async function finish(id: string, usage: LlmUsage | null, sql: string, params: unknown[]): Promise<void> {
    try {
      await (await deps.db()).transaction(async tx => {
        // 이미 종료된 행이라도 늦게 끝난 호출 비용은 남긴다.
        await recordLlmCall(tx, { source: "analysis", sourceId: id, usage });
        await tx.query(sql, params);
      });
    } catch (error) { logStoreError("analyses", error); throw new WorkspaceStoreError(); }
  }
  return {
    async createAnalysis(args: { workspaceId: string; input: AnalysisInput; sourceAnalysisId: string | null }): Promise<string> {
      const source = args.sourceAnalysisId && uuidPattern.test(args.sourceAnalysisId) ? args.sourceAnalysisId : null;
      // 다시 분석은 원 분석의 워크스페이스에 둔다. ID로 연 분석은 그 행의 워크스페이스를 따르기 때문이다.
      const rows = await query<{ id: string }>(
        `with source as (select id, workspace_id from analyses where id=$3)
         insert into analyses(workspace_id, input, source_analysis_id)
         select coalesce((select workspace_id from source), $1), $2, (select id from source) returning id`,
        [args.workspaceId, args.input, source],
      );
      if (!rows[0]) throw new WorkspaceStoreError();
      return rows[0].id;
    },
    async completeAnalysis(id: string, result: AnalysisResult, usage: LlmUsage | null): Promise<void> {
      await finish(id, usage, "update analyses set status='succeeded', result=$2, usage=$3, completed_at=now() where id=$1 and status='pending'", [id, result, usage]);
    },
    async failAnalysis(id: string, stage: AnalysisErrorStage, usage?: LlmUsage | null): Promise<void> {
      await finish(id, usage ?? null, "update analyses set status='failed', error_stage=$2, usage=$3, completed_at=now() where id=$1 and status='pending'", [id, stage, usage ?? null]);
    },
    async getAnalysis(id: string): Promise<AnalysisRecord | null> {
      if (!uuidPattern.test(id)) return null;
      const rows = await query("select * from analyses where id=$1", [id]);
      return rows.length ? parsePgAnalysisRow(rows[0]) : null;
    },
    async listAnalyses(workspaceId: string, options?: { limit?: number }): Promise<AnalysisListItem[]> {
      const rows = await query("select id, workspace_id, status, input, result, source_analysis_id, created_at from analyses where workspace_id=$1 order by created_at desc, id desc limit $2", [workspaceId, options?.limit ?? 50]);
      return rows.map(parsePgAnalysisListRow);
    },
    listLlmUsageSince: createLlmCallsDb(deps).listLlmUsageSince,
  };
}
export const { createAnalysis, completeAnalysis, failAnalysis, getAnalysis, listAnalyses } = createAnalysesDb({ db: getDb });

export { listLlmUsageSince } from "./llm-calls";
