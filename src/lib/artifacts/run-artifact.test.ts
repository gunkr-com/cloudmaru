import { describe, expect, it, vi } from "vitest";
import { buildAnalysisResult } from "@/lib/analysis/build-result";
import sampleInput from "@/lib/analysis/fixtures/sample-input.json";
import sampleOutput from "@/lib/analysis/fixtures/sample-model-output.json";
import guideFixture from "@/lib/artifacts/fixtures/sample-guide-output.json";
import evaluationFixture from "@/lib/artifacts/fixtures/sample-evaluation-output.json";
import bicepFixture from "@/lib/artifacts/fixtures/sample-bicep-output.json";
import { ARTIFACT_JSON_SCHEMAS, ARTIFACT_SCHEMA_NAMES } from "@/lib/artifacts/schemas";
import { loadCatalog } from "@/lib/catalog/load";
import { runArtifact } from "@/lib/artifacts/run-artifact";
import { analysisInputSchema } from "@/lib/analysis/input-schema";
import type { StructuredLlm, AnalysisResult } from "@/types/analysis";
import type { ArtifactKind, EvaluationContent } from "@/types/artifact";
import type { Tier } from "@/types/catalog";

const catalog = loadCatalog();
const built = buildAnalysisResult(sampleOutput, analysisInputSchema.parse(sampleInput), catalog);
if (!built.ok) throw new Error(built.errors.join("\n"));
const result = built.result;
const usage = { promptTokens: 12, completionTokens: 34, costUsd: 0.01 };
const fixtures = { guide: guideFixture, evaluation: evaluationFixture, bicep: bicepFixture };

describe("runArtifact", () => {
  it.each(["guide", "evaluation", "bicep"] as const)("검증된 %s 결과를 반환하고 정확한 스키마로 한 번 호출한다", async (kind) => {
    const llm = vi.fn<StructuredLlm>().mockResolvedValue({ data: fixtures[kind], usage });
    const outcome = await runArtifact(kind, { result, tier: "balanced" }, { catalog, llm });
    expect(outcome).toEqual({ ok: true, kind, content: expect.any(Object), usage });
    expect(llm).toHaveBeenCalledTimes(1);
    expect(llm).toHaveBeenCalledWith(expect.objectContaining({ schemaName: ARTIFACT_SCHEMA_NAMES[kind], jsonSchema: ARTIFACT_JSON_SCHEMAS[kind] }));
    if (kind === "evaluation" && outcome.ok) expect((outcome.content as EvaluationContent).axes.map(({ axis }) => axis)).toEqual(["reliability", "security", "cost", "operations", "performance"]);
  });

  it("잘못된 종류·없는 안·카탈로그에 없는 서비스에서는 모델을 호출하지 않는다", async () => {
    const llm = vi.fn<StructuredLlm>();
    expect(await runArtifact("unknown" as ArtifactKind, { result, tier: "balanced" }, { catalog, llm })).toMatchObject({ ok: false, stage: "input" });
    expect(await runArtifact("guide", { result, tier: "unknown" as Tier }, { catalog, llm })).toMatchObject({ ok: false, stage: "input" });
    const invalid: AnalysisResult = { ...result, plans: result.plans.map((plan) => plan.tier === "balanced" ? { ...plan, services: [{ ...plan.services[0]!, componentId: "missing" }] } : plan) };
    expect(await runArtifact("guide", { result: invalid, tier: "balanced" }, { catalog, llm })).toMatchObject({ ok: false, stage: "input" });
    expect(llm).not.toHaveBeenCalled();
  });

  it("LLM 예외 상세를 숨기고, 검증 실패는 한 번만 다시 부르며 두 호출의 usage를 합친다", async () => {
    const failing = vi.fn<StructuredLlm>().mockRejectedValue(new Error("secret key and response body"));
    const failed = await runArtifact("guide", { result, tier: "balanced" }, { catalog, llm: failing });
    expect(failed).toMatchObject({ ok: false, stage: "llm", errors: ["구축 결과물을 만들지 못했습니다. 잠시 후 다시 시도해 주세요."], usage: null });
    expect(JSON.stringify(failed)).not.toContain("secret key");
    expect(failing).toHaveBeenCalledTimes(1);
    const invalid = vi.fn<StructuredLlm>().mockResolvedValue({ data: {}, usage });
    expect(await runArtifact("guide", { result, tier: "balanced" }, { catalog, llm: invalid })).toMatchObject({
      ok: false, stage: "validation", usage: { promptTokens: 24, completionTokens: 68, costUsd: 0.02 }, retryErrors: expect.any(Array),
    });
    expect(invalid).toHaveBeenCalledTimes(2);
  });

  it.each(["guide", "evaluation", "bicep"] as const)("%s 실패 응답의 청구 사용량과 미확정 단가를 보존한다", async (kind) => {
    for (const reportedUsage of [usage, { ...usage, costUsd: null }]) {
      const error = Object.assign(new Error("private-response-sentinel"), { usage: reportedUsage });
      const llm = vi.fn<StructuredLlm>().mockRejectedValue(error);
      const outcome = await runArtifact(kind, { result, tier: "balanced" }, { catalog, llm });
      expect(outcome).toMatchObject({ ok: false, stage: "llm", usage: reportedUsage });
      expect(JSON.stringify(outcome)).not.toContain("private-response-sentinel");
      expect(outcome).not.toHaveProperty("content");
      expect(llm).toHaveBeenCalledTimes(1);
    }
  });

  // ADR-022: 실제 eval에서 @secure() 위치·한국어 글자 수 때문에 결과물 27회 중 5회가 통째로 실패했다.
  it("검증에 실패한 첫 출력 뒤 다시 부른 출력이 맞으면 그 결과와 첫 오류를 돌려준다", async () => {
    const llm = vi.fn<StructuredLlm>()
      .mockResolvedValueOnce({ data: { ...bicepFixture, code: bicepFixture.code.replace("'canadacentral'", "'eastus'") }, usage })
      .mockResolvedValueOnce({ data: bicepFixture, usage });
    const outcome = await runArtifact("bicep", { result, tier: "balanced" }, { catalog, llm });
    expect(outcome).toMatchObject({ ok: true, kind: "bicep", usage: { promptTokens: 24, completionTokens: 68, costUsd: 0.02 } });
    expect(outcome.retryErrors).toEqual(expect.arrayContaining([expect.stringContaining("location")]));
    expect(llm).toHaveBeenCalledTimes(2);
    expect(llm.mock.calls[1][0]).toMatchObject({ schemaName: ARTIFACT_SCHEMA_NAMES.bicep, jsonSchema: ARTIFACT_JSON_SCHEMAS.bicep, user: expect.stringContaining("<validation_errors>") });
  });
});

it("passes the result region to both the prompt and validation", async () => {
  const region = "customregion";
  const llm = vi.fn<StructuredLlm>().mockResolvedValue({ data: { ...bicepFixture, code: bicepFixture.code.replace("'canadacentral'", `'${region}'`) }, usage });
  const outcome = await runArtifact("bicep", { result: { ...result, region }, tier: "balanced" }, { catalog, llm });
  expect(outcome.ok).toBe(true);
  expect(llm).toHaveBeenCalledWith(expect.objectContaining({ system: expect.stringContaining(`param location string = '${region}'`) }));
  llm.mockResolvedValue({ data: bicepFixture, usage });
  expect(await runArtifact("bicep", { result: { ...result, region }, tier: "balanced" }, { catalog, llm })).toMatchObject({ ok: false, stage: "validation" });
});
