import "server-only";
import type { PGlite } from "@electric-sql/pglite";
import type { Workspace, WorkspaceInput } from "@/types/workspace";
import { DEFAULT_WORKSPACE_NAME } from "@/lib/workspace/resolve-current";
import { getDb } from "./client";
import { logStoreError } from "./store-log";

export class WorkspaceStoreError extends Error {
  constructor() {
    super("저장소 요청에 실패했습니다.");
    this.name = "WorkspaceStoreError";
  }
}

type WorkspaceRow = {
  id: string;
  name: string;
  company_name: string | null;
  default_region: string;
  currency: "CAD";
  created_at: Date | string;
  updated_at: Date | string;
};
const columns = "id, name, company_name, default_region, currency, created_at, updated_at";
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function parseRow(row: WorkspaceRow): Workspace {
  return {
    id: row.id,
    name: row.name,
    companyName: row.company_name,
    defaultRegion: row.default_region,
    currency: row.currency,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

export function createWorkspacesStore(deps: { db: () => Promise<PGlite> }) {
  async function query(sql: string, params: unknown[] = []): Promise<Workspace[]> {
    try {
      const db = await deps.db();
      const result = await db.query<WorkspaceRow>(sql, params);
      return result.rows.map(parseRow);
    } catch (error) {
      // 원본 오류나 cause에는 쿼리·연결 경로가 포함될 수 있어 화면에는 보내지 않고 서버 로그에만 남긴다.
      logStoreError("workspaces", error);
      throw new WorkspaceStoreError();
    }
  }

  async function listWorkspaces(): Promise<Workspace[]> {
    return query(`select ${columns} from workspaces order by created_at asc, id asc`);
  }

  return {
    listWorkspaces,
    async getWorkspace(id: string): Promise<Workspace | null> {
      if (!uuidPattern.test(id)) return null;
      return (await query(`select ${columns} from workspaces where id=$1`, [id]))[0] ?? null;
    },
    async createWorkspace(input: WorkspaceInput): Promise<Workspace> {
      const rows = await query(
        `insert into workspaces(name, company_name, default_region) values ($1, $2, $3) returning ${columns}`,
        [input.name, input.companyName, input.defaultRegion],
      );
      if (!rows[0]) throw new WorkspaceStoreError();
      return rows[0];
    },
    async updateWorkspace(id: string, input: WorkspaceInput): Promise<Workspace | null> {
      if (!uuidPattern.test(id)) return null;
      return (await query(
        `update workspaces set name=$2, company_name=$3, default_region=$4, updated_at=now() where id=$1 returning ${columns}`,
        [id, input.name, input.companyName, input.defaultRegion],
      ))[0] ?? null;
    },
    async ensureDefaultWorkspace(): Promise<Workspace> {
      // 한 연결의 SQL 실행은 직렬화된다. 존재 검사와 삽입을 한 문장으로 묶는다.
      await query(
        `insert into workspaces(name) select $1 where not exists (select 1 from workspaces) returning ${columns}`,
        [DEFAULT_WORKSPACE_NAME],
      );
      const first = (await listWorkspaces())[0];
      if (!first) throw new WorkspaceStoreError();
      return first;
    },
  };
}

export const { listWorkspaces, getWorkspace, createWorkspace, updateWorkspace, ensureDefaultWorkspace } =
  createWorkspacesStore({ db: getDb });
