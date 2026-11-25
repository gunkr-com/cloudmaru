import type { LocalizedText } from "@/types/i18n";
import type { AnalysisInput, AnalysisResult } from "@/types/analysis";
import type { ArtifactKind } from "@/types/artifact";
import type { Tier } from "@/types/catalog";
import type { JobStatus } from "@/types/job";

export type AnalysisErrorStage = "llm" | "validation" | "internal";
export type AnalysisRecord = { id: string; workspaceId: string; status: JobStatus; input: AnalysisInput; result: AnalysisResult | null; errorStage: AnalysisErrorStage | null; sourceAnalysisId: string | null; createdAt: string; completedAt: string | null };
export type AnalysisListItem = { id: string; workspaceId: string; status: JobStatus; input: AnalysisInput; requestTitle: LocalizedText | null; recommendedTier: Tier | null; recommendedMonthly: number | null; sourceAnalysisId: string | null; createdAt: string };
export type ArtifactRecord = { id: string; analysisId: string; tier: Tier; kind: ArtifactKind; status: JobStatus; content: unknown; createdAt: string; completedAt: string | null };
