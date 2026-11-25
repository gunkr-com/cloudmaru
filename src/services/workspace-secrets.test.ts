// @vitest-environment node
import { mkdtemp, mkdir, readFile, writeFile, chmod, stat, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { canonicalPath, createWorkspaceSecretStore, writeWorkspaceSecret } from "./workspace-secrets";
import { randomUUID } from "node:crypto";
import { realpath } from "node:fs/promises";
const id = "00000000-0000-0000-0000-000000000011";
const other = "00000000-0000-0000-0000-000000000012";
const roots: string[] = [];
afterEach(async () => { vi.unstubAllEnvs(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "cloudsight-secret-test-")); roots.push(root);
  const directory = join(root, "private");
  return { root, directory, store: createWorkspaceSecretStore({ directory, repoDir: join(root, "repo"), dataDir: join(root, "db") }) };
}
it("atomically stores scoped keys with private permissions and supports rotation and disabling", async () => {
  const { store, directory } = await fixture();
  expect(await store.read(id)).toBeNull();
  await store.write(id, { source: "key", apiKey: "synthetic-key-one", model: "claude-opus-5-5" });
  expect((await stat(directory)).mode & 0o777).toBe(0o700);
  expect((await stat(join(directory, `${id}.json`))).mode & 0o777).toBe(0o600);
  expect(await store.read(other)).toBeNull();
  await store.write(id, { source: "key", apiKey: "synthetic-key-two" });
  expect(await store.read(id)).toEqual({ source: "key", apiKey: "synthetic-key-two" });
  await store.write(id, { source: "disabled" });
  expect(await store.read(id)).toEqual({ source: "disabled" });
  expect(await readFile(join(directory, `${id}.json`), "utf8")).not.toContain("synthetic-key");
});
it("matches DB environment path trimming when checking the storage boundary", async () => {
  const { root } = await fixture();
  vi.stubEnv("CLOUDSIGHT_DATA_DIR", ` ${join(root,"database")} `);
  vi.stubEnv("CLOUDSIGHT_SECRETS_DIR", join(root,"database","secrets"));
  await expect(writeWorkspaceSecret(id, {source:"disabled"})).rejects.toThrow("setup.storage");
});
it("rejects corrupted secrets and directory symlinks rather than reading or falling back", async () => {
  const { store, directory, root } = await fixture();
  await store.write(id, { source: "disabled" });
  await writeFile(join(directory, `${id}.json`), '{"source":"key","apiKey":"synthetic-private","unexpected":true}');
  await expect(store.read(id)).rejects.toThrow("setup.storage");
  const linked = join(root, "linked"); await symlink(directory, linked);
  await expect(createWorkspaceSecretStore({ directory: linked, repoDir: join(root,"repo") }).read(id)).rejects.toThrow("setup.storage");
});
it("rejects traversal, symlinks, public permissions and invalid content without leaking values", async () => {
  const { store, root, directory } = await fixture();
  await expect(store.write("../escape", { source: "disabled" })).rejects.toThrow("setup.storage");
  await store.write(id, { source: "key", apiKey: "synthetic-private" });
  await chmod(join(directory, `${id}.json`), 0o644);
  await expect(store.read(id)).rejects.toThrow("setup.storage");
  await symlink(join(directory, `${id}.json`), join(directory, `${other}.json`));
  await expect(store.read(other)).rejects.toThrow("setup.storage");
  await chmod(directory, 0o755);
  await expect(store.write(id, { source: "disabled" })).rejects.toThrow("setup.storage");
  await mkdir(join(root, "repo"));
  const unsafe = createWorkspaceSecretStore({ directory: join(root, "repo", "keys"), repoDir: join(root, "repo") });
  await expect(unsafe.write(id, { source: "disabled" })).rejects.toThrow("setup.storage");
  const hiddenUnsafe = createWorkspaceSecretStore({ directory: join(root, "repo", "..private"), repoDir: join(root, "repo") });
  await expect(hiddenUnsafe.write(id, { source: "disabled" })).rejects.toThrow("setup.storage");
  const dbUnsafe = createWorkspaceSecretStore({ directory: join(root, "db", "keys"), dataDir: join(root, "db"), repoDir: join(root, "repo") });
  await expect(dbUnsafe.write(id, { source: "disabled" })).rejects.toThrow("setup.storage");
});
it("keeps the full name of a missing directory directly under the filesystem root", async () => {
  const name = `cloudsight-missing-${randomUUID()}`;
  expect(await canonicalPath(`/${name}`)).toBe(`/${name}`);
  expect(await canonicalPath(`/${name}/secrets`)).toBe(`/${name}/secrets`);
  expect(await canonicalPath("/s")).toBe(`/s`);
  const { root } = await fixture();
  expect(await canonicalPath(join(root, "missing", "secrets"))).toBe(join(await realpath(root), "missing", "secrets"));
});
it("marks every runtime-chosen filesystem path as trace-ignored so the standalone build does not ship the whole project", async () => {
  // Turbopack traces fs/path calls it cannot scope statically and then copies the whole project (src, tests) into
  // .next/standalone. The secret directory is chosen at runtime, so each such call opts out explicitly.
  const source = await readFile(join(process.cwd(), "src", "services", "workspace-secrets.ts"), "utf8");
  const code = source.split("\n").filter(line => !line.startsWith("import ")).join("\n");
  const calls = [...code.matchAll(/\b(join|open|realpath|lstat|mkdir|rename|unlink|resolve)\((?!\/\* turbopackIgnore: true \*\/ )/g)].map(match => match[0]);
  expect(calls).toEqual([]);
  expect(code.match(/\/\* turbopackIgnore: true \*\//g)?.length).toBeGreaterThanOrEqual(12);
});
