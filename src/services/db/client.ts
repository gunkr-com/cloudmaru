import "server-only";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { acquireDataDirLock } from "./data-dir-lock";
import { applyMigrations } from "./migrate";

export class DbConfigError extends Error {}

// CLOUDSIGHT_DATA_DIR is a runtime path. turbopackIgnore keeps Turbopack from tracing this folder into the standalone build.
export function resolveDataDir(raw: string | undefined, homeDir: string, cwd: string): string {
  const value = raw?.trim();
  if (!value) throw new DbConfigError("CLOUDSIGHT_DATA_DIR must be configured.");
  if (value === "~") return homeDir;
  return value.startsWith("~/") ? join(/* turbopackIgnore: true */ homeDir, value.slice(2)) : resolve(/* turbopackIgnore: true */ cwd, value);
}

const dbKey = Symbol.for("cloudsight.db");
type SharedDb = { directory: string; db: Promise<PGlite> };
const shared = globalThis as typeof globalThis & { [dbKey]?: SharedDb };

export function getDb(): Promise<PGlite> {
  let directory: string;
  try {
    directory = resolveDataDir(process.env.CLOUDSIGHT_DATA_DIR, homedir(), process.cwd());
  } catch (error) {
    return Promise.reject(error);
  }
  const current = shared[dbKey];
  if (current) {
    // 개발 서버는 .env.local을 다시 읽지만 열린 연결은 그대로다. 조용히 예전 폴더를 쓰지 않게 막는다.
    if (current.directory !== directory) {
      return Promise.reject(new DbConfigError(`CLOUDSIGHT_DATA_DIR changed after the database was opened at ${current.directory}. Restart the server to use ${directory}.`));
    }
    return current.db;
  }
  const entry: SharedDb = {
    directory,
    db: openDatabase(directory).catch(error => {
      if (shared[dbKey] === entry) delete shared[dbKey];
      throw error;
    }),
  };
  shared[dbKey] = entry;
  return entry.db;
}

async function openDatabase(directory: string): Promise<PGlite> {
  await mkdir(/* turbopackIgnore: true */ directory, { recursive: true });
  const release = acquireDataDirLock(directory);
  const db = new PGlite(/* turbopackIgnore: true */ directory);
  try {
    await db.waitReady;
    await applyMigrations(db);
    process.once("exit", release);
    return db;
  } catch (error) {
    // 닫기를 마친 뒤 캐시를 지워야 재시도가 같은 폴더를 중복해서 열지 않는다.
    await db.close().catch(() => {});
    release();
    throw error;
  }
}
