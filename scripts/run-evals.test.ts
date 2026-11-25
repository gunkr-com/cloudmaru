// @vitest-environment node
import { mkdir, writeFile } from "node:fs/promises";
import { sep } from "node:path";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadScenarios } from "../evals/scenario-schema";
import sampleOutput from "../src/lib/analysis/fixtures/sample-model-output.json";
import * as analysis from "../src/lib/analysis/run-analysis";
import { loadCatalog } from "../src/lib/catalog/load";
import { requestStructuredOutput } from "../src/services/claude";
import type { StructuredLlm } from "../src/types/analysis";
import { buildReport, parseArgs, runEvals } from "./run-evals";

vi.mock("node:fs/promises", () => ({ mkdir: vi.fn(), writeFile: vi.fn() }));
vi.mock("node:process", () => ({ loadEnvFile: vi.fn() }));
vi.mock("../src/services/claude", () => ({ requestStructuredOutput: vi.fn() }));

const originalArgv = process.argv;
const originalExitCode = process.exitCode;
const configured = { ANTHROPIC_API_KEY: "test-key", CLAUDE_MODEL: "test-model" };

function deps() {
  return { scenarios: loadScenarios(), catalog: loadCatalog(), env: {} };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("네트워크 금지")));
});

afterEach(() => {
  process.argv = originalArgv;
  process.exitCode = originalExitCode;
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("평가 인자", () => {
  it.each([
    [[], { dryRun: false }],
    [["--dry-run"], { dryRun: true }],
    [["--scenario", "reservation-web-app"], { dryRun: false, scenarioId: "reservation-web-app" }],
    [["--dry-run", "--scenario", "static-portfolio"], { dryRun: true, scenarioId: "static-portfolio" }],
    [["--scenario", "static-portfolio", "--dry-run"], { dryRun: true, scenarioId: "static-portfolio" }],
  ])("%j를 해석한다", (args, expected) => {
    expect(parseArgs(args as string[])).toEqual(expected);
  });

  it.each([
    ["--unknown"], ["stray"], ["--scenario"], ["--scenario", "--dry-run"],
    ["--scenario", "../escape"], ["--dry-run", "--dry-run"],
    ["--scenario", "first", "--scenario", "second"],
  ])("잘못된 인자 %j를 한국어 오류로 거부한다", (...args) => {
    expect(() => parseArgs(args)).toThrow(/[가-힣]/);
  });
});

describe("평가 실행과 보고서", () => {
  it("모의 실행은 10개 입력을 실제 파이프라인과 샘플 llm으로 돌며 파일·네트워크 부작용이 없다", async () => {
    const runAnalysis = vi.spyOn(analysis, "runAnalysis");
    const onScenario = vi.fn();
    const run = await runEvals({ dryRun: true }, { ...deps(), onScenario });
    expect(run.exitCode).toBe(0);
    expect(run.records).toHaveLength(10);
    expect(run.records.some(({ report }) => !report.passed)).toBe(true);
    expect(runAnalysis).toHaveBeenCalledTimes(10);
    expect(onScenario).toHaveBeenCalledTimes(10);
    for (const [index, { scenario, outcome }] of run.records.entries()) {
      expect(runAnalysis.mock.calls[index][0]).toEqual(scenario.input);
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) throw new Error("견본 검증 실패");
      expect(outcome.result.input).toEqual(scenario.input);
      expect(outcome.result.outOfScope).toBe(sampleOutput.outOfScope);
      expect(outcome.result.recommendedTier).toBe(sampleOutput.recommendedTier);
      expect(outcome.usage).toBeNull();
    }
    const markdown = buildReport(run);
    for (const text of [sampleOutput.requestTitle, sampleOutput.recommendationReason, ...sampleOutput.plans.flatMap(plan => [plan.title, ...plan.pros])]) {
      expect(markdown).toContain(text.en);
      expect(markdown).toContain(text.ko);
    }
    expect(markdown.split("\n")[0]).toBe("모의 실행: 모델을 호출하지 않았습니다");
    for (const { scenario } of run.records) expect(markdown).toContain(scenario.id);
    expect(markdown).toContain("총 비용 (USD): 0.000000 USD");
    expect(markdown).toContain("시나리오당 평균 비용 (USD): 0.000000 USD");
    expect(markdown).toContain("예산 대비");
    expect(markdown).toContain("추천 안");
    expect(markdown).toContain("입력 토큰");
    expect(markdown).toContain("출력 토큰");
    expect(requestStructuredOutput).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(writeFile).not.toHaveBeenCalled();
    expect(mkdir).not.toHaveBeenCalled();
  });

  it.each([
    [{}, ["ANTHROPIC_API_KEY", "CLAUDE_MODEL"]],
    [{ CLAUDE_MODEL: "test-model" }, ["ANTHROPIC_API_KEY"]],
    [{ ANTHROPIC_API_KEY: "test-key", CLAUDE_MODEL: " " }, ["CLAUDE_MODEL"]],
  ])("환경 변수 누락 %j이면 모델을 호출하지 않고 사용법을 알린다", async (env, missing) => {
    const llm = vi.fn<StructuredLlm>();
    const pending = runEvals({ dryRun: false }, { ...deps(), env, llm });
    for (const name of missing) await expect(pending).rejects.toThrow(name);
    await expect(pending).rejects.toThrow("npm run evals -- --dry-run");
    expect(llm).not.toHaveBeenCalled();
    expect(requestStructuredOutput).not.toHaveBeenCalled();
  });

  it("선택한 시나리오만 실행하고 없는 ID는 호출 전에 실패한다", async () => {
    const run = await runEvals({ dryRun: true, scenarioId: "static-portfolio" }, deps());
    expect(run.records.map(({ scenario }) => scenario.id)).toEqual(["static-portfolio"]);
    await expect(runEvals({ dryRun: false, scenarioId: "missing" }, { ...deps(), env: configured }))
      .rejects.toThrow(/시나리오/);
    expect(requestStructuredOutput).not.toHaveBeenCalled();
  });

  it("실행은 순차적이고 중간 실패 뒤에도 계속하며 실패 호출의 비용까지 합산한다", async () => {
    const events: string[] = [];
    let active = 0;
    let maximum = 0;
    let call = 0;
    const llm = vi.fn<StructuredLlm>(async () => {
      const index = call++;
      active += 1;
      maximum = Math.max(maximum, active);
      events.push(`start-${index}`);
      await Promise.resolve();
      active -= 1;
      events.push(`end-${index}`);
      // 첫 시나리오는 검증 실패 뒤 다시 부른 호출(ADR-022)도 실패한다.
      return { data: index <= 1 ? {} : sampleOutput, usage: { promptTokens: 100, completionTokens: 50, costUsd: index <= 1 ? 0.1 : 0.3 } };
    });
    const run = await runEvals({ dryRun: false }, { ...deps(), scenarios: loadScenarios().slice(0, 2).map(scenario => ({ ...scenario, input: { ...scenario.input, monthlyBudget: 300 } })), env: configured, llm,
      onScenario: async ({ scenario }) => { await Promise.resolve(); events.push(scenario.id); },
    });
    expect(maximum).toBe(1);
    expect(events).toEqual(["start-0", "end-0", "start-1", "end-1", "reservation-web-app", "start-2", "end-2", "static-portfolio"]);
    expect(run.exitCode).toBe(1);
    expect(run.records[0].outcome).toMatchObject({ ok: false, stage: "validation" });
    const markdown = buildReport(run);
    expect(markdown).toContain("총 비용 (USD): 0.500000 USD");
    expect(markdown).toContain("시나리오당 평균 비용 (USD): 0.250000 USD");
    expect(markdown).toContain("validation");
    expect(markdown).toContain("필수 구성요소 분류");
    expect(markdown).toContain("통과 수: 1/2");
  });

  it("검증 실패 뒤 다시 불러 통과한 시나리오와 첫 오류를 보고서에 드러낸다", async () => {
    let call = 0;
    const llm = vi.fn<StructuredLlm>(async () => ({ data: call++ === 0 ? {} : sampleOutput, usage: { promptTokens: 100, completionTokens: 50, costUsd: 0.1 } }));
    const run = await runEvals({ dryRun: false }, { ...deps(), scenarios: loadScenarios().slice(0, 1), env: configured, llm });
    expect(llm).toHaveBeenCalledTimes(2);
    expect(run.records[0].outcome).toMatchObject({ ok: true, retryErrors: expect.any(Array) });
    const markdown = buildReport(run);
    expect(markdown).toContain("- 검증 재시도: 1/1");
    expect(markdown).toMatch(/\| (통과|실패) \(재시도\) \|/);
    expect(markdown).toContain("- 첫 시도 검증 오류: ");
  });

  it("시작 준비 콜백은 검증 뒤 첫 모델 호출 전에 한 번 기다린다", async () => {
    const events: string[] = [];
    const llm = vi.fn<StructuredLlm>(async () => {
      events.push("llm");
      return { data: sampleOutput, usage: null };
    });
    await runEvals({ dryRun: false }, { ...deps(), scenarios: loadScenarios().slice(0, 2), env: configured, llm,
      beforeRun: async () => { await Promise.resolve(); events.push("beforeRun"); },
    });
    expect(events).toEqual(["beforeRun", "llm", "llm"]);
  });

  it("검증에 실패하면 시작 준비 콜백을 부르지 않고, 준비가 실패하면 모델을 호출하지 않는다", async () => {
    const beforeRun = vi.fn();
    const llm = vi.fn<StructuredLlm>();
    await expect(runEvals({ dryRun: false }, { ...deps(), env: {}, llm, beforeRun })).rejects.toThrow("ANTHROPIC_API_KEY");
    await expect(runEvals({ dryRun: true, scenarioId: "missing" }, { ...deps(), beforeRun })).rejects.toThrow(/시나리오/);
    expect(beforeRun).not.toHaveBeenCalled();
    beforeRun.mockRejectedValue(new Error("폴더 생성 실패"));
    await expect(runEvals({ dryRun: false }, { ...deps(), env: configured, llm, beforeRun })).rejects.toThrow("폴더 생성 실패");
    expect(llm).not.toHaveBeenCalled();
  });

  it("실제 실행의 기본 llm은 서비스 래퍼이며 모든 점검 통과 시 코드 0이다", async () => {
    vi.mocked(requestStructuredOutput).mockResolvedValue({ data: sampleOutput, usage: null, model: "test-model" });
    const run = await runEvals({ dryRun: false, scenarioId: "reservation-web-app" }, { ...deps(), env: configured });
    expect(requestStructuredOutput).toHaveBeenCalledTimes(1);
    expect(run.exitCode).toBe(0);
    expect(buildReport(run)).toContain("자동 점검 7개 모두 통과");
  });

  it.each([null, { promptTokens: 100, completionTokens: 50, costUsd: null }])("실제 비용 미제공 %j를 0으로 추정하지 않는다", async (usage) => {
    const llm = vi.fn<StructuredLlm>()
      .mockResolvedValueOnce({ data: sampleOutput, usage: { promptTokens: 100, completionTokens: 50, costUsd: 0.2 } })
      .mockResolvedValueOnce({ data: sampleOutput, usage });
    const run = await runEvals({ dryRun: false }, { ...deps(), scenarios: loadScenarios().slice(0, 2), env: configured, llm });
    const markdown = buildReport(run);
    expect(markdown).toContain("총 비용 (USD): 미확정");
    expect(markdown).toContain("확인된 비용 0.200000 USD");
    expect(markdown).toContain("비용 미제공 1/2건");
    expect(markdown).toContain("시나리오당 평균 비용 (USD): 미확정");
  });
});

describe("평가 CLI (파일과 환경 로딩은 모킹)", () => {
  async function runCli(args: string[]) {
    vi.resetModules();
    process.argv = [originalArgv[0], fileURLToPath(new URL("./run-evals.ts", import.meta.url)), ...args];
    await import("./run-evals");
  }

  it("import만 하면 환경 로딩·쓰기·종료 상태 변경이 없다", async () => {
    process.exitCode = 7;
    await import("./run-evals");
    expect(loadEnvFile).not.toHaveBeenCalled();
    expect(writeFile).not.toHaveBeenCalled();
    expect(requestStructuredOutput).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(7);
  });

  it(".env.local이 없어도 모의 실행하고 시나리오 JSON·보고서와 경로를 남긴다", async () => {
    vi.mocked(loadEnvFile).mockImplementation(() => { throw Object.assign(new Error("없음"), { code: "ENOENT" }); });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await runCli(["--dry-run"]);
    expect(loadEnvFile).toHaveBeenCalledWith(fileURLToPath(new URL("../.env.local", import.meta.url)));
    expect(writeFile).toHaveBeenCalledTimes(11);
    const jsonCalls = vi.mocked(writeFile).mock.calls.filter(([path]) => String(path).endsWith(".json"));
    expect(jsonCalls).toHaveLength(10);
    const saved = JSON.parse(String(jsonCalls[0][1]));
    expect(saved.scenario.input).toEqual(loadScenarios()[0].input);
    expect(saved.outcome).toMatchObject({ ok: true, result: { input: saved.scenario.input } });
    expect(saved.report.checks).toHaveLength(7);
    expect(saved.outcome.result.requestTitle).toEqual(sampleOutput.requestTitle);
    expect(log.mock.calls.flat().join("\n")).toContain(sampleOutput.requestTitle.en);
    expect(log.mock.calls.flat().join("\n")).toContain(sampleOutput.requestTitle.ko);
    expect(log.mock.calls.flat().join("\n")).toContain("report.md");
    expect(requestStructuredOutput).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(0);
  });

  it("결과 폴더를 모델 호출 전에 만들고 같은 이름이 있으면 번호를 붙여 그 폴더에 쓴다", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    vi.stubEnv("CLAUDE_MODEL", "test-model");
    vi.mocked(requestStructuredOutput).mockResolvedValue({ data: sampleOutput, usage: null, model: "test-model" });
    vi.mocked(mkdir).mockImplementation(async (path, options) => {
      if (options === undefined && !String(path).endsWith("-2")) throw Object.assign(new Error("이미 있음"), { code: "EEXIST" });
      return undefined;
    });
    vi.spyOn(console, "log").mockImplementation(() => {});
    await runCli(["--scenario", "static-portfolio"]);
    const attempts = vi.mocked(mkdir).mock.calls.filter(([, options]) => options === undefined).map(([path]) => String(path));
    expect(attempts).toHaveLength(2);
    expect(attempts[0]).toMatch(/evals[\\/]results[\\/]\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d-\d{3}Z$/);
    expect(attempts[1]).toBe(`${attempts[0]}-2`);
    expect(Math.max(...vi.mocked(mkdir).mock.invocationCallOrder))
      .toBeLessThan(vi.mocked(requestStructuredOutput).mock.invocationCallOrder[0]);
    const written = vi.mocked(writeFile).mock.calls.map(([path]) => String(path));
    expect(written).toEqual([`${attempts[1]}${sep}static-portfolio.json`, `${attempts[1]}${sep}report.md`]);
  });

  it("결과 폴더를 만들 수 없으면 모델을 호출하지 않고 실패 코드로 끝낸다", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    vi.stubEnv("CLAUDE_MODEL", "test-model");
    vi.mocked(mkdir).mockRejectedValue(Object.assign(new Error("권한 없음"), { code: "EACCES" }));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await runCli(["--scenario", "static-portfolio"]);
    expect(error).toHaveBeenCalledWith(expect.stringContaining("권한 없음"));
    expect(requestStructuredOutput).not.toHaveBeenCalled();
    expect(writeFile).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it("키 누락 시 코드 1이고 모델 호출과 파일 쓰기가 없다", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("CLAUDE_MODEL", "");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await runCli([]);
    expect(error.mock.calls.flat().join("\n")).toContain("--dry-run");
    expect(requestStructuredOutput).not.toHaveBeenCalled();
    expect(writeFile).not.toHaveBeenCalled();
    expect(mkdir).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it("쓰기 실패는 모의 실행이어도 실패 코드로 끝낸다", async () => {
    vi.mocked(writeFile).mockRejectedValue(new Error("결과 쓰기 실패"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await runCli(["--dry-run"]);
    expect(error).toHaveBeenCalledWith(expect.stringContaining("쓰기 실패"));
    expect(process.exitCode).toBe(1);
  });
});
