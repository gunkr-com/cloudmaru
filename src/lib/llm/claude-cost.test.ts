import { describe, expect, it } from "vitest";
import { calculateClaudeCostUsd } from "./claude-cost";

const tokens = { inputTokens: 1_000_000, outputTokens: 1_000_000, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 };

describe("calculateClaudeCostUsd", () => {
  it("Opus 5.5 공개 단가(입력 4 USD, 출력 20 USD / 100만 토큰)로 계산한다", () => {
    expect(calculateClaudeCostUsd("claude-opus-5-5", tokens)).toBe(24);
    expect(calculateClaudeCostUsd("claude-opus-5-5", { ...tokens, inputTokens: 100, outputTokens: 20 })).toBe(0.0008);
  });

  it("Sonnet 5.5 공개 단가(입력 2 USD, 출력 10 USD / 100만 토큰)로 계산한다", () => {
    expect(calculateClaudeCostUsd("claude-sonnet-5-5", tokens)).toBe(12);
  });

  it("0 토큰은 0 USD이다", () => {
    expect(calculateClaudeCostUsd("claude-opus-5-5", { ...tokens, inputTokens: 0, outputTokens: 0 })).toBe(0);
  });

  it.each(["claude-sonnet-5", "claude-opus-5-5-20260401", "test/model", ""])(
    "단가표에 없는 모델 %j은 추정하지 않고 null이다", (model) => {
      expect(calculateClaudeCostUsd(model, tokens)).toBeNull();
    },
  );

  it.each([{ cacheReadInputTokens: 1 }, { cacheCreationInputTokens: 1 }])(
    "프롬프트 캐시 토큰이 있으면 단가를 확정하지 않고 null이다: %j", (cache) => {
      expect(calculateClaudeCostUsd("claude-opus-5-5", { ...tokens, ...cache })).toBeNull();
    },
  );
});
