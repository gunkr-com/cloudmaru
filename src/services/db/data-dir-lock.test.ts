// @vitest-environment node
import { mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, unlinkSync, writeFileSync, existsSync } from "node:fs";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { acquireDataDirLock, DataDirInUseError } from "./data-dir-lock";

vi.mock("node:fs", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, renameSync: vi.fn(actual.renameSync), linkSync: vi.fn(actual.linkSync) };
});
const actualFs = await vi.importActual<typeof import("node:fs")>("node:fs");

let directory: string;
const lockPath = () => join(directory, ".cloudsight.lock");
beforeEach(() => {
  vi.mocked(fs.renameSync).mockReset().mockImplementation(actualFs.renameSync);
  vi.mocked(fs.linkSync).mockReset().mockImplementation(actualFs.linkSync);
  directory = mkdtempSync(join(tmpdir(), "cloudsight-lock-"));
});
afterEach(() => {
  vi.restoreAllMocks();
  try {
    expect(readdirSync(directory).filter(name => name.startsWith(".cloudsight.lock.stale-")
      || name.startsWith(".cloudsight.lock.new-"))).toEqual([]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("acquireDataDirLock", () => {
  it("preserves a new owner's lock installed after stale detection", () => {
    writeFileSync(lockPath(), "1111");
    expect(() => acquireDataDirLock(directory, 2222, pid => pid === 3333, {
      onStaleDetected: () => {
        // 이전 inode를 보존해 파일 시스템의 inode 재사용과 무관하게 교체한다.
        renameSync(lockPath(), join(directory, "old-lock"));
        writeFileSync(lockPath(), "3333", { flag: "wx" });
      },
    })).toThrow(DataDirInUseError);
    expect(readFileSync(lockPath(), "utf8")).toBe("3333");
  });

  it("retries when another process removes the stale lock first", () => {
    writeFileSync(lockPath(), "1111");
    const release = acquireDataDirLock(directory, 2222, () => false, {
      onStaleDetected: () => unlinkSync(lockPath()),
    });
    expect(readFileSync(lockPath(), "utf8")).toBe("2222");
    release();
  });

  it("preserves the current lock if restoration encounters another owner", () => {
    writeFileSync(lockPath(), "1111");
    const rename = actualFs.renameSync;
    vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
      rename(from, to);
      if (String(to).includes(".stale-")) {
        writeFileSync(lockPath(), "4444", { flag: "wx" });
      }
    });
    expect(() => acquireDataDirLock(directory, 2222, () => false, {
      onStaleDetected: () => {
        renameSync(lockPath(), join(directory, "old-lock"));
        writeFileSync(lockPath(), "3333", { flag: "wx" });
      },
    })).toThrow(DataDirInUseError);
    expect(readFileSync(lockPath(), "utf8")).toBe("4444");
  });

  it("limits attempts when stale locks keep appearing", () => {
    writeFileSync(lockPath(), "1111");
    const rename = actualFs.renameSync;
    const move = vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
      rename(from, to);
      writeFileSync(lockPath(), "1111", { flag: "wx" });
    });
    expect(() => acquireDataDirLock(directory, 2222, () => false)).toThrow(DataDirInUseError);
    expect(move).toHaveBeenCalledTimes(2);
    expect(readFileSync(lockPath(), "utf8")).toBe("1111");
  });

  it("never exposes an empty lock file while creating it", () => {
    // 잠금 경로는 pid가 다 쓰인 임시 파일을 link로 건 것이다. 경로에 빈 파일이 나타나지 않는다.
    const created: string[] = [];
    vi.mocked(fs.linkSync).mockImplementation((from, to) => {
      created.push(readFileSync(from, "utf8"));
      actualFs.linkSync(from, to);
    });
    acquireDataDirLock(directory, 1111, () => true);
    expect(created).toEqual(["1111"]);
  });

  it("writes the owner pid and removes the lock on release", () => {
    const release = acquireDataDirLock(directory, 1111, () => true);
    expect(readFileSync(lockPath(), "utf8")).toBe("1111");
    release();
    expect(existsSync(lockPath())).toBe(false);
  });

  it("refuses a folder that another live process holds", () => {
    acquireDataDirLock(directory, 1111, () => true);
    expect(() => acquireDataDirLock(directory, 2222, pid => pid === 1111)).toThrow(DataDirInUseError);
    expect(() => acquireDataDirLock(directory, 2222, pid => pid === 1111)).toThrow(/1111/);
    expect(readFileSync(lockPath(), "utf8")).toBe("1111");
  });

  it.each([["dead owner", "1111"], ["unreadable content", "not-a-pid"], ["same process", "2222"]])("takes over a stale lock: %s", (_name, content) => {
    writeFileSync(lockPath(), content);
    const release = acquireDataDirLock(directory, 2222, () => false);
    expect(readFileSync(lockPath(), "utf8")).toBe("2222");
    release();
    expect(existsSync(lockPath())).toBe(false);
  });

  it("does not remove a lock that another process took over", () => {
    const release = acquireDataDirLock(directory, 1111, () => true);
    writeFileSync(lockPath(), "3333");
    release();
    expect(readFileSync(lockPath(), "utf8")).toBe("3333");
  });
});
