import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AnalysisResultView } from "@/components/analysis/analysis-result-view";
import { buildAnalysisResult } from "@/lib/analysis/build-result";
import { latestEvalResults, type EvalResultEntry, type EvalResultFile } from "@/lib/analysis/eval-result";
import sampleInput from "@/lib/analysis/fixtures/sample-input.json";
import sampleOutput from "@/lib/analysis/fixtures/sample-model-output.json";
import { analysisInputSchema } from "@/lib/analysis/input-schema";
import { getI18n } from "@/i18n/server";
import { loadCatalog } from "@/lib/catalog/load";

// 개발 중에만 `npm run evals`가 저장한 실제 모델 결과(git 제외)를 함께 보여 준다.
async function loadEvalResults(): Promise<EvalResultEntry[]> {
  if (process.env.NODE_ENV === "production") return [];
  const resultsDir = join(process.cwd(), "evals", "results");
  const runIds = await readdir(resultsDir).catch(() => []);
  const files: EvalResultFile[] = [];
  for (const runId of runIds) {
    const names = await readdir(join(resultsDir, runId)).catch(() => []);
    for (const name of names.filter((file) => file.endsWith(".json"))) {
      const text = await readFile(join(resultsDir, runId, name), "utf8").catch(() => "");
      let record: unknown = null;
      try {
        record = JSON.parse(text);
      } catch {
        // 깨진 파일은 목록에서 빠진다.
      }
      files.push({ runId, scenarioId: name.slice(0, -".json".length), record });
    }
  }
  return latestEvalResults(files);
}

export default async function AnalysisPreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { t } = await getI18n();
  const { scenario } = await searchParams;
  if (Array.isArray(scenario)) notFound();
  const evalResults = await loadEvalResults();

  let caption = t("analysis.preview.sampleCaption");
  let result;
  if (scenario === undefined) {
    const outcome = buildAnalysisResult(sampleOutput, analysisInputSchema.parse(sampleInput), loadCatalog());
    if (!outcome.ok) {
      throw new Error(`Preview sample validation failed:\n${outcome.errors.join("\n")}`);
    }
    result = outcome.result;
  } else {
    const entry = evalResults.find(({ scenarioId }) => scenarioId === scenario);
    if (!entry) notFound();
    caption = t("analysis.preview.savedCaption", { path: `evals/results/${entry.runId}/${entry.scenarioId}.json` });
    result = entry.result;
  }

  return (
    <main className="min-w-0 space-y-10 px-10 pt-7 pb-12">
      <div className="space-y-2">
        <p className="text-[13px] leading-[1.6] text-subtle">{caption}</p>
        {evalResults.length > 0 && (
          <nav aria-label={t("analysis.preview.navigation")} className="flex flex-wrap gap-x-4 gap-y-1.5 text-[13px] leading-[1.6] text-muted">
            <Link href="/analyses/preview" aria-current={scenario === undefined ? "page" : undefined} className="underline-offset-[3px] hover:text-ink aria-[current=page]:text-ink aria-[current=page]:underline">
              {t("analysis.preview.sample")}
            </Link>
            {evalResults.map(({ scenarioId }) => (
              <Link
                key={scenarioId}
                href={`/analyses/preview?scenario=${scenarioId}`}
                aria-current={scenario === scenarioId ? "page" : undefined}
                className="underline-offset-[3px] hover:text-ink aria-[current=page]:text-ink aria-[current=page]:underline"
              >
                {scenarioId}
              </Link>
            ))}
          </nav>
        )}
      </div>
      <AnalysisResultView key={scenario ?? "sample"} result={result} showBuildAction rerunHref="/analyses/preview/form" />
    </main>
  );
}
