// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import input from "@/lib/analysis/fixtures/sample-input.json";
import output from "@/lib/analysis/fixtures/sample-model-output.json";
import { buildAnalysisResult as buildResult } from "@/lib/analysis/build-result";
import { buildArtifactDownloadHref, parseStoredArtifactContent, requestArtifact, runArtifactJob, toArtifactView, toArtifactViews, ARTIFACT_MESSAGES } from "./artifact-job";
import { loadCatalog } from "@/lib/catalog/load";
import { ARTIFACT_KINDS } from "./labels";
import guide from "./fixtures/sample-guide-output.json";
import evaluation from "./fixtures/sample-evaluation-output.json";
import bicep from "./fixtures/sample-bicep-output.json";
import type { AnalysisRecord, ArtifactRecord } from "@/types/db";
import { analysisInputSchema } from "@/lib/analysis/input-schema";
import { validationLimit } from "@/lib/llm/localized-text";
import type { ArtifactJob } from "./artifact-job";

const catalog = loadCatalog();
const parsedInput = analysisInputSchema.parse(input);
const built = buildResult(output, parsedInput, catalog);
if (!built.ok) throw new Error("test analysis fixture invalid");
const result = built.result;
const id = "11111111-1111-4111-8111-111111111111";
const analysis: AnalysisRecord = { id, workspaceId: "other-workspace", status: "succeeded", input: parsedInput, result, errorStage: null, sourceAnalysisId: null, createdAt: "2026-01-01T00:00:00.000Z", completedAt: "2026-01-01T00:00:01.000Z" };
const sampleArtifacts = { guide, evaluation: { summary: evaluation.summary, axes: [
  { axis: "reliability", ...evaluation.reliability }, { axis: "security", ...evaluation.security }, { axis: "cost", ...evaluation.cost },
  { axis: "operations", ...evaluation.operations }, { axis: "performance", ...evaluation.performance },
] }, bicep };
const guideContent = sampleArtifacts.guide;
const record = (kind: ArtifactRecord["kind"], status: ArtifactRecord["status"] = "succeeded", content: unknown = sampleArtifacts[kind]): ArtifactRecord => ({ id: "a", analysisId: id, tier: "balanced", kind, status, content, createdAt: "2026-01-01T00:00:00.000Z", completedAt: "2026-01-01T00:01:00.000Z" });
function deps(overrides: Partial<Parameters<typeof requestArtifact>[1]> = {}) {
  const calls: string[] = [];
  const scheduled: (() => Promise<void>)[] = [];
  const d: Parameters<typeof requestArtifact>[1] = {
    hasWorkspaceClaudeKey: vi.fn(async () => true),
    getAnalysis: vi.fn(async () => analysis), listArtifacts: vi.fn(async () => []),
    reserveArtifact: vi.fn(async () => ({ ok: true as const, id: "job", status: "pending" as const, created: true })),
    schedule: vi.fn((task) => { scheduled.push(task); }), runJob: vi.fn(async () => {}), ...overrides,
  };
  return { d, calls, scheduled };
}

