import { z } from "zod";
import { extensionDeploymentBindingSchema, extensionInstanceCountSchema, extensionProposalSchema, subnetProposalSchema } from "@/lib/completion/schema";
import { localizedTextSchema } from "@/lib/llm/localized-text";

const alias = z.string().regex(/^r[0-9]{6,}$/);
// 공통 text 검사를 쓰되, Build의 strip 동작을 Extend에 가져오지 않는다.
const text = (ko: number) => z.strictObject({ en: z.string(), ko: z.string() }).superRefine((value, ctx) => {
  const result = localizedTextSchema({ ko }, "설명").safeParse(value);
  if (!result.success) for (const issue of result.error.issues) ctx.addIssue({ code: "custom", path: issue.path, message: issue.message });
});
const plan = extensionProposalSchema.shape.plans.element;
const reuse = plan.shape.reusedResources.element.safeExtend({ resourceId: alias, reason: text(200) });
const increase = plan.shape.usageIncreases.element.safeExtend({ resourceId: alias });
const parent = subnetProposalSchema.shape.parent;
const subnet = subnetProposalSchema.safeExtend({
  parent: z.discriminatedUnion("kind", [parent.options[0].safeExtend({ resourceId: alias }), parent.options[1]]),
});
const bindingTarget = extensionDeploymentBindingSchema.shape.target;
const binding = extensionDeploymentBindingSchema.safeExtend({ target: z.discriminatedUnion("kind", [
  bindingTarget.options[0], bindingTarget.options[1].safeExtend({ resourceId: alias }),
]) });
// Only storage historical replay may use this shape; new output uses the required count below.
export const historicalExtensionModelOutputSchema = extensionProposalSchema.safeExtend({
  requestTitle: text(40), recommendationReason: text(200),
  plans: z.array(plan.safeExtend({ title: text(40), pros: z.array(text(120)).min(1).max(4),
    reusedResources: z.array(reuse), usageIncreases: z.array(increase), subnetProposals: z.array(subnet),
    deploymentBindings: z.array(binding).refine(values => new Set(values.map(v => v.role)).size === values.length).optional(),
  })).length(3).refine(plans => plans.map(p => p.tier).join(",") === "low,balanced,ha"),
});
export const extensionModelOutputSchema = historicalExtensionModelOutputSchema.safeExtend({
  plans: z.array(historicalExtensionModelOutputSchema.shape.plans.element.safeExtend({
    newItems: z.array(plan.shape.newItems.element.safeExtend({ instanceCount: extensionInstanceCountSchema }))
      .refine(items => new Set(items.map(i => i.componentId)).size === items.length),
  })).length(3).refine(plans => plans.map(p => p.tier).join(",") === "low,balanced,ha"),
});
export type ExtensionModelOutput = z.infer<typeof extensionModelOutputSchema>;
export const EXTENSION_MODEL_OUTPUT_SCHEMA_NAME = "extension_recommendations";
// 제공자에는 JSON 구조만, refinements는 서버에서 다시 강제한다.
export const EXTENSION_MODEL_OUTPUT_JSON_SCHEMA = z.toJSONSchema(extensionModelOutputSchema, { target: "draft-7", unrepresentable: "any" });
