import { localizedTextSchema, LOCALIZED_TEXT_JSON_SCHEMA } from "@/lib/llm/localized-text";
import { z } from "zod";
import { connectionSchema, planItemSchema, tierSchema } from "@/lib/catalog/schema";
import type { ModelOutput, ModelPlan } from "@/types/analysis";

const textSchema = z.string().min(1, "빈 문자열은 사용할 수 없습니다.");

// 모델이 덧붙인 필드는 중첩 객체에서도 제거한다.
const modelPlanSchema = z.object({
  tier: tierSchema,
  referenceArchitectureId: textSchema,
  title: localizedTextSchema({ ko: 40 }, "안의 이름"),
  items: z.array(planItemSchema.strip())
    .min(1, "구성요소는 하나 이상 필요합니다.")
    .max(20, "구성요소는 20개 이하여야 합니다."),
  pros: z.array(localizedTextSchema({ ko: 120 }, "장점"))
    .min(1, "장점은 하나 이상 필요합니다.")
    .max(4, "장점은 4개 이하여야 합니다."),
  connections: z.array(connectionSchema.strip()),
}) satisfies z.ZodType<ModelPlan>;

export const modelOutputSchema = z.object({
  requestTitle: localizedTextSchema({ ko: 40 }, "요청 제목"),
  outOfScope: z.boolean(),
  recommendedTier: tierSchema,
  recommendationReason: localizedTextSchema({ ko: 200 }, "추천 이유"),
  plans: z.array(modelPlanSchema).length(3, "추천안은 정확히 3개여야 합니다."),
}) satisfies z.ZodType<ModelOutput>;

export const MODEL_OUTPUT_SCHEMA_NAME = "analysis_recommendations";

// 제공자 엄격 모드에는 구조만 전달하고 길이·개수·범위는 Zod에서 검사한다.
export const MODEL_OUTPUT_JSON_SCHEMA = {
  type: "object",
  properties: {
    requestTitle: LOCALIZED_TEXT_JSON_SCHEMA,
    outOfScope: { type: "boolean" },
    recommendedTier: { type: "string", enum: tierSchema.options },
    recommendationReason: LOCALIZED_TEXT_JSON_SCHEMA,
    plans: {
      type: "array",
      items: {
        type: "object",
        properties: {
          tier: { type: "string", enum: tierSchema.options },
          referenceArchitectureId: { type: "string" },
          title: LOCALIZED_TEXT_JSON_SCHEMA,
          items: {
            type: "array",
            items: {
              type: "object",
              properties: {
                componentId: { type: "string" },
                quantity: { type: "number" },
              },
              required: ["componentId", "quantity"],
              additionalProperties: false,
            },
          },
          pros: { type: "array", items: LOCALIZED_TEXT_JSON_SCHEMA },
          connections: {
            type: "array",
            items: {
              type: "object",
              properties: {
                from: { type: "string" },
                to: { type: "string" },
              },
              required: ["from", "to"],
              additionalProperties: false,
            },
          },
        },
        required: ["tier", "referenceArchitectureId", "title", "items", "pros", "connections"],
        additionalProperties: false,
      },
    },
  },
  required: ["requestTitle", "outOfScope", "recommendedTier", "recommendationReason", "plans"],
  additionalProperties: false,
} as const;