describe("requestArtifact", () => {
  it("checks the saved analysis owner before reserving a new artifact", async () => {
    const { d } = deps({ hasWorkspaceClaudeKey: vi.fn(async () => false) });
    expect(await requestArtifact({ analysisId: id, body: { tier: "balanced", kind: "guide" }, now: new Date() }, d)).toEqual({ status: 409, message: "workspace.claude.unavailable", workspaceId: "other-workspace" });
    expect(d.hasWorkspaceClaudeKey).toHaveBeenCalledWith("other-workspace");
    expect(d.reserveArtifact).not.toHaveBeenCalled();
    expect(d.schedule).not.toHaveBeenCalled();
  });
  it("keeps stored artifacts available when the company key is unset", async () => {
    const { d } = deps({ hasWorkspaceClaudeKey: vi.fn(async () => false), listArtifacts: vi.fn(async () => [record("guide")]) });
    expect((await requestArtifact({ analysisId: id, body: { tier: "balanced", kind: "guide" }, now: new Date() }, d)).status).toBe(200);
    expect(d.hasWorkspaceClaudeKey).not.toHaveBeenCalled();
    expect(d.reserveArtifact).not.toHaveBeenCalled();
  });
  it("reserves without a user or plan and schedules the job", async () => {
    const { d, scheduled } = deps();
    const now = new Date("2026-01-01T00:00:00Z");
    expect((await requestArtifact({ analysisId: id, body: { tier: "balanced", kind: "guide" }, now }, d)).status).toBe(202);
    expect(d.reserveArtifact).toHaveBeenCalledWith({ analysisId: id, tier: "balanced", kind: "guide", staleBefore: new Date(now.getTime() - 330_000) });
    await scheduled[0]();
    expect(d.runJob).toHaveBeenCalledWith({ id: "job", tier: "balanced", kind: "guide", result });
  });
  it("reuses an existing valid success", async () => {
    const { d } = deps({ listArtifacts: vi.fn(async () => [record("guide")]) });
    expect((await requestArtifact({ analysisId: id, body: { tier: "balanced", kind: "guide" }, now: new Date() }, d)).status).toBe(200);
    expect(d.reserveArtifact).not.toHaveBeenCalled();
  });
  it("validates UUID, body, analysis and tier", async () => {
    const { d } = deps();
    expect((await requestArtifact({ analysisId: "bad", body: {}, now: new Date() }, d)).status).toBe(404);
    expect(d.getAnalysis).not.toHaveBeenCalled();
    expect((await requestArtifact({ analysisId: id, body: { tier: "bad", kind: "guide" }, now: new Date() }, d)).status).toBe(400);
    expect((await requestArtifact({ analysisId: id, body: { tier: "low", kind: "unknown" }, now: new Date() }, d)).status).toBe(400);
    const noHa = deps({ getAnalysis: vi.fn(async () => ({ ...analysis, result: { ...result, plans: result.plans.filter((plan) => plan.tier !== "ha") } })) });
    expect((await requestArtifact({ analysisId: id, body: { tier: "ha", kind: "guide" }, now: new Date() }, noHa.d)).status).toBe(400);
    const missing = deps({ getAnalysis: vi.fn(async () => null) });
    const missingResult = await requestArtifact({ analysisId: id, body: { tier: "low", kind: "guide" }, now: new Date() }, missing.d);
    expect(missingResult).toMatchObject({ status: 404 });
  });
  it("handles existing pending, racing success, and unavailable reservation", async () => {
    for (const reserve of [
      { ok: true as const, id: "x", status: "pending" as const, created: false },
      { ok: true as const, id: "x", status: "succeeded" as const, created: false },
    ]) {
      const { d } = deps({ reserveArtifact: vi.fn(async () => reserve), ...(reserve.status === "succeeded" ? { listArtifacts: vi.fn(async () => [record("guide")]) } : {}) });
      const response = await requestArtifact({ analysisId: id, body: { tier: "balanced", kind: "guide" }, now: new Date() }, d);
      expect(response.status).toBe(reserve.status === "pending" ? 202 : 200); expect(d.schedule).not.toHaveBeenCalled();
    }
    const { d } = deps({ reserveArtifact: vi.fn(async () => ({ ok: false as const, reason: "analysis-unavailable" as const })) });
    expect((await requestArtifact({ analysisId: id, body: { tier: "balanced", kind: "guide" }, now: new Date() }, d)).status).toBe(404);
  });
  it("joins an existing pending job with its real start time", async () => {
    const pending = { ...record("guide", "pending", null), createdAt: "2026-01-01T00:00:00.000Z", completedAt: null };
    const { d } = deps({ listArtifacts: vi.fn(async () => [pending]), reserveArtifact: vi.fn(async () => ({ ok: true as const, id: "a", status: "pending" as const, created: false })) });
    const response = await requestArtifact({ analysisId: id, body: { tier: "balanced", kind: "guide" }, now: new Date("2026-01-01T00:01:30Z") }, d);
    expect(response).toEqual({ status: 202, artifact: { tier: "balanced", kind: "guide", status: "pending", content: null, createdAt: "2026-01-01T00:00:00.000Z", completedAt: null } });
    expect(d.schedule).not.toHaveBeenCalled();
  });
  it("returns a real error instead of fake pending when a stored success no longer parses", async () => {
    const { d } = deps({ listArtifacts: vi.fn(async () => [record("guide", "succeeded", {})]), reserveArtifact: vi.fn(async () => ({ ok: true as const, id: "a", status: "succeeded" as const, created: false })) });
    const response = await requestArtifact({ analysisId: id, body: { tier: "balanced", kind: "guide" }, now: new Date() }, d);
    expect(response).toEqual({ status: 500, message: ARTIFACT_MESSAGES.generationFailed });
    expect(d.schedule).not.toHaveBeenCalled();
  });
});

