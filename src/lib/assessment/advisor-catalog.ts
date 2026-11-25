import { z } from "zod";
import rawCatalog from "@/catalog/advisor-recommendations.json";
const localized = z.strictObject({ en: z.string().min(1), ko: z.string().min(1) });
const schema = z.strictObject({
  schemaVersion: z.literal(1), version: z.string().min(1), verifiedAt: z.iso.date(),
  entries: z.array(z.strictObject({
    recommendationTypeId: z.guid().toLowerCase(),
    ruleId: z.string().regex(/^advisor-[a-z]+(?:-[a-z]+)*$/u),
    actionId: z.string().regex(/^advisor-action-[a-z]+(?:-[a-z]+)*$/u),
    resourceTypes: z.array(z.string().regex(/^microsoft\.[a-z]+\/[a-z]+(?:\/[a-z]+)*$/u)).nonempty(),
    title: localized, description: localized,
    sources: z.array(z.literal("https://learn.microsoft.com/en-us/azure/advisor/advisor-reference-cost-recommendations")).nonempty(),
  })).nonempty(),
}).refine(value => ["recommendationTypeId", "ruleId", "actionId"].every(key =>
  new Set(value.entries.map(entry => entry[key as "ruleId"])).size === value.entries.length));

export function parseAdvisorCatalog(raw: unknown) {
  const result = schema.safeParse(raw);
  if (!result.success) throw new Error("Invalid Advisor catalog.");
  return result.data;
}
export const advisorCatalog = parseAdvisorCatalog(rawCatalog);
