export type LlmCallSource = "analysis" | "artifact" | "assessment-roadmap" | "extension" | "extension-artifact";

export type LlmUsage = {
  promptTokens: number;
  completionTokens: number;
  // 단가를 확정할 수 없으면(단가표에 없는 모델, 대체 모델 응답 등) 추정하지 않는다.
  costUsd: number | null;
};
