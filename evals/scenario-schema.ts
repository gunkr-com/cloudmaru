import { z } from "zod";
import { analysisInputSchema } from "../src/lib/analysis/input-schema";
import { componentCategorySchema } from "../src/lib/catalog/schema";
import type { AnalysisInput } from "../src/types/analysis";
import type { ComponentCategory } from "../src/types/catalog";
import scenarios from "./scenarios.json";

export type EvalScenario = {
  id: string;
  title: string;
  input: AnalysisInput;
  expect: {
    outOfScope: boolean;
    requiredCategories: ComponentCategory[];
    lowTierWithinBudget: boolean;
    notes: string;
  };
};

const koreanText = z.string().trim().min(1).regex(/[가-힣]/, "한국어로 작성해 주세요.");

export const scenarioSchema = z.strictObject({
  id: z.string().regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/, "시나리오 ID는 영문 kebab-case여야 합니다."),
  title: koreanText,
  input: analysisInputSchema,
  expect: z.strictObject({
    outOfScope: z.boolean(),
    requiredCategories: z.array(componentCategorySchema).min(1),
    lowTierWithinBudget: z.boolean(),
    notes: koreanText,
  }),
}) satisfies z.ZodType<EvalScenario>;

export const scenariosSchema = z.array(scenarioSchema)
  .length(10, "고정 시나리오는 10개여야 합니다.")
  .refine((items) => new Set(items.map(({ id }) => id)).size === items.length, "시나리오 ID가 중복되었습니다.")
  .refine((items) => items.filter(({ expect }) => expect.outOfScope).length === 1, "범위 밖 시나리오는 1개여야 합니다.");

export function loadScenarios(): EvalScenario[] {
  return scenariosSchema.parse(scenarios, { error: z.locales.ko().localeError });
}
