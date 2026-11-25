// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DbConfigError, getDb, resolveDataDir } from "./client";

describe("resolveDataDir", () => {
  it.each([undefined, "", "   "])("rejects missing configuration: %s", (raw) => {
    expect(() => resolveDataDir(raw, "/home/test", "/app")).toThrow(DbConfigError);
  });
  it("expands home paths", () => {
    expect(resolveDataDir("~/.cloudsight/data", "/home/test", "/app")).toBe("/home/test/.cloudsight/data");
  });
  it("resolves relative paths against cwd", () => {
    expect(resolveDataDir("../data", "/home/test", "/app/project")).toBe("/app/data");
  });
  it("preserves absolute paths", () => {
    expect(resolveDataDir("/tmp/data", "/home/test", "/app")).toBe("/tmp/data");
  });
  it("treats a bare ~ as the home folder instead of a folder named ~", () => {
    expect(resolveDataDir("~", "/home/test", "/app")).toBe("/home/test");
    expect(resolveDataDir("  ~/data  ", "/home/test", "/app")).toBe("/home/test/data");
  });
});

// 파일 시스템과 PGlite를 대체해 실제 사용자 폴더를 열지 않고 연결 수명주기를 확인한다.
const mocks = vi.hoisted(() => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  migrate: vi.fn().mockResolvedValue([]),
  close: vi.fn().mockResolvedValue(undefined),
  construct: vi.fn(),
  release: vi.fn(),
  acquire: vi.fn(),
}));
vi.mock("./data-dir-lock", () => ({ acquireDataDirLock: mocks.acquire }));
vi.mock("node:fs/promises", () => ({ mkdir: mocks.mkdir }));
vi.mock("./migrate", () => ({ applyMigrations: mocks.migrate }));
vi.mock("@electric-sql/pglite", () => ({
  PGlite: class {
    waitReady = Promise.resolve();
    close = mocks.close;
    constructor(directory: string) { mocks.construct(directory); }
  },
}));

const cacheKey = Symbol.for("cloudsight.db");
const cache = globalThis as typeof globalThis & { [cacheKey]?: unknown };

describe("getDb", () => {
  beforeEach(() => {
    delete cache[cacheKey];
    vi.clearAllMocks();
    mocks.acquire.mockReturnValue(mocks.release);
    vi.stubEnv("CLOUDSIGHT_DATA_DIR", "/tmp/cloudsight-mocked");
  });
  afterEach(() => {
    delete cache[cacheKey];
    vi.unstubAllEnvs();
  });

  it("opens lazily and shares the identical promise across calls and module reloads", async () => {
    expect(mocks.construct).not.toHaveBeenCalled();
    const first = getDb();
    expect(getDb()).toBe(first);
    const db = await first;
    expect(mocks.mkdir).toHaveBeenCalledWith("/tmp/cloudsight-mocked", { recursive: true });
    expect(mocks.construct).toHaveBeenCalledTimes(1);
    expect(mocks.migrate).toHaveBeenCalledWith(db);
    vi.resetModules();
    const reloaded = await import("./client");
    expect(reloaded.getDb()).toBe(first);
    expect(mocks.construct).toHaveBeenCalledTimes(1);
  });

  it("closes after migration failure and retries with a fresh instance", async () => {
    mocks.migrate.mockRejectedValueOnce(new Error("migration failed"));
    await expect(getDb()).rejects.toThrow("migration failed");
    expect(mocks.close).toHaveBeenCalledTimes(1);
    await expect(getDb()).resolves.toBeDefined();
    expect(mocks.construct).toHaveBeenCalledTimes(2);
  });

  it("locks the data folder before opening it", async () => {
    await getDb();
    expect(mocks.acquire).toHaveBeenCalledWith("/tmp/cloudsight-mocked");
    expect(mocks.acquire.mock.invocationCallOrder[0]).toBeLessThan(mocks.construct.mock.invocationCallOrder[0]!);
  });

  it("releases the lock when opening fails, and does not open when the folder is in use", async () => {
    mocks.migrate.mockRejectedValueOnce(new Error("migration failed"));
    await expect(getDb()).rejects.toThrow("migration failed");
    expect(mocks.release).toHaveBeenCalledTimes(1);
    mocks.acquire.mockImplementationOnce(() => { throw new Error("in use"); });
    await expect(getDb()).rejects.toThrow("in use");
    expect(mocks.construct).toHaveBeenCalledTimes(1);
  });

  // 열린 뒤에는 캐시한 연결을 쓰므로, 폴더를 바꿔도 조용히 예전 폴더를 쓰지 않고 재시작을 요구한다.
  it("rejects a different data folder after the database is open", async () => {
    const db = await getDb();
    vi.stubEnv("CLOUDSIGHT_DATA_DIR", "/tmp/cloudsight-other");
    await expect(getDb()).rejects.toThrow(DbConfigError);
    await expect(getDb()).rejects.toThrow(/restart/i);
    vi.stubEnv("CLOUDSIGHT_DATA_DIR", "/tmp/cloudsight-mocked");
    await expect(getDb()).resolves.toBe(db);
    expect(mocks.construct).toHaveBeenCalledTimes(1);
  });

  it("retries after configuration or opening errors", async () => {
    vi.stubEnv("CLOUDSIGHT_DATA_DIR", "");
    await expect(getDb()).rejects.toThrow(DbConfigError);
    expect(mocks.mkdir).not.toHaveBeenCalled();
    vi.stubEnv("CLOUDSIGHT_DATA_DIR", "/tmp/cloudsight-mocked");
    mocks.mkdir.mockRejectedValueOnce(new Error("cannot open directory"));
    await expect(getDb()).rejects.toThrow("cannot open directory");
    await expect(getDb()).resolves.toBeDefined();
    expect(mocks.construct).toHaveBeenCalledTimes(1);
  });
});

describe("standalone file tracing", () => {
  it("marks every runtime data-directory path call as trace-ignored so src/services/db is not shipped", async () => {
    // CLOUDSIGHT_DATA_DIR is chosen at runtime. Without the opt-out, Turbopack traces this module's folder
    // (including tests) into .next/standalone. Migrations stay included through next.config.ts.
    const { readFile } = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    const { join } = await import("node:path");
    const source = await readFile(join(process.cwd(), "src", "services", "db", "client.ts"), "utf8");
    const code = source.split("\n").filter(line => !line.startsWith("import ")).join("\n");
    const calls = [...code.matchAll(/\b(join|resolve|mkdir|new PGlite)\((?!\/\* turbopackIgnore: true \*\/ )/g)].map(match => match[0]);
    expect(calls).toEqual([]);
  });
});
