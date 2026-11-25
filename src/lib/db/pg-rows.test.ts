import { describe, expect, it } from "vitest";
import { parsePgAnalysisRow, parsePgAnalysisListRow, parsePgArtifactRow, parsePgUsage } from "./pg-rows";
import { RowParseError } from "./pg-rows";
import sample from "@/lib/analysis/fixtures/sample-result.json";

const date = new Date("2026-11-05T00:00:00Z");
const row = { id: "a", workspace_id: "w", status: "succeeded", input: sample.input, result: sample, error_stage: null, source_analysis_id: null, created_at: date, completed_at: date };
it("maps PGlite dates and workspace and derives the recommended amount", () => {
  expect(parsePgAnalysisRow(row)).toMatchObject({ workspaceId: "w", createdAt: date.toISOString(), completedAt: date.toISOString(), result: sample });
  expect(parsePgAnalysisListRow(row)).toMatchObject({ workspaceId: "w", createdAt: date.toISOString(), recommendedTier: sample.recommendedTier, recommendedMonthly: sample.plans.find((plan) => plan.tier === sample.recommendedTier)!.cost.total });
  expect(parsePgAnalysisRow({ ...row, status: "pending", result: null, completed_at: null })).toMatchObject({ result: null, completedAt: null });
  expect(parsePgArtifactRow({ ...row, analysis_id: "a", tier: "low", kind: "guide", content: { steps: [] } })).toMatchObject({ analysisId: "a", createdAt: date.toISOString(), content: { steps: [] } });
});
it("rejects malformed rows using RowParseError", () => {
  for (const invalid of [null, [], { ...row, workspace_id: null }, { ...row, created_at: new Date(NaN) }, { ...row, input: {} }, { ...row, result: {} }, { ...row, status: "other" }, { ...row, completed_at: "invalid" }]) {
    expect(() => parsePgAnalysisRow(invalid)).toThrow(RowParseError);
  }
  expect(() => parsePgAnalysisListRow({ ...row, workspace_id: undefined })).toThrow(RowParseError);
  expect(() => parsePgArtifactRow({ ...row, analysis_id: "a", tier: "invalid", kind: "guide" })).toThrow(RowParseError);
});
it("accepts valid usage including unknown cost and rejects malformed usage", () => {
  const usage = { promptTokens: 10, completionTokens: 0, costUsd: 0.2 };
  expect(parsePgUsage(usage)).toEqual(usage);
  expect(parsePgUsage({ ...usage, costUsd: null })).toEqual({ ...usage, costUsd: null });
  for (const invalid of [null, {}, [], { ...usage, promptTokens: -1 }, { ...usage, completionTokens: 1.5 }, { ...usage, costUsd: Infinity }, { ...usage, costUsd: -1 }, { ...usage, promptTokens: "10" }, { ...usage, costUsd: undefined }]) expect(parsePgUsage(invalid)).toBeNull();
});

const input = { description: "예약 서비스를 위한 웹앱입니다", expectedUsers: "under-1k", monthlyBudget: 30000, region: "canadacentral", availability: "medium" };
const plans = (["low", "balanced", "ha"] as const).map((tier, index) => ({ tier, title: { en: "Option", ko: "안" }, pros: [{ en: "Pro", ko: "장점" }], cost: { currency: "CAD", total: (index + 1) * 1000 } }));
const result = { region: "canadacentral", currency: "CAD", requestTitle: { en: "Reservation service", ko: "예약 서비스" }, input, outOfScope: false, recommendedTier: "balanced", recommendationReason: { en: "Balanced configuration", ko: "균형 구성" }, priceAsOf: "2026-10-14", plans };
const analysis = { workspace_id: "w", id: "a", status: "succeeded", input, result, error_stage: null, source_analysis_id: "b", created_at: "2026-10-14T00:00:00Z", completed_at: "2026-10-14T00:01:00Z" };

