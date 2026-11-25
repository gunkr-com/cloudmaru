import { describe, expect, it } from "vitest";
import { getLocalMonthStart, summarizeMonthlyCost } from "./monthly-cost";

describe("monthly cost", () => {
  it.each([new Date(2026, 0, 31, 23, 59), new Date(2026, 10, 5, 12, 30)])("현지 월 시작을 구하고 입력을 유지한다: %s", now => {
    const original = now.getTime();
    expect(getLocalMonthStart(now)).toEqual(new Date(now.getFullYear(), now.getMonth(), 1));
    expect(now.getTime()).toBe(original);
  });
  it("반올림 없이 합산하고 단가 없는 호출만 제외한다", () => {
    expect(summarizeMonthlyCost([])).toEqual({ totalUsd: 0, uncountedCalls: 0 });
    expect(summarizeMonthlyCost([0.001, null, 0, 0.002, null].map(costUsd => ({ promptTokens: 1, completionTokens: 1, costUsd })))).toEqual({ totalUsd: 0.003, uncountedCalls: 2 });
  });
});
