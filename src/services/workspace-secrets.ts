import "server-only";
import { constants } from "node:fs";
import { mkdir, lstat, open, rename, unlink, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, isAbsolute, join, relative, resolve, dirname, parse, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { workspaceIdSchema, workspaceSecretSchema, type WorkspaceSecret } from "@/lib/workspace/setup-schema";

export class SecretStorageError extends Error {
  constructor() { super("setup.storage"); this.name = "SecretStorageError"; }
}
function contains(parent: string, child: string) {
  const path = relative(parent, child);
  return path === "" || (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}
// Paths here are chosen at runtime; turbopackIgnore keeps Turbopack from tracing the whole project into the standalone build.
// Resolves the nearest existing ancestor and appends the missing tail, e.g. "/secrets" stays "/secrets".
export async function canonicalPath(path: string): Promise<string> {
  try { return await realpath(/* turbopackIgnore: true */ path); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    if (dirname(path) === path) throw error;
    return join(/* turbopackIgnore: true */ await canonicalPath(dirname(path)), basename(path));
  }
}
function privateOwned(info: Awaited<ReturnType<typeof lstat>>) {
  if (info.isSymbolicLink() || (Number(info.mode) & 0o077) || (process.getuid && Number(info.uid) !== process.getuid())) throw new SecretStorageError();
}
export function createWorkspaceSecretStore(options: { directory: string; repoDir?: string; dataDir?: string }) {
  async function directory(create: boolean) {
    if (!isAbsolute(options.directory) || options.directory === parse(options.directory).root) throw new SecretStorageError();
    const resolved = await canonicalPath(options.directory);
    for (const boundary of [options.repoDir ?? process.cwd(), options.dataDir].filter((v): v is string => Boolean(v))) {
      const target = await canonicalPath(resolve(/* turbopackIgnore: true */ boundary));
      if (contains(target, resolved) || contains(resolved, target)) throw new SecretStorageError();
    }
    // Reject a symlink at the private directory itself, even when it resolves outside the repo.
    if (create) await mkdir(/* turbopackIgnore: true */ options.directory, { recursive: true, mode: 0o700 });
    try {
      const info = await lstat(/* turbopackIgnore: true */ options.directory);
      privateOwned(info);
      if (!info.isDirectory()) throw new SecretStorageError();
    } catch (error) {
      if (!create && (error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
    return resolved;
  }
  return {
    async read(workspaceId: string): Promise<WorkspaceSecret | null> {
      try {
        const id = workspaceIdSchema.parse(workspaceId).toLowerCase();
        const root = await directory(false);
        if (!root) return null;
        let file;
        try { file = await open(/* turbopackIgnore: true */ join(/* turbopackIgnore: true */ root, `${id}.json`), constants.O_RDONLY | constants.O_NOFOLLOW); }
        catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
        try {
          const info = await file.stat(); privateOwned(info);
          if (!info.isFile() || info.nlink !== 1 || info.size > 8192) throw new SecretStorageError();
          return workspaceSecretSchema.parse(JSON.parse(await file.readFile("utf8")));
        } finally { await file.close(); }
      } catch { throw new SecretStorageError(); }
    },
    async write(workspaceId: string, input: WorkspaceSecret): Promise<void> {
      let temporary: string | undefined;
      try {
        const id = workspaceIdSchema.parse(workspaceId).toLowerCase();
        const value = workspaceSecretSchema.parse(input);
        const root = (await directory(true))!;
        temporary = join(/* turbopackIgnore: true */ root, `.${id}-${randomUUID()}.tmp`);
        const file = await open(/* turbopackIgnore: true */ temporary, "wx", 0o600);
        try { await file.writeFile(JSON.stringify(value)); await file.sync(); }
        finally { await file.close(); }
        await rename(/* turbopackIgnore: true */ temporary, join(/* turbopackIgnore: true */ root, `${id}.json`));
      } catch { throw new SecretStorageError(); }
      finally { if (temporary) await unlink(/* turbopackIgnore: true */ temporary).catch(() => {}); }
    },
  };
}
function store() {
  const rawData = process.env.CLOUDSIGHT_DATA_DIR?.trim();
  const dataDir = rawData === "~" ? homedir() : rawData?.startsWith("~/") ? join(/* turbopackIgnore: true */ homedir(), rawData.slice(2)) : rawData;
  return createWorkspaceSecretStore({ directory: process.env.CLOUDSIGHT_SECRETS_DIR?.trim() || join(/* turbopackIgnore: true */ homedir(), ".cloudsight", "secrets"), dataDir });
}
export const readWorkspaceSecret = (id: string) => store().read(id);
export const writeWorkspaceSecret = (id: string, value: WorkspaceSecret) => store().write(id, value);
