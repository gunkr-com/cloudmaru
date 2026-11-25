// 호출하는 쪽이 분석 상태와 이미 만든 결과물 재사용 여부를 먼저 판정해야 한다.
import { buildArtifactPrompt } from "@/lib/artifacts/prompt";
import { ARTIFACT_JSON_SCHEMAS, ARTIFACT_SCHEMA_NAMES } from "@/lib/artifacts/schemas";
import { validateArtifact } from "@/lib/artifacts/validate";
import { requestWithValidationRetry } from "@/lib/llm/validation-retry";
import type { AnalysisResult, StructuredLlm } from "@/types/analysis";
import type { ArtifactKind, ArtifactOutcome } from "@/types/artifact";
import type { Catalog, Tier } from "@/types/catalog";

const artifactKinds: readonly string[] = ["guide", "evaluation", "bicep"];
const tiers: readonly string[] = ["low", "balanced", "ha"];

export async function runArtifact<K extends ArtifactKind>(
  kind: K,
  target: { result: AnalysisResult; tier: Tier },
  deps: { catalog: Catalog; llm: StructuredLlm },
): Promise<ArtifactOutcome<K>> {
  if (!artifactKinds.includes(kind)) {
    return { ok: false, stage: "input", errors: ["결과물 종류가 올바르지 않습니다."], usage: null };
  }
  if (!tiers.includes(target.tier) || !target.result.plans.some(({ tier }) => tier === target.tier)) {
    return { ok: false, stage: "input", errors: ["분석 결과에서 선택한 안을 찾을 수 없습니다."], usage: null };
  }

  let prompt: ReturnType<typeof buildArtifactPrompt>;
  try {
    prompt = buildArtifactPrompt(kind, target, deps.catalog);
  } catch {
    return { ok: false, stage: "input", errors: ["분석 결과 또는 카탈로그 구성이 올바르지 않습니다."], usage: null };
  }

  const plan = target.result.plans.find(({ tier }) => tier === target.tier)!;
  const response = await requestWithValidationRetry(
    deps.llm,
    { ...prompt, schemaName: ARTIFACT_SCHEMA_NAMES[kind], jsonSchema: ARTIFACT_JSON_SCHEMAS[kind] },
    (data) => {
      const validated = validateArtifact(kind, data, { plan, catalog: deps.catalog, region: target.result.region });
      return validated.ok ? { ok: true, value: validated.content } : validated;
    },
  );
  if (response.kind === "llm-error") {
    return {
      ok: false,
      stage: "llm",
      errors: ["구축 결과물을 만들지 못했습니다. 잠시 후 다시 시도해 주세요."],
      usage: response.usage ?? null,
    };
  }

  const retry = response.retryErrors ? { retryErrors: response.retryErrors } : {};
  if (response.kind === "invalid") return { ok: false, stage: "validation", errors: response.errors, usage: response.usage, ...retry };
  return { ok: true, kind, content: response.value, usage: response.usage, ...retry };
}
