// @vitest-environment node
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createResultDirectory } from "./result-directory";

const startedAt = new Date("2026-10-14T22:48:04.748Z");
let base: string;

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), "cloudsight-results-"));
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

describe("createResultDirectory", () => {
  it("없는 상위 폴더까지 만들고 UTC 시각 이름의 빈 폴더 경로를 돌려준다", async () => {
    const root = join(base, "evals", "results");
    const directory = await createResultDirectory(root, startedAt);
    expect(directory).toBe(join(root, "2026-10-14T22-48-04-748Z"));
    expect(await readdir(directory)).toEqual([]);
  });

  it("같은 이름이 있으면 기존 폴더를 건드리지 않고 -2, -3을 붙인다", async () => {
    const first = await createResultDirectory(base, startedAt);
    await writeFile(join(first, "report.md"), "기존 결과", "utf8");
    expect(await createResultDirectory(base, startedAt)).toBe(join(base, "2026-10-14T22-48-04-748Z-2"));
    expect(await createResultDirectory(base, startedAt)).toBe(join(base, "2026-10-14T22-48-04-748Z-3"));
    expect(await readdir(first)).toEqual(["report.md"]);
  });

  it("접미사는 번호 뒤에 붙인다", async () => {
    expect(await createResultDirectory(base, startedAt, "-artifacts")).toBe(join(base, "2026-10-14T22-48-04-748Z-artifacts"));
    expect(await createResultDirectory(base, startedAt, "-artifacts")).toBe(join(base, "2026-10-14T22-48-04-748Z-2-artifacts"));
  });

  it("동시에 시작한 실행은 서로 다른 폴더를 받는다", async () => {
    const directories = await Promise.all(Array.from({ length: 5 }, () => createResultDirectory(base, startedAt)));
    expect(new Set(directories).size).toBe(5);
    expect((await readdir(base)).sort()).toEqual([
      "2026-10-14T22-48-04-748Z", "2026-10-14T22-48-04-748Z-2", "2026-10-14T22-48-04-748Z-3",
      "2026-10-14T22-48-04-748Z-4", "2026-10-14T22-48-04-748Z-5",
    ]);
  });

  it("이미 있는 이름 말고 다른 파일 시스템 오류는 그대로 던진다", async () => {
    const file = join(base, "not-a-directory");
    await writeFile(file, "", "utf8");
    await expect(createResultDirectory(join(file, "results"), startedAt)).rejects.toMatchObject({ code: "ENOTDIR" });
  });
});
