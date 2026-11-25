// @vitest-environment node
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { sep } from "node:path";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import sampleAnalysis from "../src/lib/analysis/fixtures/sample-model-output.json";
import sampleInput from "../src/lib/analysis/fixtures/sample-input.json";
import sampleGuide from "../src/lib/artifacts/fixtures/sample-guide-output.json";
import sampleEvaluation from "../src/lib/artifacts/fixtures/sample-evaluation-output.json";
import sampleBicep from "../src/lib/artifacts/fixtures/sample-bicep-output.json";
import { buildAnalysisResult } from "../src/lib/analysis/build-result";
import { loadCatalog } from "../src/lib/catalog/load";
import { requestStructuredOutput } from "../src/services/claude";
import type { AnalysisInput } from "../src/types/analysis";
import { buildArtifactReport, parseArtifactArgs, runArtifactEvals } from "./run-artifact-evals";

vi.mock("node:fs/promises", () => ({ mkdir: vi.fn(), readFile: vi.fn(), readdir: vi.fn(), writeFile: vi.fn() }));
vi.mock("node:process", () => ({ loadEnvFile: vi.fn() }));
vi.mock("../src/services/claude", () => ({ requestStructuredOutput: vi.fn() }));

const catalog = loadCatalog();
const input = sampleInput;
const built = buildAnalysisResult(sampleAnalysis, input as AnalysisInput, catalog);
if (!built.ok) throw new Error("분석 견본을 만들 수 없습니다.");
const sampleRecord = { dryRun: false, scenario: { id: "reservation-web-app" }, outcome: { ok: true, result: built.result, usage: null } };
const originalArgv = process.argv;
const originalExitCode = process.exitCode;

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("네트워크 금지")));
  vi.mocked(readdir).mockResolvedValue(["2026-10-14T10-00-00-000Z"] as never);
  vi.mocked(readFile).mockResolvedValue(JSON.stringify(sampleRecord) as never);
});
afterEach(() => {
  process.argv = originalArgv;
  process.exitCode = originalExitCode;
  vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); vi.resetModules();
});

describe("아티팩트 eval 인자", () => {
  it.each([
    [[], { dryRun: false }], [["--dry-run"], { dryRun: true }],
    [["--scenario", "reservation-web-app"], { dryRun: false, scenarioId: "reservation-web-app" }],
    [["--kind", "bicep"], { dryRun: false, kind: "bicep" }],
    [["--dry-run", "--kind", "guide", "--scenario", "static-portfolio"], { dryRun: true, kind: "guide", scenarioId: "static-portfolio" }],
  ])("%j를 해석한다", (args, expected) => expect(parseArtifactArgs(args as string[])).toEqual(expected));
  it.each([["--other"], ["--dry-run", "--dry-run"], ["--scenario", "../bad"], ["--kind", "nope"], ["--kind"], ["--scenario", "a", "--scenario", "b"]])("잘못된 %j를 한국어 오류로 거부한다", (...args) => expect(() => parseArtifactArgs(args)).toThrow(/[가-힣]/));
});

