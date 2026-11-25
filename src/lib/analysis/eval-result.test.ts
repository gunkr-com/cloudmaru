import { describe, expect, it } from "vitest";
import { buildAnalysisResult } from "@/lib/analysis/build-result";
import { extractEvalResult, latestEvalResults } from "@/lib/analysis/eval-result";
import sampleInput from "@/lib/analysis/fixtures/sample-input.json";
import sampleOutput from "@/lib/analysis/fixtures/sample-model-output.json";
import { analysisInputSchema } from "@/lib/analysis/input-schema";
import { loadCatalog } from "@/lib/catalog/load";
import type { AnalysisResult } from "@/types/analysis";

const built = buildAnalysisResult(sampleOutput, analysisInputSchema.parse(sampleInput), loadCatalog());
if (!built.ok) throw new Error(built.errors.join("\n"));
const result: AnalysisResult = built.result;

function record(scenarioId: string, overrides: Record<string, unknown> = {}) {
  return {
    dryRun: false,
    scenario: { id: scenarioId, title: "회원 1만 명 예약 웹 서비스" },
    outcome: { ok: true, result, usage: null },
    report: { scenarioId, passed: true },
    ...overrides,
  };
}

describe("extractEvalResult", () => {
  it("실제 모델로 실행해 성공한 기록에서 분석 결과를 꺼낸다", () => {
    expect(extractEvalResult(record("reservation-web-app"), "reservation-web-app")).toEqual(result);
  });

  it("모의 실행 기록은 실제 모델 결과가 아니므로 버린다", () => {
    expect(extractEvalResult(record("reservation-web-app", { dryRun: true }), "reservation-web-app")).toBeNull();
  });

  it("분석에 실패한 기록은 버린다", () => {
    const failed = record("reservation-web-app", {
      outcome: { ok: false, stage: "validation", errors: ["카탈로그에 없는 구성요소"], usage: null },
    });
    expect(extractEvalResult(failed, "reservation-web-app")).toBeNull();
  });

  it("파일 이름과 기록 안의 시나리오 ID가 다르면 버린다", () => {
    expect(extractEvalResult(record("static-portfolio"), "reservation-web-app")).toBeNull();
  });

  it("세 안이 모두 있지 않거나 추천 안이 목록에 없으면 버린다", () => {
    const twoPlans = record("reservation-web-app", {
      outcome: { ok: true, result: { ...result, plans: result.plans.slice(0, 2) }, usage: null },
    });
    const duplicated = record("reservation-web-app", {
      outcome: { ok: true, result: { ...result, plans: [result.plans[0], result.plans[0], result.plans[1]] }, usage: null },
    });
    const unknownTier = record("reservation-web-app", {
      outcome: { ok: true, result: { ...result, recommendedTier: "premium" }, usage: null },
    });
    expect(extractEvalResult(twoPlans, "reservation-web-app")).toBeNull();
    expect(extractEvalResult(duplicated, "reservation-web-app")).toBeNull();
    expect(extractEvalResult(unknownTier, "reservation-web-app")).toBeNull();
  });

  it("객체가 아니거나 형태가 맞지 않는 값은 버린다", () => {
    for (const value of [null, undefined, "text", 42, [], {}, { dryRun: false }, { dryRun: false, scenario: {}, outcome: {} }]) {
      expect(extractEvalResult(value, "reservation-web-app")).toBeNull();
    }
  });
});

describe("latestEvalResults", () => {
  it("시나리오마다 가장 최근 실행의 유효한 결과를 고르고 ID 순으로 정렬한다", () => {
    const older = { ...result, requestTitle: { en: "Previous run", ko: "이전 실행" } };
    const latest = latestEvalResults([
      { runId: "2026-10-08T05-45-36-519Z", scenarioId: "reservation-web-app", record: record("reservation-web-app", { outcome: { ok: true, result: older, usage: null } }) },
      { runId: "2026-10-14T04-25-10-297Z", scenarioId: "reservation-web-app", record: record("reservation-web-app") },
      { runId: "2026-10-08T05-45-36-519Z", scenarioId: "static-portfolio", record: record("static-portfolio") },
    ]);

    expect(latest).toEqual([
      { scenarioId: "reservation-web-app", runId: "2026-10-14T04-25-10-297Z", result },
      { scenarioId: "static-portfolio", runId: "2026-10-08T05-45-36-519Z", result },
    ]);
  });

  it("최근 실행이 실패했거나 모의 실행이면 그 전의 유효한 결과로 내려간다", () => {
    const latest = latestEvalResults([
      { runId: "2026-10-14T04-25-10-297Z", scenarioId: "shoestring-mvp", record: record("shoestring-mvp", { dryRun: true }) },
      { runId: "2026-10-13T00-00-00-000Z", scenarioId: "shoestring-mvp", record: record("shoestring-mvp", { outcome: { ok: false, stage: "llm", errors: ["시간 초과"], usage: null } }) },
      { runId: "2026-10-08T05-45-36-519Z", scenarioId: "shoestring-mvp", record: record("shoestring-mvp") },
    ]);

    expect(latest).toEqual([{ scenarioId: "shoestring-mvp", runId: "2026-10-08T05-45-36-519Z", result }]);
  });

  it("유효한 결과가 하나도 없는 시나리오는 목록에서 뺀다", () => {
    expect(latestEvalResults([
      { runId: "2026-10-14T04-25-10-297Z", scenarioId: "shoestring-mvp", record: record("shoestring-mvp", { dryRun: true }) },
      { runId: "2026-10-14T04-25-10-297Z", scenarioId: "broken", record: "not json" },
    ])).toEqual([]);
  });
});

it("skips historical eval results that lack localized catalog fields", () => {
  const legacy = structuredClone(result);
  const first = legacy.plans[0];
  const old = { ...legacy, plans: [{ ...first, mermaid: first.mermaid.ko }, ...legacy.plans.slice(1)] };
  expect(extractEvalResult(record("reservation-web-app", { outcome: { ok: true, result: old } }), "reservation-web-app")).toBeNull();
});

it("미리보기도 옛 모델 설명을 복사해 두 언어로 읽는다", () => {
  const legacy = { ...result, requestTitle: "옛 제목", recommendationReason: "옛 이유", plans: result.plans.map(plan => ({ ...plan, title: "옛 안", pros: ["옛 장점"] })) };
  const parsed = extractEvalResult(record("reservation-web-app", { outcome: { ok: true, result: legacy } }), "reservation-web-app");
  expect(parsed?.requestTitle).toEqual({ en: "옛 제목", ko: "옛 제목" });
  expect(parsed?.plans[0].pros).toEqual([{ en: "옛 장점", ko: "옛 장점" }]);
  expect(legacy.requestTitle).toBe("옛 제목");
  expect(extractEvalResult(record("reservation-web-app", { outcome: { ok: true, result: { ...legacy, requestTitle: { en: "Missing" } } } }), "reservation-web-app")).toBeNull();
});
