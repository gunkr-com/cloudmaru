// @vitest-environment node
import type { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createTestDatabase } from "@/lib/db/test-db.test-data";
import { assessment, extension, ids, legacySnapshot } from "@/lib/completion/fixtures.test-data";
import { createCompletionOwnershipDb } from "./completion-ownership";
import { WorkspaceStoreError } from "./workspaces";
import { getCurrentWorkspace } from "@/services/current-workspace";

vi.mock("@/services/current-workspace", () => ({ getCurrentWorkspace: vi.fn(async () => ({ id: "00000000-0000-4000-8000-00000000c002" })) }));

let db: PGlite;
beforeEach(async () => {
  db = await createTestDatabase();
  await db.query("insert into workspaces(id,name) values ($1,'Synthetic'),($2,'Other current workspace')", [ids.workspace, ids.otherWorkspace]);
  await db.query("insert into scans(id,workspace_id,source,status,inventory,summary,collected_at) values ($1,$2,'import','succeeded',$3,$4,$5)",
    [ids.scan, ids.workspace, legacySnapshot.inventory, legacySnapshot.record.summary, legacySnapshot.record.collectedAt]);
});
afterEach(async () => { vi.unstubAllEnvs(); await db.close(); });

it("resolves pending and completed modes from saved successful scans regardless of current workspace", async () => {
  // 소유권 모듈은 현재 워크스페이스/쿠키/전역 키를 읽을 수 없어야 한다.
  expect((await getCurrentWorkspace()).id).toBe(ids.otherWorkspace);
  vi.mocked(getCurrentWorkspace).mockClear();
  const store = createCompletionOwnershipDb({ db: async () => db });
  const assessmentId = (await db.query<{ id: string }>("select * from reserve_assessment($1,$2,null)", [ids.workspace, ids.scan])).rows[0].id;
  const extensionId = (await db.query<{ id: string }>("select * from reserve_extension($1,$2,$3,null)", [ids.workspace, ids.scan, extension.input])).rows[0].id;
  for (const [source, id] of [["assessment-roadmap", assessmentId], ["extension", extensionId]] as const) {
    expect(await store.getCompletionOwner(source, id)).toBe(ids.workspace);
  }
  await db.query("update assessments set status='succeeded',result=$2,completed_at=now() where id=$1", [assessmentId, { ...assessment, id: assessmentId, roadmap: { state: "not-requested" } }]);
  await db.query("update extensions set status='succeeded',result=$2,completed_at=now() where id=$1", [extensionId, { ...extension, id: extensionId }]);
  const artifactId = (await db.query<{ id: string }>("select * from reserve_extension_artifact($1,'balanced','guide',now())", [extensionId])).rows[0].id;
  expect(await store.getCompletionOwner("extension-artifact", artifactId)).toBe(ids.workspace);
  expect(await store.getCompletionOwner("extension", extensionId)).toBe(ids.workspace);
  expect(await store.getCompletionOwner("assessment-roadmap", assessmentId)).toBe(ids.workspace);
  // 실패·중단 시도도 원래 회사 경계를 유지한다.
  await db.query("update extension_artifacts set status='failed',error=$2,completed_at=now() where id=$1", [artifactId, { schemaVersion: 1, code: "internal" }]);
  expect(await store.getCompletionOwner("extension-artifact", artifactId)).toBe(ids.workspace);
  await db.query("update scans set status='pending' where id=$1", [ids.scan]);
  expect(await store.getCompletionOwner("extension", extensionId)).toBeNull();
  expect(await store.getCompletionOwner("assessment-roadmap", assessmentId)).toBeNull();
  expect(await store.getCompletionOwner("extension-artifact", artifactId)).toBeNull();
  expect(getCurrentWorkspace).not.toHaveBeenCalled();
});

it("rejects invalid identifiers and unsupported sources before touching DB; missing saved records give null", async () => {
  const connection = vi.fn(async () => db);
  const store = createCompletionOwnershipDb({ db: connection });
  for (const source of ["analysis", "artifact", "network", "__proto__", "extension; select secret", "toString", ""]) {
    expect(await store.getCompletionOwner(source, ids.extension)).toBeNull();
  }
  for (const id of ["", "not-uuid", "1' or true", " 00000000-0000-4000-8000-00000000e001"]) {
    expect(await store.getCompletionOwner("extension", id)).toBeNull();
  }
  expect(connection).not.toHaveBeenCalled();
  expect(await store.getCompletionOwner("extension", ids.extension)).toBeNull();
  expect(await store.getCompletionOwner("extension-artifact", ids.extension)).toBeNull();
  expect(await store.getCompletionOwner("assessment-roadmap", ids.extension)).toBeNull();
});

it("keeps failed jobs in two workspaces tied to their own saved scans", async () => {
  await db.query("insert into scans(id,workspace_id,source,status,inventory,summary,collected_at) values ($1,$2,'import','succeeded',$3,$4,$5)",
    [ids.oldScan, ids.otherWorkspace, legacySnapshot.inventory, legacySnapshot.record.summary, legacySnapshot.record.collectedAt]);
  const store = createCompletionOwnershipDb({ db: async () => db });
  for (const [workspaceId, scanId] of [[ids.workspace, ids.scan], [ids.otherWorkspace, ids.oldScan]]) {
    const assessmentId = (await db.query<{ id: string }>("select * from reserve_assessment($1,$2,null)", [workspaceId, scanId])).rows[0].id;
    const extensionId = (await db.query<{ id: string }>("select * from reserve_extension($1,$2,$3,null)",
      [workspaceId, scanId, { ...extension.input, workspaceId, sourceScanId: scanId }])).rows[0].id;
    await db.query("update assessments set status='failed',error=$2,completed_at=now() where id=$1", [assessmentId, { schemaVersion: 1, code: "validation-failed" }]);
    await db.query("update extensions set status='failed',error=$2,completed_at=now() where id=$1", [extensionId, { schemaVersion: 1, code: "validation-failed" }]);
    expect(await store.getCompletionOwner("assessment-roadmap", assessmentId)).toBe(workspaceId);
    expect(await store.getCompletionOwner("extension", extensionId)).toBe(workspaceId);
    expect((await db.query("select * from reserve_assessment($1,$2,null)", [workspaceId === ids.workspace ? ids.otherWorkspace : ids.workspace, scanId])).rows).toEqual([]);
  }
});

it("sanitizes malformed DB owners and store errors in both thrown errors and logs", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    for (const value of ["secret-key-not-uuid", null, 123, undefined]) {
      const brokenDb = { query: vi.fn(async () => ({ rows: [{ workspace_id: value }] })) } as unknown as PGlite;
      const store = createCompletionOwnershipDb({ db: async () => brokenDb });
      await expect(store.getCompletionOwner("extension", ids.extension)).rejects.toBeInstanceOf(WorkspaceStoreError);
    }
    for (const connection of [async () => { throw new Error("private secret cause"); }, async () => ({ query: async () => { throw new Error("private secret query"); } }) as unknown as PGlite]) {
      await expect(createCompletionOwnershipDb({ db: connection }).getCompletionOwner("extension", ids.extension)).rejects.toThrow("저장소 요청에 실패했습니다.");
    }
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/private|secret/);
    expect(log).toHaveBeenCalled();
  } finally { log.mockRestore(); }
});