describe("database row parsers", () => {
  it("maps analysis rows and accepts null result", () => {
    expect(parsePgAnalysisRow(analysis)).toMatchObject({ errorStage: null, sourceAnalysisId: "b", createdAt: analysis.created_at, result });
    expect(parsePgAnalysisRow({ ...analysis, status: "pending", result: null }).result).toBeNull();
  });
  it("rejects invalid statuses, tiers, kinds, and inputs without leaking input text", () => {
    expect(() => parsePgAnalysisRow({ ...analysis, status: "wat" })).toThrow(RowParseError);
    expect(() => parsePgAnalysisRow({ ...analysis, input: { ...input, description: "PRIVATE USER TEXT", expectedUsers: "invalid" } })).toThrow(RowParseError);
    expect(() => parsePgAnalysisRow({ ...analysis, result: { ...result, recommendedTier: "wat" } })).toThrow(RowParseError);
    expect(() => parsePgArtifactRow({ id: "x", analysis_id: "a", tier: "wat", kind: "guide", status: "pending", content: null, created_at: analysis.created_at, completed_at: null })).toThrow(RowParseError);
    expect(() => parsePgArtifactRow({ id: "x", analysis_id: "a", tier: "low", kind: "wat", status: "pending", content: null, created_at: analysis.created_at, completed_at: null })).toThrow(RowParseError);
    try { parsePgAnalysisRow({ ...analysis, input: { ...input, description: "PRIVATE USER TEXT", expectedUsers: "invalid" } }); } catch (error) { expect((error as Error).message).not.toContain("PRIVATE USER TEXT"); }
  });
  it("derives the recommended amount for list items", () => {
    expect(parsePgAnalysisListRow(analysis)).toMatchObject({ requestTitle: { en: "Reservation service", ko: "예약 서비스" }, recommendedTier: "balanced", recommendedMonthly: 2000, sourceAnalysisId: "b" });
    expect(parsePgAnalysisListRow({ ...analysis, status: "pending", result: null })).toMatchObject({ requestTitle: null, recommendedTier: null, recommendedMonthly: null });
  });
});

it("rejects stored legacy cost shapes and non-CAD result metadata", () => {
  const legacy = { ...sample, currency: "USD", region: "canadacentral" };
  expect(() => parsePgAnalysisListRow({ workspace_id: "w", id: "a", status: "succeeded", input: sample.input, result: legacy, source_analysis_id: null, created_at: new Date() })).toThrow();
});

it("normalizes legacy analysis prose without mutating stored objects", () => {
  const stored = { ...sample, requestTitle: "옛 제목", recommendationReason: "옛 이유", plans: sample.plans.map(plan => ({ ...plan, title: "옛 안", pros: ["옛 장점"] })) };
  const before = structuredClone(stored);
  const parsed = parsePgAnalysisRow({ ...row, result: stored }).result!;
  expect(parsed.requestTitle).toEqual({ en: "옛 제목", ko: "옛 제목" });
  expect(parsed.recommendationReason).toEqual({ en: "옛 이유", ko: "옛 이유" });
  expect(parsed.plans[0]).toMatchObject({ title: { en: "옛 안", ko: "옛 안" }, pros: [{ en: "옛 장점", ko: "옛 장점" }] });
  expect(parsePgAnalysisListRow({ ...row, result: stored }).requestTitle).toEqual(parsed.requestTitle);
  expect(stored).toEqual(before);
  expect(parsed).not.toBe(stored);
});

it.each(["requestTitle", "recommendationReason", "title", "pro"])("rejects malformed stored localized %s in detail and history", field => {
  const stored = structuredClone(sample);
  const invalid = { en: "Missing Korean" };
  const broken = field === "title" ? { ...stored, plans: [{ ...stored.plans[0], title: invalid }, ...stored.plans.slice(1)] }
    : field === "pro" ? { ...stored, plans: [{ ...stored.plans[0], pros: [invalid] }, ...stored.plans.slice(1)] }
    : { ...stored, [field]: invalid };
  expect(() => parsePgAnalysisRow({ ...row, result: broken })).toThrow(RowParseError);
  expect(() => parsePgAnalysisListRow({ ...row, result: broken })).toThrow(RowParseError);
});
