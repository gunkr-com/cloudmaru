import type { z } from "zod";
import type {
  deterministicCheckSchema, extensionArtifactRequestSchema, extensionArtifactSchema, extensionDeploymentBindingSchema,
  extensionInputSchema, extensionPlanSchema, extensionProposalSchema, extensionResultSchema, incrementalCostSchema, subnetProposalSchema,
} from "@/lib/completion/schema";

export type ExtensionInput = z.infer<typeof extensionInputSchema>;
export type ExtensionProposal = z.infer<typeof extensionProposalSchema>;
export type SubnetProposal = z.infer<typeof subnetProposalSchema>;
export type ExtensionDeploymentBinding = z.infer<typeof extensionDeploymentBindingSchema>;
export type IncrementalCost = z.infer<typeof incrementalCostSchema>;
export type DeterministicCheck = z.infer<typeof deterministicCheckSchema>;
export type ExtensionPlan = z.infer<typeof extensionPlanSchema>;
export type ExtensionResult = z.infer<typeof extensionResultSchema>;
export type ExtensionArtifactRequest = z.infer<typeof extensionArtifactRequestSchema>;
export type ExtensionArtifact = z.infer<typeof extensionArtifactSchema>;
