import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { loadEnvFile } from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createResultDirectory } from "../evals/result-directory";
import { latestEvalResults, type EvalResultFile } from "../src/lib/analysis/eval-result";
import { buildAnalysisResult } from "../src/lib/analysis/build-result";
import sampleAnalysis from "../src/lib/analysis/fixtures/sample-model-output.json";
import sampleInput from "../src/lib/analysis/fixtures/sample-input.json";
import { ARTIFACT_KINDS } from "../src/lib/artifacts/labels";
import sampleGuide from "../src/lib/artifacts/fixtures/sample-guide-output.json";
import sampleEvaluation from "../src/lib/artifacts/fixtures/sample-evaluation-output.json";
import sampleBicep from "../src/lib/artifacts/fixtures/sample-bicep-output.json";
import { renderArtifactFile } from "../src/lib/artifacts/render-file";
import { runArtifact } from "../src/lib/artifacts/run-artifact";
import { loadCatalog } from "../src/lib/catalog/load";
import { requestStructuredOutput } from "../src/services/claude";
import type { StructuredLlm } from "../src/types/analysis";
import type { ArtifactKind, ArtifactOutcome } from "../src/types/artifact";
import type { AnalysisInput, AnalysisResult } from "../src/types/analysis";
import type { Catalog, Tier } from "../src/types/catalog";

export type ArtifactEvalOptions = { dryRun: boolean; scenarioId?: string; kind?: ArtifactKind };
export type ArtifactEvalRecord = { scenarioId: string; kind: ArtifactKind; tier: Tier; outcome: ArtifactOutcome; result: AnalysisResult };
export type ArtifactEvalRun = { dryRun: boolean; records: ArtifactEvalRecord[]; exitCode: 0 | 1 };
type EvalEnvironment = { ANTHROPIC_API_KEY?: string; CLAUDE_MODEL?: string };

export function parseArtifactArgs(args: string[]): ArtifactEvalOptions {
  const options: ArtifactEvalOptions = { dryRun: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--dry-run" && !options.dryRun) options.dryRun = true;
    else if (arg === "--scenario" && options.scenarioId === undefined) {
      const id = args[++index];
      if (!id || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(id)) throw new Error("--scenario 다음에 영문 kebab-case 시나리오 ID를 입력해 주세요.");
      options.scenarioId = id;
    } else if (arg === "--kind" && options.kind === undefined) {
      const kind = args[++index];
      if (!kind || !ARTIFACT_KINDS.includes(kind as ArtifactKind)) throw new Error("--kind 다음에 guide, evaluation, bicep 중 하나를 입력해 주세요.");
      options.kind = kind as ArtifactKind;
    } else throw new Error(`알 수 없거나 중복된 인자: ${arg}. 사용법: npm run evals:artifacts -- [--dry-run] [--scenario <id>] [--kind <guide|evaluation|bicep>]`);
  }
  return options;
}

function dryRunResult(catalog: Catalog): AnalysisResult {
  const built = buildAnalysisResult(sampleAnalysis, sampleInput as AnalysisInput, catalog);
  if (!built.ok) throw new Error(`분석 견본을 만들 수 없습니다: ${built.errors.join(", ")}`);
  return built.result;
}

function dryRunLlm(): StructuredLlm {
  return async ({ schemaName }) => ({
    data: schemaName === "artifact_guide" ? sampleGuide : schemaName === "artifact_evaluation" ? sampleEvaluation : sampleBicep,
    usage: null,
  });
}

async function readSavedResults(scenarioId: string | undefined): Promise<EvalResultFile[]> {
  const root = fileURLToPath(new URL("../evals/results/", import.meta.url));
  let folders: string[];
  try { folders = (await readdir(root)).filter((entry) => /^\d{4}-\d\d-\d\dT/.test(entry) && !entry.endsWith("-artifacts")); }
  catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") folders = [];
    else throw error;
  }
  const files: EvalResultFile[] = [];
  for (const runId of folders) {
    if (runId.endsWith("-artifacts")) continue;
    let names: string[];
    try { names = await readdir(join(root, runId)); } catch { continue; }
    for (const name of names.filter((value) => value.endsWith(".json"))) {
      const fileScenarioId = name.slice(0, -5);
      if (scenarioId && fileScenarioId !== scenarioId) continue;
      try { files.push({ runId, scenarioId: fileScenarioId, record: JSON.parse(await readFile(join(root, runId, name), "utf8")) }); }
      catch { /* 손상되었거나 쓰는 중인 실행 파일은 성공 분석으로 보지 않는다. */ }
    }
  }
  return files;
}

