import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { loadEnvFile } from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { checkScenario, type ScenarioReport } from "../evals/check-scenario";
import { createResultDirectory } from "../evals/result-directory";
import { loadScenarios, type EvalScenario } from "../evals/scenario-schema";
import sampleOutput from "../src/lib/analysis/fixtures/sample-model-output.json";
import { TIER_LABELS } from "../src/lib/analysis/input-schema";
import { runAnalysis } from "../src/lib/analysis/run-analysis";
import { loadCatalog } from "../src/lib/catalog/load";
import { formatBudgetRatio } from "../src/lib/cost/format";
import { formatMoney } from "../src/i18n/format";
import { requestStructuredOutput } from "../src/services/claude";
import type { AnalysisOutcome, StructuredLlm } from "../src/types/analysis";
import type { Catalog, Tier } from "../src/types/catalog";

export type EvalOptions = { dryRun: boolean; scenarioId?: string };
export type EvalRecord = { scenario: EvalScenario; outcome: AnalysisOutcome; report: ScenarioReport };
export type EvalRun = { dryRun: boolean; records: EvalRecord[]; exitCode: 0 | 1 };
type EvalEnvironment = { ANTHROPIC_API_KEY?: string; CLAUDE_MODEL?: string };

export function parseArgs(args: string[]): EvalOptions {
  const options: EvalOptions = { dryRun: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--dry-run" && !options.dryRun) {
      options.dryRun = true;
    } else if (arg === "--scenario" && options.scenarioId === undefined) {
      const id = args[++index];
      if (!id || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(id)) {
        throw new Error("--scenario 다음에 영문 kebab-case 시나리오 ID를 입력해 주세요.");
      }
      options.scenarioId = id;
    } else {
      throw new Error(`알 수 없거나 중복된 인자: ${arg}. 사용법: npm run evals -- [--dry-run] [--scenario <id>]`);
    }
  }
  return options;
}

// 개발자가 고정 시나리오를 평가하는 로컬 명령이다. 사용자 API의 인증·한도 판정 경로로 쓰지 않는다.
// 파일 쓰기 없이 결과를 반환한다. 선택적으로 입력 검증 뒤 첫 모델 호출 전에 준비 콜백을, 각 결과마다 저장 콜백을 기다린다.
export async function runEvals(options: EvalOptions, deps: {
  scenarios: EvalScenario[];
  catalog: Catalog;
  env?: EvalEnvironment;
  llm?: StructuredLlm;
  beforeRun?: () => void | Promise<void>;
  onScenario?: (record: EvalRecord) => void | Promise<void>;
}): Promise<EvalRun> {
  const scenarios = options.scenarioId === undefined ? deps.scenarios
    : deps.scenarios.filter(({ id }) => id === options.scenarioId);
  if (scenarios.length === 0) throw new Error(`실행할 시나리오가 없습니다: ${options.scenarioId ?? "전체"}`);

  if (!options.dryRun) {
    const env = deps.env ?? process.env;
    const missing = (["ANTHROPIC_API_KEY", "CLAUDE_MODEL"] as const).filter((key) => !env[key]?.trim());
    if (missing.length > 0) {
      throw new Error(`필수 환경 변수가 없습니다: ${missing.join(", ")}. .env.local에 설정하거나 npm run evals -- --dry-run으로 모의 실행해 주세요.`);
    }
  }
  const llm: StructuredLlm = options.dryRun
    ? async () => ({ data: sampleOutput, usage: null })
    : deps.llm ?? requestStructuredOutput;
  await deps.beforeRun?.();
  const records: EvalRecord[] = [];
  // 제공자 속도 제한을 피하고 실패 원인을 추적하기 위해 동시 실행·재시도를 하지 않는다.
  for (const scenario of scenarios) {
    const outcome = await runAnalysis(scenario.input, { catalog: deps.catalog, llm });
    const record = { scenario, outcome, report: checkScenario(scenario, outcome) };
    records.push(record);
    await deps.onScenario?.(record);
  }
  return { dryRun: options.dryRun, records, exitCode: !options.dryRun && records.some(({ report }) => !report.passed) ? 1 : 0 };
}

function markdownText(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll("|", "&#124;").replace(/\r?\n/g, "<br>");
}