describe("artifact job and stored views", () => {
  const job: ArtifactJob = { id: "job", kind: "guide", tier: "balanced", result };
  it("completes once on success and fails on invalid output or exceptions", async () => {
    const complete = vi.fn(async () => {}), fail = vi.fn(async () => {}), llm = vi.fn(async () => ({ data: guideContent, usage: null }));
    await runArtifactJob(job, { catalog, llm, complete, fail }); expect(llm).toHaveBeenCalledTimes(1); expect(complete).toHaveBeenCalledTimes(1); expect(fail).not.toHaveBeenCalled();
    await runArtifactJob(job, { catalog, llm: vi.fn(async () => ({ data: {}, usage: null })), complete, fail }); expect(fail).toHaveBeenCalledTimes(1);
    await runArtifactJob(job, { catalog, llm: vi.fn(async () => { throw Error("private"); }), complete, fail });
    await runArtifactJob(job, { catalog, llm, complete: vi.fn(async () => { throw Error(); }), fail });
    await runArtifactJob(job, { catalog, llm, complete, fail: vi.fn(async () => { throw Error(); }) });
  });
  it("persists usage on success, validation failure and completion failure", async () => {
    const usage = { promptTokens: 123, completionTokens: 456, costUsd: 0.1 };
    const complete = vi.fn(async () => {}), fail = vi.fn(async () => {});
    await runArtifactJob(job, { catalog, llm: async () => ({ data: guideContent, usage }), complete, fail });
    expect(complete).toHaveBeenCalledWith("job", guideContent, usage);
    await runArtifactJob(job, { catalog, llm: async () => ({ data: {}, usage }), complete, fail });
    // 검증 실패는 한 번 다시 부르므로(ADR-022) 두 호출의 사용량을 합쳐 남긴다.
    expect(fail).toHaveBeenLastCalledWith("job", { promptTokens: 246, completionTokens: 912, costUsd: 0.2 });
    await runArtifactJob(job, { catalog, llm: async () => ({ data: guideContent, usage }), complete: async () => { throw Error(); }, fail });
    expect(fail).toHaveBeenLastCalledWith("job", usage);
  });
  it("logs why generation failed, since the row keeps only the failed status", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await runArtifactJob(job, { catalog, llm: vi.fn(async () => ({ data: {}, usage: null })), complete: vi.fn(async () => {}), fail: vi.fn(async () => {}) });
    expect(warn).toHaveBeenCalledWith("구축 결과물 생성 실패", expect.objectContaining({ id: "job", kind: "guide", tier: "balanced", stage: "validation" }));
    expect((warn.mock.calls[0][1] as { errors: string[] }).errors.length).toBeGreaterThan(0);
    warn.mockClear();
    await runArtifactJob(job, { catalog, llm: vi.fn(async () => ({ data: guideContent, usage: null })), complete: vi.fn(async () => {}), fail: vi.fn(async () => {}) });
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
  it("parses kinds and maps stale or malformed records to failed", () => {
    for (const kind of ARTIFACT_KINDS) expect(parseStoredArtifactContent(kind, sampleArtifacts[kind])).not.toBeNull();
    expect(parseStoredArtifactContent("guide", {})).toBeNull();
    expect(toArtifactView(record("guide", "pending", null), new Date("2026-01-01T00:06:00Z"))).toMatchObject({ status: "failed", content: null });
    expect(toArtifactView(record("guide", "pending", null), new Date("2026-01-01T00:01:00Z"))).toMatchObject({ status: "pending", content: null });
    expect(toArtifactView(record("guide", "succeeded", {}), new Date())).toMatchObject({ status: "failed", content: null });
    expect(buildArtifactDownloadHref(id, "low", "bicep")).toBe(`/api/analyses/${id}/artifacts/download?tier=low&kind=bicep`);
  });
  it("sorts by kind then tier", () => {
    const values = toArtifactViews([record("guide"), { ...record("bicep"), tier: "low" }, record("evaluation")], new Date());
    expect(values.map(({ kind, tier }) => `${kind}:${tier}`)).toEqual(["guide:balanced", "evaluation:balanced", "bicep:low"]);
  });
});

it("reads legacy text leaves in all three stored artifact kinds without changing code or IDs", () => {
  const legacy = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(legacy);
    if (value && typeof value === "object") {
      if ("en" in value && "ko" in value) return value.ko;
      return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, legacy(child)]));
    }
    return value;
  };
  for (const kind of ["guide", "evaluation", "bicep"] as const) {
    const raw = sampleArtifacts[kind];
    const parsed = parseStoredArtifactContent(kind, raw);
    expect(parsed).not.toBeNull();
    const expected = JSON.parse(JSON.stringify(parsed), (_key, value) =>
      value && typeof value === "object" && "en" in value && "ko" in value ? { en: value.ko, ko: value.ko } : value);
    const old = legacy(parsed);
    const before = structuredClone(old);
    expect(parseStoredArtifactContent(kind, old)).toEqual(expected);
    expect(old).toEqual(before);
  }
});

