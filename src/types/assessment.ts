import type { z } from "zod";
import type {
  actualCostRowSchema, actualCostSchema, actualCostWindowsSchema, advisorResultSchema, assessmentResultSchema, codeFindingSchema,
  findingVerdictSchema, pillarSchema, roadmapSchema, scanDiffSchema, severitySchema,
} from "@/lib/completion/schema";

export type FindingVerdict = z.infer<typeof findingVerdictSchema>;
export type AssessmentPillar = z.infer<typeof pillarSchema>;
export type AssessmentSeverity = z.infer<typeof severitySchema>;
export type CodeFinding = z.infer<typeof codeFindingSchema>;
export type AdvisorResult = z.infer<typeof advisorResultSchema>;
export type ActualCost = z.infer<typeof actualCostSchema>;
export type ActualCostRow = z.infer<typeof actualCostRowSchema>;
export type ActualCostWindows = z.infer<typeof actualCostWindowsSchema>;
export type ScanDiff = z.infer<typeof scanDiffSchema>;
export type AssessmentRoadmap = z.infer<typeof roadmapSchema>;
export type AssessmentResult = z.infer<typeof assessmentResultSchema>;


export type AssessmentInput = {schemaVersion:1;workspaceId:string;sourceScanId:string;previousScanId:string|null};
export type AssessmentRecord = {
  id:string;workspaceId:string;sourceScanId:string;previousScanId:string|null;
  input:AssessmentInput;status:"pending"|"succeeded"|"failed";result:AssessmentResult|null;
  error:{schemaVersion:1;code:import("./completion").CompletionReasonCode}|null;
  createdAt:string;completedAt:string|null;
  roadmap:{status:"not-requested"|"pending"|"succeeded"|"failed";attemptId:string|null;
    content:AssessmentRoadmap|null;error:{schemaVersion:1;code:import("./completion").CompletionReasonCode}|null;
    usage:import("./llm").LlmUsage|null;createdAt:string|null;completedAt:string|null};
};
export type AssessmentCatalogData = {
  rules:import("@/lib/assessment/rules/catalog").AssessmentRuleCatalog;
  advisor:ReturnType<typeof import("@/lib/assessment/advisor-catalog").parseAdvisorCatalog>;
};