// 입력 검증 뒤 첫 모델 호출 전에 선택적 준비 콜백(결과 폴더 만들기)을 기다린다.
export async function runArtifactEvals(options: ArtifactEvalOptions, deps: {
  catalog: Catalog; env?: EvalEnvironment; llm?: StructuredLlm; results?: EvalResultFile[]; beforeRun?: () => void | Promise<void>;
}): Promise<ArtifactEvalRun> {
  const env = deps.env ?? process.env;
  const targets = options.dryRun
    ? [{ scenarioId: "dry-run-sample", result: dryRunResult(deps.catalog) }]
    : latestEvalResults(deps.results ?? await readSavedResults(options.scenarioId))
      .filter(({ scenarioId }) => options.scenarioId === undefined || scenarioId === options.scenarioId);
  if (!targets.length) {
    if (options.scenarioId) throw new Error(`분석 결과가 없습니다. 먼저 \`npm run evals -- --scenario ${options.scenarioId}\`로 분석 결과를 만들어 주세요.`);
    throw new Error("저장된 성공 분석 결과가 없습니다. 먼저 `npm run evals`로 분석 결과를 만들어 주세요.");
  }
  if (!options.dryRun) {
    const missing = (["ANTHROPIC_API_KEY", "CLAUDE_MODEL"] as const).filter((key) => !env[key]?.trim());
    if (missing.length) throw new Error(`필수 환경 변수가 없습니다: ${missing.join(", ")}. .env.local에 설정하거나 npm run evals:artifacts -- --dry-run으로 모의 실행해 주세요.`);
  }
  const llm = options.dryRun ? dryRunLlm() : deps.llm ?? (async (request) => requestStructuredOutput({ ...request, timeoutMs: Math.min(request.timeoutMs ?? 240_000, 240_000) }));
  const kinds = options.kind ? [options.kind] : ARTIFACT_KINDS;
  await deps.beforeRun?.();
  const records: ArtifactEvalRecord[] = [];
  // 모델 요청은 제공자 속도 제한과 실패 원인 추적을 위해 차례로 실행한다.
  for (const { scenarioId, result } of targets) for (const kind of kinds) {
    const tier = result.recommendedTier;
    const outcome = await runArtifact(kind, { result, tier }, { catalog: deps.catalog, llm });
    records.push({ scenarioId, kind, tier, outcome, result });
  }
  return { dryRun: options.dryRun, records, exitCode: records.every(({ outcome }) => outcome.ok) ? 0 : 1 };
}

