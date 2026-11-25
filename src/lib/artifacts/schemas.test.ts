import guideFixture from "./fixtures/sample-guide-output.json";
import evaluationFixture from "./fixtures/sample-evaluation-output.json";
import bicepFixture from "./fixtures/sample-bicep-output.json";
import { describe, expect, it } from "vitest";
import { ARTIFACT_JSON_SCHEMAS, bicepOutputSchema, evaluationOutputSchema, guideOutputSchema } from "@/lib/artifacts/schemas";
import { validationLimit } from "@/lib/llm/localized-text";

function checkStrictObjects(node: unknown): void {
  if (!node || typeof node !== "object") return;
  const value = node as Record<string, unknown>;
  if (value.type === "object") {
    const properties = value.properties as Record<string, unknown>;
    expect(value.additionalProperties).toBe(false);
    expect(value.required).toEqual(Object.keys(properties));
  }
  Object.values(value).forEach(checkStrictObjects);
}

describe("artifact output schemas", () => {
  it("provides strict structured-output schemas with all five required evaluation axes", () => {
    Object.values(ARTIFACT_JSON_SCHEMAS).forEach(checkStrictObjects);
    const properties = (ARTIFACT_JSON_SCHEMAS.evaluation.properties as Record<string, unknown>);
    expect(ARTIFACT_JSON_SCHEMAS.evaluation.required).toEqual([
      "summary", "reliability", "security", "cost", "operations", "performance",
    ]);
    expect(properties).toHaveProperty("reliability");
    expect(properties).toHaveProperty("performance");
  });

  it("strips extra keys at every nested level", () => {
    const step = { title: { en: "Text", ko: "단계" }, goal: { en: "Text", ko: "목표" }, instructions: [{ en: "Text", ko: "진행" }], componentIds: [], verification: { en: "Text", ko: "확인" }, extra: true };
    const guide = guideOutputSchema.parse({ overview: { en: "Text", ko: "설명" }, prerequisites: [{ en: "Text", ko: "계정" }], steps: Array.from({ length: 5 }, () => step), cautions: [], extra: true });
    expect(guide).not.toHaveProperty("extra");
    expect(guide.steps[0]).not.toHaveProperty("extra");
    const evaluation = evaluationOutputSchema.parse({ summary: { en: "Text", ko: "요약" }, ...Object.fromEntries(["reliability", "security", "cost", "operations", "performance"].map((axis) => [axis, { grade: "high", rationale: { en: "Text", ko: "근거" }, improvement: { en: "Text", ko: "개선" }, extra: true }])), extra: true });
    expect(evaluation).not.toHaveProperty("extra");
    expect(evaluation.reliability).not.toHaveProperty("extra");
    const bicep = bicepOutputSchema.parse({ code: "param location string = 'canadacentral'", parameters: [], deploymentNotes: [{ en: "Text", ko: "주의" }], extra: true });
    expect(bicep).not.toHaveProperty("extra");
  });
});

const localized = { en: "Text", ko: "설명" };
it("requires both languages, trims each and applies separate limits", () => {
  const step = { title: localized, goal: localized, instructions: [localized], componentIds: [], verification: localized };
  const guide = { overview: { en: " e ", ko: " 가 " }, prerequisites: [localized], steps: Array(5).fill(step), cautions: [] };
  expect(guideOutputSchema.parse(guide).overview).toEqual({ en: "e", ko: "가" });
  for (const [en, ko] of [["e".repeat(validationLimit(600)), "가".repeat(validationLimit(300))], ["e".repeat(validationLimit(600) + 1), "가"], ["e", "가".repeat(validationLimit(300) + 1)], ["한글", "설명"], [" ", "설명"]]) {
    expect(guideOutputSchema.safeParse({ ...guide, overview: { en, ko } }).success).toBe(en.length === validationLimit(600));
  }
  expect(guideOutputSchema.safeParse({ ...guide, overview: { en: "Text" } }).success).toBe(false);
  expect((ARTIFACT_JSON_SCHEMAS.guide.properties as Record<string, unknown>).overview).toMatchObject({ type: "object", required: ["en", "ko"] });
});

it.each([
  ["guide", "overview", 300], ["guide", "prerequisites.0", 120], ["guide", "steps.0.title", 40],
  ["guide", "steps.0.goal", 120], ["guide", "steps.0.instructions.0", 200], ["guide", "steps.0.verification", 120],
  ["guide", "cautions.0", 160], ["evaluation", "summary", 200], ["evaluation", "reliability.rationale", 120],
  ["evaluation", "reliability.improvement", 120], ["bicep", "deploymentNotes.0", 200],
] as const)("enforces language limits at %s.%s", (kind, path, limit) => {
  const schema = { guide: guideOutputSchema, evaluation: evaluationOutputSchema, bicep: bicepOutputSchema }[kind];
  const raw = structuredClone({ guide: guideFixture, evaluation: evaluationFixture, bicep: bicepFixture }[kind]);
  const keys = path.split(".");
  let parent: Record<string, unknown> = raw;
  for (const key of keys.slice(0, -1)) parent = parent[key] as Record<string, unknown>;
  const set = (value: unknown) => { parent[keys.at(-1)!] = value; return schema.safeParse(raw); };
  expect(set({ en: "a".repeat(validationLimit(limit * 2)), ko: "가".repeat(validationLimit(limit)) }).success).toBe(true);
  expect(set({ en: "a".repeat(validationLimit(limit * 2) + 1), ko: "가" }).success).toBe(false);
  expect(set({ en: "a", ko: "가".repeat(validationLimit(limit) + 1) }).success).toBe(false);
  expect(set({ en: "한글", ko: "가" }).success).toBe(false);
  expect(set("old text").success).toBe(false);
});