export function buildReport(run: EvalRun): string {
  const { records, dryRun } = run;
  const passed = records.filter(({ report }) => report.passed).length;
  const knownCosts = records.flatMap(({ report }) => report.usage?.costUsd == null ? [] : [report.usage.costUsd]);
  const knownTotal = knownCosts.reduce((total, cost) => total + cost, 0);
  const missingCosts = records.length - knownCosts.length;
  const totalCost = dryRun ? 0 : knownTotal;
  const completeCosts = dryRun || missingCosts === 0;
  const lines = [
    ...(dryRun ? ["모의 실행: 모델을 호출하지 않았습니다", ""] : []),
    "# CloudSight 분석 품질 보고서", "",
    ...(dryRun ? ["같은 샘플 모델 출력을 모든 입력에 적용하므로 자동 점검 실패는 정상입니다. 실제 모델 품질이나 원가를 측정한 결과가 아닙니다.", ""] : []),
    `- 통과 수: ${passed}/${records.length}`,
    `- 검증 재시도: ${records.filter(({ outcome }) => outcome.retryErrors).length}/${records.length} (첫 출력이 검증에 실패해 한 번 다시 부른 시나리오, 비용에 두 호출 포함)`,
    `- 총 비용 (USD): ${completeCosts ? `${totalCost.toFixed(6)} USD` : `미확정 (확인된 비용 ${knownTotal.toFixed(6)} USD, 비용 미제공 ${missingCosts}/${records.length}건)`}`,
    `- 시나리오당 평균 비용 (USD): ${completeCosts && records.length > 0 ? `${(totalCost / records.length).toFixed(6)} USD` : "미확정"}`,
    "",
    "모델 비용은 Claude API가 반환한 토큰 수에 Anthropic 공개 단가를 곱해 계산한 USD이며 분석·검증 실패 호출도 포함합니다. 단가표에 없는 모델이나 대체 모델이 응답한 호출은 비용을 확정하지 않으며, 그런 호출이 있으면 총 비용과 평균은 미확정입니다. Azure 구성 비용은 가격 스냅샷으로 계산한 CAD 견적입니다.",
    "",
    "## 시나리오별 결과", "",
    "안별 금액 괄호는 예산 대비 비율입니다.", "",
    "| 시나리오 | 자동 점검 | 월 예산 | 최저 비용 | 균형 | 고가용성 | 추천 안 |",
    "|---|---|---:|---:|---:|---:|---|",
  ];
  for (const { scenario, outcome, report } of records) {
    const cost = (tier: Tier) => report.totals === null ? "결과 없음"
      : `${formatMoney(report.totals[tier], "CAD", "ko")} (${formatBudgetRatio(report.totals[tier] / scenario.input.monthlyBudget)})`;
    lines.push(`| ${scenario.id} · ${markdownText(scenario.title)} | ${report.passed ? "통과" : "실패"}${outcome.retryErrors ? " (재시도)" : ""} | ${formatMoney(scenario.input.monthlyBudget, "CAD", "ko")} | ${cost("low")} | ${cost("balanced")} | ${cost("ha")} | ${outcome.ok ? TIER_LABELS[outcome.result.recommendedTier].ko : "결과 없음"} |`);
  }
  lines.push("", "## 모델 사용량", "",
    "| 시나리오 | 입력 토큰 | 출력 토큰 | 모델 비용 (USD) |",
    "|---|---:|---:|---:|");
  for (const { scenario, report } of records) {
    const usage = report.usage;
    const unavailable = dryRun ? "해당 없음 (모의)" : "미제공";
    lines.push(`| ${scenario.id} | ${usage?.promptTokens ?? unavailable} | ${usage?.completionTokens ?? unavailable} | ${dryRun ? "0.000000" : usage?.costUsd == null ? unavailable : usage.costUsd.toFixed(6)} |`);
  }
  lines.push("", "## 실패한 점검과 수동 확인 사항", "");
  for (const { scenario, outcome, report } of records) {
    lines.push(`### ${scenario.id} · ${markdownText(scenario.title)}`, "",
      `- 수동 확인: ${markdownText(scenario.expect.notes)}`,
      `- 가격 기준일: ${outcome.ok ? outcome.result.priceAsOf : "결과 없음"}`,
      ...(outcome.retryErrors ? [`- 첫 시도 검증 오류: ${markdownText(outcome.retryErrors.join("; "))}`] : []));
    if (outcome.ok) {
      const result = outcome.result;
      for (const locale of ["en", "ko"] as const) {
        lines.push(`- ${locale} 요청 제목: ${markdownText(result.requestTitle[locale])}`,
          `- ${locale} 추천 이유: ${markdownText(result.recommendationReason[locale])}`);
        for (const plan of result.plans) {
          lines.push(`- ${TIER_LABELS[plan.tier][locale]} (${locale}): ${markdownText(plan.title[locale])}`,
            ...plan.pros.map(pro => `  - ${markdownText(pro[locale])}`));
        }
      }
    }
    const failed = report.checks.filter(({ passed }) => !passed);
    if (failed.length === 0) lines.push(`- 자동 점검 ${report.checks.length}개 모두 통과`);
    else for (const check of failed) lines.push(`- 실패 — ${check.name}: ${markdownText(check.detail)}`);
    lines.push("");
  }
  return lines.join("\n");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  try {
    loadEnvFile(fileURLToPath(new URL("../.env.local", import.meta.url)));
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) {
      throw new Error(".env.local 환경 변수 파일을 읽을 수 없습니다.");
    }
  }
  const startedAt = new Date();
  let directory = "";
  const run = await runEvals(options, {
    scenarios: loadScenarios(),
    catalog: loadCatalog(),
    // 폴더를 모델 호출 전에 만들어, 동시에 시작한 실행과 이름이 겹쳐도 비용을 낸 결과를 잃지 않는다.
    beforeRun: async () => {
      directory = await createResultDirectory(fileURLToPath(new URL("../evals/results/", import.meta.url)), startedAt);
    },
    onScenario: async (record) => {
      await writeFile(join(directory, `${record.scenario.id}.json`), `${JSON.stringify({ dryRun: options.dryRun, ...record }, null, 2)}\n`, "utf8");
      const failed = record.report.checks.filter(({ passed }) => !passed).map(({ name }) => name);
      if (record.outcome.ok) {
        const result = record.outcome.result;
        console.log(JSON.stringify({ requestTitle: result.requestTitle, recommendationReason: result.recommendationReason,
          plans: result.plans.map(({ tier, title, pros }) => ({ tier, title, pros })) }, null, 2));
      }
      console.log(`${record.scenario.id}: ${record.report.passed ? "통과" : `실패 (${failed.join(", ")})`}`);
    },
  });
  const reportPath = join(directory, "report.md");
  await writeFile(reportPath, buildReport(run), "utf8");
  console.log(`보고서: ${reportPath}`);
  process.exitCode = run.exitCode;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
