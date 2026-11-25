// Anthropic 공개 표준 단가 (USD / 100만 토큰, 2026-10 기준).
// 표에 없는 모델은 비용을 추정하지 않는다. 사고(thinking) 토큰은 출력 토큰에 포함되어 청구된다.
const PRICES_PER_MTOK: Record<string, { input: number; output: number }> = {
  "claude-opus-5-5": { input: 4, output: 20 },
  // 하네스 품질 평가(evals/harness)의 피평가 모델이다. 앱 분석에는 쓰지 않는다.
  "claude-sonnet-5-5": { input: 2, output: 10 },
};

export function calculateClaudeCostUsd(model: string, usage: {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
}): number | null {
  const price = Object.hasOwn(PRICES_PER_MTOK, model) ? PRICES_PER_MTOK[model] : undefined;
  // 프롬프트 캐시는 쓰지 않는다. 캐시 토큰이 보이면 단가 배율을 확정할 수 없다.
  if (!price || usage.cacheReadInputTokens > 0 || usage.cacheCreationInputTokens > 0) return null;
  // 토큰×단가를 먼저 합산하고 한 번만 나눠 부동소수 오차를 줄인다.
  return (usage.inputTokens * price.input + usage.outputTokens * price.output) / 1_000_000;
}
