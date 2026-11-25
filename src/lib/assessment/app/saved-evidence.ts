import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { assessmentResultSchema } from "@/lib/completion/schema";
import { loadAssessmentRules, parseAssessmentRules } from "@/lib/assessment/rules/catalog";
import { advisorCatalog, parseAdvisorCatalog } from "@/lib/assessment/advisor-catalog";
import type { AssessmentResult,AssessmentCatalogData } from "@/types/assessment";

export type {AssessmentCatalogData} from "@/types/assessment";
const envelope = z.strictObject({schemaVersion:z.literal(1),rules:z.unknown(),advisor:z.unknown(),
  sourceDigest:z.string().regex(/^[a-f0-9]{64}$/),resultDigest:z.string().regex(/^[a-f0-9]{64}$/)});
function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value, (_key,item) => item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a],[b]) => a < b ? -1 : a > b ? 1 : 0)) : item)).digest("hex");
}
export function currentAssessmentCatalogData(): AssessmentCatalogData { return {rules:loadAssessmentRules(),advisor:parseAdvisorCatalog(advisorCatalog)}; }
/** Private evidence created only after full semantic write validation. Digests detect corruption, not a full-DB attacker. */
export function sealAssessmentEvidence(result: AssessmentResult, source: unknown, data = currentAssessmentCatalogData()) {
  const catalogs = {rules:parseAssessmentRules(data.rules),advisor:parseAdvisorCatalog(data.advisor)};
  const sourceDigest=digest(source);
  return {schemaVersion:1 as const,...catalogs,sourceDigest,resultDigest:digest([result,catalogs,sourceDigest])};
}
export function readAssessmentEvidence(raw: unknown, rawResult: unknown, source: unknown): AssessmentCatalogData {
  try {
    const saved=envelope.parse(raw),result=assessmentResultSchema.parse(rawResult);
    const catalogs={rules:parseAssessmentRules(saved.rules),advisor:parseAdvisorCatalog(saved.advisor)};
    if(result.local.rulesVersion !== catalogs.rules.version
      || ("data" in result.advisor && result.advisor.data.mappingVersion !== catalogs.advisor.version)
      || saved.sourceDigest !== digest(source) || saved.resultDigest !== digest([result,catalogs,saved.sourceDigest])) throw new Error();
    return catalogs;
  } catch { throw new Error("assessment-storage-invalid"); }
}
