import "server-only";
import { closeSync, fstatSync, linkSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

// PGlite는 데이터 폴더를 잠그지 않는다. 같은 폴더를 두 프로세스(메인 서버와 worktree 서버 등)가
// 열면 손상될 수 있으므로 pid 잠금 파일로 막는다.
const LOCK_FILE = ".cloudsight.lock";

export class DataDirInUseError extends Error {
  constructor(directory: string, ownerPid: number) {
    super(`CLOUDSIGHT_DATA_DIR ${directory} is in use by another CloudSight process (pid ${ownerPid}). `
      + `Stop that server or use a different data folder. If no other server is running, delete ${join(directory, LOCK_FILE)}.`);
    this.name = "DataDirInUseError";
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM은 프로세스가 있지만 신호를 보낼 권한이 없다는 뜻이다.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function readOwner(path: string): number | null {
  try {
    const owner = Number(readFileSync(path, "utf8").trim());
    return Number.isSafeInteger(owner) && owner > 0 ? owner : null;
  } catch {
    return null;
  }
}

// 잠금을 얻고 해제 함수를 돌려준다. 살아 있는 다른 프로세스의 잠금이면 DataDirInUseError.
// 죽은 프로세스, 읽을 수 없는 내용, 같은 프로세스의 잠금은 남은 잠금으로 보고 넘겨받는다.
export function acquireDataDirLock(
  directory: string,
  pid: number = process.pid,
  alive: (pid: number) => boolean = isProcessAlive,
  hooks?: { onStaleDetected?: () => void },
): () => void {
  const path = join(directory, LOCK_FILE);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    // pid를 다 쓴 임시 파일을 link로 건다. wx로 바로 만들면 파일 생성과 pid 쓰기 사이에
    // 다른 프로세스가 빈 잠금을 "읽을 수 없는 내용"으로 보고 넘겨받을 수 있다.
    const temp = `${path}.new-${pid}-${randomUUID()}`;
    writeFileSync(temp, String(pid), { flag: "wx" });
    try {
      linkSync(temp, path);
      return () => {
        if (readOwner(path) !== pid) return;
        try { unlinkSync(path); } catch { /* 이미 지워졌다 */ }
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      // 내용과 inode는 같은 열린 파일에서 읽어 경로 교체 중에도 서로 일치시킨다.
      let snapshot;
      try {
        const fd = openSync(path, "r");
        try {
          snapshot = { stat: fstatSync(fd), content: readFileSync(fd, "utf8") };
        } finally {
          closeSync(fd);
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw error;
      }
      const value = Number(snapshot.content.trim());
      const owner = Number.isSafeInteger(value) && value > 0 ? value : null;
      if (owner !== null && owner !== pid && alive(owner)) throw new DataDirInUseError(directory, owner);
      hooks?.onStaleDetected?.();
      const stalePath = `${path}.stale-${pid}-${randomUUID()}`;
      try {
        renameSync(path, stalePath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw error;
      }
      try {
        const moved = statSync(stalePath);
        if (moved.ino !== snapshot.stat.ino || moved.mtimeMs !== snapshot.stat.mtimeMs
          || readFileSync(stalePath, "utf8") !== snapshot.content) {
          const movedOwner = readOwner(stalePath);
          // rename으로 가져온 새 잠금은 덮어쓰지 않는 link로 복원한다.
          // 남은 위험: 옮긴 순간 세 번째 프로세스가 잠금을 얻으면 복원이 EEXIST가 되고, 옮긴
          // 잠금의 주인과 세 번째 프로세스가 둘 다 잠금을 가졌다고 믿는다. Node에는 flock이 없어
          // 파일만으로는 막을 수 없다. 오래된 잠금이 남은 상태에서 서버 셋이 동시에 시작할 때만 생긴다.
          try {
            linkSync(stalePath, path);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
          }
          throw new DataDirInUseError(directory, readOwner(path) ?? movedOwner ?? 0);
        }
      } finally {
        unlinkSync(stalePath);
      }
    } finally {
      unlinkSync(temp);
    }
  }
  const owner = readOwner(path);
  throw new DataDirInUseError(directory, owner ?? 0);
}
