import "server-only";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { PGlite } from "@electric-sql/pglite";

export async function applyMigrations(
  db: PGlite,
  directory = join(process.cwd(), "db/migrations"),
): Promise<string[]> {
  await db.exec(`create table if not exists schema_migrations (
    version text primary key,
    applied_at timestamptz not null default now()
  )`);
  // 런타임 경로는 추적하지 않고 next.config.ts에서 SQL 파일만 명시한다.
  const files = (await readdir(/* turbopackIgnore: true */ directory)).filter(file => file.endsWith(".sql")).sort();
  const applied: string[] = [];
  for (const file of files) {
    const changed = await db.transaction(async tx => {
      const existing = await tx.query("select version from schema_migrations where version=$1", [file]);
      if (existing.rows.length) return false;
      await tx.exec(await readFile(/* turbopackIgnore: true */ join(/* turbopackIgnore: true */ directory, file), "utf8"));
      await tx.query("insert into schema_migrations(version) values ($1)", [file]);
      return true;
    });
    if (changed) applied.push(file);
  }
  return applied;
}