it("rejects malformed stored bilingual leaves and preserves evaluation axis validation", () => {
  expect(parseStoredArtifactContent("guide", { ...guide, overview: { en: "Text" } })).toBeNull();
  expect(parseStoredArtifactContent("bicep", { ...bicep, deploymentNotes: [42] })).toBeNull();
  expect(parseStoredArtifactContent("evaluation", { ...sampleArtifacts.evaluation, summary: { en: "", ko: "요약" } })).toBeNull();
  expect(parseStoredArtifactContent("evaluation", { ...sampleArtifacts.evaluation, axes: [...sampleArtifacts.evaluation.axes].reverse() })).toBeNull();
});

// ADR-022: 생성 검증이 받은 길이는 저장 뒤 다시 읽을 때도 받아야 한다. 아니면 succeeded 행이 읽기에서 실패로 보이고 다시 만들 수 없다.
it.each([
  ["bicep", (text: unknown) => ({ ...bicep, deploymentNotes: [text] }), 200],
  ["guide", (text: unknown) => ({ ...guide, steps: guide.steps.map((step, index) => index === 0 ? { ...step, title: text } : step) }), 40],
  ["evaluation", (text: unknown) => ({ ...sampleArtifacts.evaluation, summary: text }), 200],
] as const)("reads stored %s text up to the generation limit and no further", (kind, withText, stated) => {
  const atLimit = { en: "a".repeat(validationLimit(stated * 2)), ko: "가".repeat(validationLimit(stated)) };
  expect(parseStoredArtifactContent(kind, withText(atLimit))).not.toBeNull();
  expect(parseStoredArtifactContent(kind, withText({ ...atLimit, ko: atLimit.ko + "가" }))).toBeNull();
  expect(parseStoredArtifactContent(kind, withText({ ...atLimit, en: atLimit.en + "a" }))).toBeNull();
});
