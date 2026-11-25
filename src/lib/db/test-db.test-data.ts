import { PGlite } from "@electric-sql/pglite";
import { applyMigrations } from "@/services/db/migrate";

export async function createTestDatabase(): Promise<PGlite> {
  const db = new PGlite();
  try {
    await applyMigrations(db);
    return db;
  } catch (error) {
    await db.close();
    throw error;
  }
}

export async function insertTestWorkspace(db: PGlite, name = "Test workspace"): Promise<string> {
  const result = await db.query<{ id: string }>(
    "insert into workspaces(name) values ($1) returning id", [name],
  );
  return result.rows[0]!.id;
}
