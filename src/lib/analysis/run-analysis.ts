// 호출하는 쪽이 입력 검증과 분석 예약(pending 행)을 먼저 끝내야 한다.
import { buildAnalysisResult } from "@/lib/analysis/build-result";
import { analysisInputSchema } from "@/lib/analysis/input-schema";
import { MODEL_OUTPUT_JSON_SCHEMA, MODEL_OUTPUT_SCHEMA_NAME } from "@/lib/analysis/model-output-schema";
import { buildAnalysisPrompt } from "@/lib/analysis/prompt";
import { requestWithValidationRetry } from "@/lib/llm/validation-retry";
import type { AnalysisOutcome, StructuredLlm } from "@/types/analysis";
import type { Catalog } from "@/types/catalog";

export async function runAnalysis(
  input: unknown,
  deps: { catalog: Catalog; llm: StructuredLlm },
): Promise<AnalysisOutcome> {
  const parsed = analysisInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      stage: "input",
      errors: parsed.error.issues.map((issue) => issue.message),
      usage: null,
    };
  }

  const prompt = buildAnalysisPrompt(parsed.data, deps.catalog);
  const response = await requestWithValidationRetry(
    deps.llm,
    { ...prompt, schemaName: MODEL_OUTPUT_SCHEMA_NAME, jsonSchema: MODEL_OUTPUT_JSON_SCHEMA },
    (data) => {
      const built = buildAnalysisResult(data, parsed.data, deps.catalog);
      return built.ok ? { ok: true, value: built.result } : built;
    },
  );
  if (response.kind === "llm-error") {
    // 원본 예외에는 키나 응답 본문이 포함될 수 있으므로 전달하지 않는다.
    return {
      ok: false,
      stage: "llm",
      errors: ["분석 요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요."],
      usage: response.usage ?? null,
    };
  }

  const retry = response.retryErrors ? { retryErrors: response.retryErrors } : {};
  if (response.kind === "invalid") {
    return { ok: false, stage: "validation", errors: response.errors, usage: response.usage, ...retry };
  }
  return { ok: true, result: response.value, usage: response.usage, ...retry };
}
