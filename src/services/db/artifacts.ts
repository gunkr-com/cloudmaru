import "server-only";
import type { PGlite } from "@electric-sql/pglite";
import { parsePgArtifactRow, parsePgUsage } from "@/lib/db/pg-rows";
import { addLlmUsage } from "@/lib/llm/usage";
import type { ArtifactKind } from "@/types/artifact";
import type { Tier } from "@/types/catalog";
import type { ArtifactRecord } from "@/types/db";
import type { JobStatus } from "@/types/job";
import type { LlmUsage } from "@/types/llm";
import { getDb } from "./client";
import { recordLlmCall } from "./llm-calls";
import { logStoreError } from "./store-log";
import { WorkspaceStoreError } from "./workspaces";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Reservation = { id: string; status: JobStatus; created: boolean };
export function createArtifactsDb(deps: { db: () => Promise<PGlite> }) {
  async function query<T>(sql: string, params: unknown[]): Promise<T[]> {
    try { return (await (await deps.db()).query<T>(sql, params)).rows; }
    catch (error) { logStoreError("artifacts", error); throw new WorkspaceStoreError(); }
  }
  // pending 행만 끝낸다. 되살린 행에는 앞선 실패 시도의 usage가 남아 있으므로 이번 사용량을 더한다.
  async function finish(id: string, usage: LlmUsage | null, sql: string, extra: unknown[]): Promise<void> {
    try {
      await (await deps.db()).transaction(async tx => {
        // 이번 시도의 사용량만 기록한다. 이미 종료된 행이어도 호출 비용은 남긴다.
        await recordLlmCall(tx, { source: "artifact", sourceId: id, usage });
        const row = (await tx.query<{ usage: unknown }>("select usage from artifacts where id=$1 and status='pending' for update", [id])).rows[0];
        if (!row) return;
        await tx.query(sql, [id, addLlmUsage(parsePgUsage(row.usage), usage), ...extra]);
      });
    } catch (error) { logStoreError("artifacts", error); throw new WorkspaceStoreError(); }
  }
  return {
    async reserveArtifact(args: { analysisId: string; tier: Tier; kind: ArtifactKind; staleBefore: Date }): Promise<({ ok: true } & Reservation) | { ok: false; reason: "analysis-unavailable" }> {
      if (!uuidPattern.test(args.analysisId)) return { ok: false, reason: "analysis-unavailable" };
      const rows = await query<Reservation>("select * from reserve_artifact($1, $2, $3, $4)", [args.analysisId, args.tier, args.kind, args.staleBefore]);
      return rows[0] ? { ok: true, ...rows[0] } : { ok: false, reason: "analysis-unavailable" };
    },
    async completeArtifact(id: string, content: unknown, usage: LlmUsage | null): Promise<void> {
      await finish(id, usage, "update artifacts set status='succeeded', content=$3, usage=$2, completed_at=now() where id=$1", [content]);
    },
    async failArtifact(id: string, usage?: LlmUsage | null): Promise<void> {
      await finish(id, usage ?? null, "update artifacts set status='failed', usage=$2, completed_at=now() where id=$1", []);
    },
    async listArtifacts(analysisId: string): Promise<ArtifactRecord[]> {
      if (!uuidPattern.test(analysisId)) return [];
      return (await query("select id, analysis_id, tier, kind, status, content, created_at, completed_at from artifacts where analysis_id=$1 order by created_at asc, id asc", [analysisId])).map(parsePgArtifactRow);
    },
  };
}
export const { reserveArtifact, completeArtifact, failArtifact, listArtifacts } = createArtifactsDb({ db: getDb });
