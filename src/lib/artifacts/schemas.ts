import { z } from "zod";
import { localizedTextSchema, LOCALIZED_TEXT_JSON_SCHEMA } from "@/lib/llm/localized-text";
import type { ArtifactKind } from "@/types/artifact";

const text = z.string().min(1, "빈 문자열은 사용할 수 없습니다.");
const guideStepSchema = z.object({
  title: localizedTextSchema({ ko: 40 }, "단계 제목"),
  goal: localizedTextSchema({ ko: 120 }, "단계 목표"),
  instructions: z.array(localizedTextSchema({ ko: 200 }, "절차")).min(1).max(8),
  componentIds: z.array(text),
  verification: localizedTextSchema({ ko: 120 }, "확인 방법"),
}).strip();

export const guideOutputSchema = z.object({
  overview: localizedTextSchema({ ko: 300 }, "개요"),
  prerequisites: z.array(localizedTextSchema({ ko: 120 }, "사전 준비")).min(1).max(6),
  steps: z.array(guideStepSchema).min(5, "단계는 5개 이상이어야 합니다.").max(12, "단계는 12개 이하여야 합니다."),
  cautions: z.array(localizedTextSchema({ ko: 160 }, "주의 사항")).max(5),
}).strip();

const gradeSchema = z.enum(["high", "medium", "low"]);
const evaluationAxisSchema = z.object({
  grade: gradeSchema,
  rationale: localizedTextSchema({ ko: 120 }, "근거"),
  improvement: localizedTextSchema({ ko: 120 }, "개선 제안"),
}).strip();
export const evaluationOutputSchema = z.object({
  summary: localizedTextSchema({ ko: 200 }, "요약"),
  reliability: evaluationAxisSchema,
  security: evaluationAxisSchema,
  cost: evaluationAxisSchema,
  operations: evaluationAxisSchema,
  performance: evaluationAxisSchema,
}).strip();

export const bicepOutputSchema = z.object({
  code: text.max(60_000, "Bicep 코드는 60,000자 이하여야 합니다."),
  parameters: z.array(z.object({ name: text, description: localizedTextSchema({ ko: Number.MAX_SAFE_INTEGER }, "매개변수 설명") }).strip()),
  deploymentNotes: z.array(localizedTextSchema({ ko: 200 }, "배포 메모")).min(1).max(6),
}).strip();

const axisProperties = {
  grade: { type: "string", enum: ["high", "medium", "low"] },
  rationale: LOCALIZED_TEXT_JSON_SCHEMA,
  improvement: LOCALIZED_TEXT_JSON_SCHEMA,
} as const;
const strictObject = (properties: Record<string, unknown>, required: string[]) => ({
  type: "object", properties, required, additionalProperties: false,
});
const strings = { type: "array", items: { type: "string" } } as const;
const localizedStrings = { type: "array", items: LOCALIZED_TEXT_JSON_SCHEMA } as const;
const stepProperties = {
  title: LOCALIZED_TEXT_JSON_SCHEMA, goal: LOCALIZED_TEXT_JSON_SCHEMA, instructions: localizedStrings,
  componentIds: strings, verification: LOCALIZED_TEXT_JSON_SCHEMA,
};
const axes = ["reliability", "security", "cost", "operations", "performance"] as const;

export const ARTIFACT_SCHEMA_NAMES: Record<ArtifactKind, string> = {
  guide: "artifact_guide", evaluation: "artifact_evaluation", bicep: "artifact_bicep",
};
export const ARTIFACT_JSON_SCHEMAS: Record<ArtifactKind, Record<string, unknown>> = {
  guide: strictObject({
    overview: LOCALIZED_TEXT_JSON_SCHEMA, prerequisites: localizedStrings,
    steps: { type: "array", items: strictObject(stepProperties, Object.keys(stepProperties)) },
    cautions: localizedStrings,
  }, ["overview", "prerequisites", "steps", "cautions"]),
  evaluation: strictObject({
    summary: LOCALIZED_TEXT_JSON_SCHEMA,
    ...Object.fromEntries(axes.map((axis) => [axis, strictObject(axisProperties, Object.keys(axisProperties))])),
  }, ["summary", ...axes]),
  bicep: strictObject({
    code: { type: "string" },
    parameters: { type: "array", items: strictObject({ name: { type: "string" }, description: LOCALIZED_TEXT_JSON_SCHEMA }, ["name", "description"]) },
    deploymentNotes: localizedStrings,
  }, ["code", "parameters", "deploymentNotes"]),
};