function md(value: string): string { return value.replaceAll("|", "&#124;").replace(/[\r\n]+/g, " "); }
// ADR-022: 다시 불러 통과한 결과도 첫 시도의 오류가 보여야 프롬프트 품질 변화를 놓치지 않는다.
function verdict(outcome: ArtifactOutcome): string { return `${outcome.ok ? "통과" : "실패"}${outcome.retryErrors ? " (재시도)" : ""}`; }
function errorSummary(outcome: ArtifactOutcome): string {
  return [outcome.ok ? "" : outcome.errors.join("; "), outcome.retryErrors ? `첫 시도: ${outcome.retryErrors.join("; ")}` : ""].filter(Boolean).join(" / ");
}
export function buildArtifactReport(run: ArtifactEvalRun): string {
  const groups = ARTIFACT_KINDS.map((kind) => run.records.filter(({ kind: actual }) => actual === kind));
  const knownCosts = run.records.map(({ outcome }) => outcome.usage?.costUsd).filter((value): value is number => value !== null && value !== undefined);
  const total = knownCosts.reduce((sum, value) => sum + value, 0);
  const unknown = run.records.length - knownCosts.length;
  const aggregate = run.dryRun ? "0.000000 USD" : unknown ? `미확정 (확인된 비용 ${total.toFixed(6)} USD, 비용 미제공 ${unknown}/${run.records.length}건)` : `${total.toFixed(6)} USD`;
  const lines = [
    ...(run.dryRun ? ["모의 실행: 모델을 호출하지 않았습니다", ""] : []), "# CloudSight Pro 결과물 품질·원가 보고서", "",
    "## 시나리오·종류별 결과", "", "| 시나리오 | 종류 | 안 | 자동 검증 | 토큰 (입력/출력) | 모델 비용 (USD) | 오류 |", "|---|---|---|---|---:|---:|---|",
  ];
  for (const { scenarioId, kind, tier, outcome } of run.records) {
    const tokens = outcome.usage ? `${outcome.usage.promptTokens}/${outcome.usage.completionTokens}` : run.dryRun ? "모의" : "미제공";
    const cost = run.dryRun ? "0.000000" : outcome.usage?.costUsd == null ? "미확정" : outcome.usage.costUsd.toFixed(6);
    lines.push(`| ${scenarioId} | ${kind} | ${tier} | ${verdict(outcome)} | ${tokens} | ${cost} | ${md(errorSummary(outcome)) || "—"} |`);
  }
  lines.push("", "## 종류별 평균 비용", "", "| 종류 | 실행 수 | 평균 비용 (USD) |", "|---|---:|---:|");
  for (const [index, kind] of ARTIFACT_KINDS.entries()) {
    const records = groups[index]; const costs = records.map(({ outcome }) => outcome.usage?.costUsd).filter((v): v is number => v !== null && v !== undefined);
    const average = run.dryRun ? "0.000000 USD" : records.length === 0 || costs.length !== records.length ? "미확정" : `${(costs.reduce((a, b) => a + b, 0) / costs.length).toFixed(6)} USD`;
    lines.push(`| ${kind} | ${records.length} | ${average} |`);
  }
  const retried = run.records.filter(({ outcome }) => outcome.retryErrors).length;
  lines.push("", `전체 합계: ${aggregate}`, "", `검증 재시도: ${retried}/${run.records.length}건 (첫 출력이 검증에 실패해 한 번 다시 부른 실행, 비용에 두 호출 포함)`, "", "Claude API가 제공한 토큰에 공개 단가를 적용한 비용입니다. 모델·대체 모델 단가를 확정할 수 없거나 비용이 제공되지 않으면 미확정으로 표시합니다.");
  return `${lines.join("\n")}\n`;
}

async function main() {
  const options = parseArtifactArgs(process.argv.slice(2));
  try { loadEnvFile(fileURLToPath(new URL("../.env.local", import.meta.url))); }
  catch (error) { if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw new Error(".env.local 환경 변수 파일을 읽을 수 없습니다."); }
  const startedAt = new Date();
  let directory = "";
  // 폴더를 모델 호출 전에 만들어, 동시에 시작한 실행과 이름이 겹쳐도 비용을 낸 결과를 잃지 않는다.
  const run = await runArtifactEvals(options, { catalog: loadCatalog(), beforeRun: async () => {
    directory = await createResultDirectory(fileURLToPath(new URL("../evals/results/", import.meta.url)), startedAt, "-artifacts");
  } });
  for (const { scenarioId, kind, tier, outcome, result } of run.records) {
    await writeFile(join(directory, `${scenarioId}--${kind}.json`), `${JSON.stringify({ scenarioId, kind, tier, outcome }, null, 2)}\n`, "utf8");
    if (outcome.ok) {
      // Bicep의 다운로드 파일명은 같으므로 언어 접두어로 머리말 두 버전을 모두 보존한다.
      for (const locale of ["en", "ko"] as const) {
        const file = renderArtifactFile(kind, outcome.content, { result, tier }, locale);
        await writeFile(join(directory, `${scenarioId}--${locale}--${file.filename}`), file.body, "utf8");
      }
    }
    console.log(`${scenarioId} · ${kind}: ${verdict(outcome)}${errorSummary(outcome) ? ` (${errorSummary(outcome)})` : ""}`);
  }
  const reportPath = join(directory, "report.md"); await writeFile(reportPath, buildArtifactReport(run), "utf8");
  console.log(`보고서: ${reportPath}`); process.exitCode = run.exitCode;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { await main(); } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}
