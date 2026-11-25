// @vitest-environment node
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, expect, it } from "vitest";
import { applyMigrations } from "./migrate";

let db: PGlite;
// WASM 초기화는 전체 병렬 실행의 부하에 영향을 받으므로 판정 시간과 분리한다.
beforeAll(async () => {
  db = new PGlite();
  await db.waitReady;
}, 30_000);
afterAll(async () => { await db?.close(); });

it("applies SQL files in order once and rolls back failed files without recording them", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cloudsight-migrations-"));
  try {
    await writeFile(join(directory, "0002_second.sql"), "insert into migration_probe values (2)");
    await writeFile(join(directory, "0001_first.sql"), "create table migration_probe (n int)");
    await writeFile(join(directory, "ignored.txt"), "invalid sql");
    expect(await applyMigrations(db, directory)).toEqual(["0001_first.sql", "0002_second.sql"]);
    expect(await applyMigrations(db, directory)).toEqual([]);
    await writeFile(join(directory, "0003_failed.sql"), "insert into migration_probe values (3); select missing_column from migration_probe;");
    await expect(applyMigrations(db, directory)).rejects.toThrow();
    expect((await db.query("select * from migration_probe")).rows).toEqual([{ n: 2 }]);
    expect((await db.query("select version from schema_migrations order by version")).rows).toEqual([
      { version: "0001_first.sql" }, { version: "0002_second.sql" },
    ]);
    await writeFile(join(directory, "0003_failed.sql"), "insert into migration_probe values (3)");
    expect(await applyMigrations(db, directory)).toEqual(["0003_failed.sql"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