describe("결과물 eval 실행", () => {
  it("모의 실행은 견본 분석과 세 결과물 견본을 모두 검증하고 부작용 없이 끝난다", async () => {
    const run = await runArtifactEvals({ dryRun: true }, { catalog, env: {} });
    expect(run.records).toHaveLength(3);
    expect(run.records.every(({ outcome }) => outcome.ok)).toBe(true);
    expect(run.exitCode).toBe(0);
    expect(readFile).not.toHaveBeenCalled(); expect(writeFile).not.toHaveBeenCalled(); expect(mkdir).not.toHaveBeenCalled();
    expect(requestStructuredOutput).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
    expect(buildArtifactReport(run)).toContain("종류별 평균 비용");
  });
  it("종류와 시나리오를 필터링하고 최근 성공 분석 결과를 선택한다", async () => {
    const run = await runArtifactEvals({ dryRun: false, kind: "evaluation", scenarioId: "reservation-web-app" }, { catalog, env: { ANTHROPIC_API_KEY: "k", CLAUDE_MODEL: "m" }, results: [{ runId: "2026-10-14T10-00-00-000Z", scenarioId: "reservation-web-app", record: sampleRecord }], llm: async () => ({ data: sampleEvaluation, usage: null }) });
    expect(run.records).toHaveLength(1); expect(run.records[0].kind).toBe("evaluation");
    expect(run.records[0].scenarioId).toBe("reservation-web-app");
    await expect(runArtifactEvals({ dryRun: false, scenarioId: "missing" }, { catalog, env: {} })).rejects.toThrow("먼저 `npm run evals -- --scenario missing`");
  });
  it("환경 키가 빠지면 시작 준비와 모델 호출 없이 안내한다", async () => {
    const llm = vi.fn(); const beforeRun = vi.fn();
    await expect(runArtifactEvals({ dryRun: false }, { catalog, env: {}, results: [{ runId: "2026-10-14T10-00-00-000Z", scenarioId: "reservation-web-app", record: sampleRecord }], llm, beforeRun })).rejects.toThrow("ANTHROPIC_API_KEY");
    expect(llm).not.toHaveBeenCalled(); expect(requestStructuredOutput).not.toHaveBeenCalled(); expect(beforeRun).not.toHaveBeenCalled();
  });
  it("시작 준비 콜백은 검증 뒤 첫 모델 호출 전에 한 번 기다리고, 실패하면 모델을 호출하지 않는다", async () => {
    const events: string[] = [];
    const results = [{ runId: "2026-10-14T10-00-00-000Z", scenarioId: "reservation-web-app", record: sampleRecord }];
    const env = { ANTHROPIC_API_KEY: "k", CLAUDE_MODEL: "m" };
    const llm = vi.fn(async () => { events.push("llm"); return { data: sampleGuide, usage: null }; });
    await runArtifactEvals({ dryRun: false, kind: "guide" }, { catalog, env, results, llm, beforeRun: async () => { await Promise.resolve(); events.push("beforeRun"); } });
    expect(events).toEqual(["beforeRun", "llm"]);
    llm.mockClear();
    await expect(runArtifactEvals({ dryRun: false }, { catalog, env, results, llm, beforeRun: async () => { throw new Error("폴더 생성 실패"); } })).rejects.toThrow("폴더 생성 실패");
    expect(llm).not.toHaveBeenCalled();
  });
  it("잘못된 출력, 미확정 비용, 평균과 총계를 보고한다", async () => {
    const run = await runArtifactEvals({ dryRun: false, kind: "guide" }, { catalog, env: { ANTHROPIC_API_KEY: "k", CLAUDE_MODEL: "m" }, results: [{ runId: "2026-10-14T10-00-00-000Z", scenarioId: "reservation-web-app", record: sampleRecord }], llm: async () => ({ data: {}, usage: { promptTokens: 12, completionTokens: 3, costUsd: null } }) });
    expect(run.exitCode).toBe(1); expect(run.records[0].outcome).toMatchObject({ ok: false });
    const report = buildArtifactReport(run);
    expect(report).toContain("실패"); expect(report).toContain("미확정"); expect(report).toContain("종류별 평균 비용"); expect(report).toContain("전체 합계");
  });
  it("검증 실패 뒤 다시 불러 통과한 결과물과 첫 오류를 보고서에 드러낸다", async () => {
    let call = 0;
    const run = await runArtifactEvals({ dryRun: false, kind: "guide" }, { catalog, env: { ANTHROPIC_API_KEY: "k", CLAUDE_MODEL: "m" }, results: [{ runId: "2026-10-14T10-00-00-000Z", scenarioId: "reservation-web-app", record: sampleRecord }], llm: async () => ({ data: call++ === 0 ? {} : sampleGuide, usage: { promptTokens: 10, completionTokens: 5, costUsd: 0.1 } }) });
    expect(run.records[0].outcome).toMatchObject({ ok: true, retryErrors: expect.any(Array), usage: { promptTokens: 20, completionTokens: 10 } });
    const report = buildArtifactReport(run);
    expect(report).toContain("| 통과 (재시도) |");
    expect(report).toContain("첫 시도: ");
    expect(report).toContain("검증 재시도: 1/1건");
  });
  it("성공 결과물 비용을 report에 합산한다", async () => {
    const outputs = { guide: sampleGuide, evaluation: sampleEvaluation, bicep: sampleBicep };
    const run = await runArtifactEvals({ dryRun: false }, { catalog, env: { ANTHROPIC_API_KEY: "k", CLAUDE_MODEL: "m" }, results: [{ runId: "2026-10-14T10-00-00-000Z", scenarioId: "reservation-web-app", record: sampleRecord }], llm: async (request) => ({ data: request.schemaName === "artifact_guide" ? outputs.guide : request.schemaName === "artifact_evaluation" ? outputs.evaluation : outputs.bicep, usage: { promptTokens: 100, completionTokens: 20, costUsd: 0.25 } }) });
    expect(run.records.every(({ outcome }) => outcome.ok)).toBe(true);
    const report = buildArtifactReport(run); expect(report).toContain("0.250000 USD"); expect(report).toContain("전체 합계: 0.750000 USD");
  });
});

