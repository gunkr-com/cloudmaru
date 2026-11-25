import type { LlmUsage } from "@/types/llm";

// 서버 오류의 본문·cause는 읽지 않고 숫자만 취한다. lib에서 서버 전용 서비스를 가져오지 않는다.
export function readLlmErrorUsage(error: unknown): LlmUsage | null {
  if (typeof error !== "object" || error === null || !("usage" in error)) return null;
  const usage = error.usage;
  if (typeof usage !== "object" || usage === null || !("promptTokens" in usage)
    || !("completionTokens" in usage) || !("costUsd" in usage)) return null;
  const { promptTokens, completionTokens, costUsd } = usage;
  if (typeof promptTokens !== "number" || !Number.isSafeInteger(promptTokens) || promptTokens < 0
    || typeof completionTokens !== "number" || !Number.isSafeInteger(completionTokens) || completionTokens < 0
    || (costUsd !== null && (typeof costUsd !== "number" || !Number.isFinite(costUsd) || costUsd < 0))) return null;
  return { promptTokens, completionTokens, costUsd };
}

// 같은 결과물을 여러 번 시도한 사용량을 합친다. 실패한 시도도 API 비용을 썼다.
// 비용은 둘 다 알 때만 더하고, 하나라도 모르면(null) 추정하지 않고 null로 둔다.
export function addLlmUsage(previous: LlmUsage | null, next: LlmUsage | null): LlmUsage | null {
  if (previous === null) return next === null ? null : { ...next };
  if (next === null) return { ...previous };
  return {
    promptTokens: previous.promptTokens + next.promptTokens,
    completionTokens: previous.completionTokens + next.completionTokens,
    costUsd: previous.costUsd === null || next.costUsd === null ? null : previous.costUsd + next.costUsd,
  };
}
