import type { LocalizedText } from "@/types/i18n";

// Pro 구축 결과물 종류: 단계별 구축 가이드, Well-Architected 5축 평가, Bicep 코드
export type ArtifactKind = "guide" | "evaluation" | "bicep";

export type GuideStep = {
  title: LocalizedText;
  goal: LocalizedText;
  instructions: LocalizedText[];
  componentIds: string[];
  verification: LocalizedText;
};
export type GuideContent = {
  overview: LocalizedText;
  prerequisites: LocalizedText[];
  steps: GuideStep[];
  cautions: LocalizedText[];
};

export type EvaluationAxis = "reliability" | "security" | "cost" | "operations" | "performance";
export type EvaluationGrade = "high" | "medium" | "low";
export type EvaluationAxisResult = {
  axis: EvaluationAxis;
  grade: EvaluationGrade;
  rationale: LocalizedText;
  improvement: LocalizedText;
};
export type EvaluationContent = {
  summary: LocalizedText;
  axes: EvaluationAxisResult[];
};

export type BicepContent = {
  code: string;
  parameters: { name: string; description: LocalizedText }[];
  deploymentNotes: LocalizedText[];
};

export type ArtifactContentMap = { guide: GuideContent; evaluation: EvaluationContent; bicep: BicepContent };
export type ArtifactContent = ArtifactContentMap[ArtifactKind];
// retryErrors: 첫 출력이 검증에 실패해 한 번 다시 불렀을 때 그 첫 오류(ADR-022). eval 보고서가 쓴다.
export type ArtifactOutcome<K extends ArtifactKind = ArtifactKind> =
  | { ok: true; kind: K; content: ArtifactContentMap[K]; usage: import("@/types/llm").LlmUsage | null; retryErrors?: string[] }
  | { ok: false; stage: "input" | "llm" | "validation"; errors: string[]; usage: import("@/types/llm").LlmUsage | null; retryErrors?: string[] };
export type ArtifactFile = { filename: string; contentType: string; body: string };