describe("CLI 경계", () => {
  it("import만 하면 환경 로딩이나 쓰기를 하지 않는다", async () => {
    process.exitCode = 7; await import("./run-artifact-evals");
    expect(loadEnvFile).not.toHaveBeenCalled(); expect(writeFile).not.toHaveBeenCalled(); expect(process.exitCode).toBe(7);
  });
  it("파일을 쓸 때 결과 폴더와 report를 만들고 불필요한 분석 폴더에 저장하지 않는다", async () => {
    vi.mocked(loadEnvFile).mockImplementation(() => { throw Object.assign(new Error("missing"), { code: "ENOENT" }); });
    vi.stubEnv("ANTHROPIC_API_KEY", ""); vi.stubEnv("CLAUDE_MODEL", "");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    process.argv = [originalArgv[0], fileURLToPath(new URL("./run-artifact-evals.ts", import.meta.url)), "--dry-run"];
    await import("./run-artifact-evals");
    expect(mkdir).toHaveBeenCalled(); expect(writeFile).toHaveBeenCalled();
    const files = vi.mocked(writeFile).mock.calls.map(([path, body]) => ({ path: String(path), body: String(body) }));
    for (const locale of ["en", "ko"] as const) for (const kind of ["guide", "evaluation", "bicep"] as const) {
      const suffix = kind === "bicep" ? "main.bicep" : `${kind}${locale === "ko" ? ".ko" : ""}.md`;
      const file = files.find(({ path }) => path.endsWith(`dry-run-sample--${locale}--cloudsight-balanced-${suffix}`));
      expect(file, `${locale} ${kind}`).toBeDefined();
      if (kind === "bicep") expect(file!.body).toMatch(locale === "en" ? /^\/\/ Unverified draft/ : /^\/\/ 검증 전 초안/);
      if (locale === "en") expect(file!.body).not.toMatch(/[가-힣ㄱ-ㅎㅏ-ㅣ]/);
    }
    expect(error).not.toHaveBeenCalled(); expect(process.exitCode).toBe(0);
  });
  it("결과 폴더를 모델 호출 전에 만들고 같은 이름이 있으면 -artifacts 앞에 번호를 붙인다", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "k"); vi.stubEnv("CLAUDE_MODEL", "m");
    vi.mocked(readdir).mockImplementation((async (path: string) => String(path).endsWith("2026-10-14T10-00-00-000Z") ? ["reservation-web-app.json"] : ["2026-10-14T10-00-00-000Z"]) as never);
    vi.mocked(requestStructuredOutput).mockResolvedValue({ data: sampleGuide, usage: null, model: "m" });
    vi.mocked(mkdir).mockImplementation(async (path, options) => {
      if (options === undefined && !String(path).endsWith("-2-artifacts")) throw Object.assign(new Error("이미 있음"), { code: "EEXIST" });
      return undefined;
    });
    vi.spyOn(console, "log").mockImplementation(() => {});
    process.argv = [originalArgv[0], fileURLToPath(new URL("./run-artifact-evals.ts", import.meta.url)), "--kind", "guide"];
    await import("./run-artifact-evals");
    const attempts = vi.mocked(mkdir).mock.calls.filter(([, options]) => options === undefined).map(([path]) => String(path));
    expect(attempts).toHaveLength(2);
    expect(attempts[0]).toMatch(/evals[\\/]results[\\/]\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d-\d{3}Z-artifacts$/);
    expect(attempts[1]).toBe(attempts[0].replace(/-artifacts$/, "-2-artifacts"));
    expect(Math.max(...vi.mocked(mkdir).mock.invocationCallOrder))
      .toBeLessThan(vi.mocked(requestStructuredOutput).mock.invocationCallOrder[0]);
    const written = vi.mocked(writeFile).mock.calls.map(([path]) => String(path));
    expect(written.length).toBeGreaterThan(0);
    expect(written.every((path) => path.startsWith(`${attempts[1]}${sep}`))).toBe(true);
    expect(process.exitCode).toBe(0);
  });
});

it("preserves both languages in dry-run result JSON", async () => {
  const run = await runArtifactEvals({ dryRun: true }, { catalog });
  expect(run.records.every(({ outcome }) => outcome.ok)).toBe(true);
  const saved = JSON.parse(JSON.stringify(run.records));
  expect(saved[0].outcome.content.overview).toEqual(sampleGuide.overview);
  expect(saved[1].outcome.content.summary).toEqual(sampleEvaluation.summary);
  expect(saved[2].outcome.content.parameters[0].description).toEqual(sampleBicep.parameters[0].description);
  expect(sampleGuide.overview.en).not.toBe(sampleGuide.overview.ko);
});
