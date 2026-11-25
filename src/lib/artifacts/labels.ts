import type { MessageKey } from "@/i18n/messages/types";
import type { ArtifactKind, EvaluationAxis, EvaluationGrade } from "@/types/artifact";

export const ARTIFACT_KINDS: readonly ArtifactKind[] = ["guide", "evaluation", "bicep"];
export const ARTIFACT_LABELS: Record<ArtifactKind, { name: MessageKey; description: MessageKey }> = {
  guide: { name: "artifacts.guideName", description: "artifacts.guideDescription" },
  evaluation: { name: "artifacts.evaluationName", description: "artifacts.evaluationDescription" },
  bicep: { name: "artifacts.bicepName", description: "artifacts.bicepDescription" },
};
export const EVALUATION_AXIS_LABELS: Record<EvaluationAxis, MessageKey> = {
  reliability: "artifacts.reliability", security: "artifacts.security", cost: "artifacts.cost", operations: "artifacts.operations", performance: "artifacts.performance",
};
export const GRADE_LABELS: Record<EvaluationGrade, MessageKey> = { high: "artifacts.high", medium: "artifacts.medium", low: "artifacts.low" };
export const BICEP_DRAFT_LABEL = "artifacts.draftLabel";
export const BICEP_DRAFT_NOTICE = "artifacts.draftNotice";
