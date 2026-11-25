import "server-only";
import type { PGlite } from "@electric-sql/pglite";
import { getDb } from "./client";
import { logStoreError } from "./store-log";
import { WorkspaceStoreError } from "./workspaces";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createCompletionOwnershipDb(deps: { db: () => Promise<PGlite> }) {
  return {
    async getCompletionOwner(source: string, id: string): Promise<string | null> {
      if (!uuidPattern.test(id)) return null;
      let sql: string;
      switch (source) {
        case "assessment-roadmap":
          sql = `select a.workspace_id from assessments a join scans s
            on s.id = a.source_scan_id and s.workspace_id = a.workspace_id
            where a.id = $1 and s.status = 'succeeded'`;
          break;
        case "extension":
          sql = `select e.workspace_id from extensions e join scans s
            on s.id = e.source_scan_id and s.workspace_id = e.workspace_id
            where e.id = $1 and s.status = 'succeeded'`;
          break;
        case "extension-artifact":
          // 요청 본문이나 현재 선택 대신 저장된 부모의 소속과 기준 스캔을 따른다.
          sql = `select e.workspace_id from extension_artifacts a join extensions e
            on e.id = a.extension_id and e.workspace_id = a.workspace_id and e.source_scan_id = a.source_scan_id
            join scans s on s.id = e.source_scan_id and s.workspace_id = e.workspace_id
            where a.id = $1 and s.status = 'succeeded'`;
          break;
        default: return null;
      }
      try {
        const { rows } = await (await deps.db()).query<{ workspace_id: unknown }>(sql, [id]);
        if (!rows.length) return null;
        const owner = rows[0].workspace_id;
        if (rows.length !== 1 || typeof owner !== "string" || !uuidPattern.test(owner)) throw new WorkspaceStoreError();
        return owner;
      } catch {
        // 이 경로는 키 선택에 쓰인다. 잘못된 행/쿼리/연결 오류의 원문도 기록하지 않는다.
        logStoreError("completion-ownership", new Error("operation failed"));
        throw new WorkspaceStoreError();
      }
    },
  };
}

export const { getCompletionOwner } = createCompletionOwnershipDb({ db: getDb });
