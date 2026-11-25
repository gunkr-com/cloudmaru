import type { LlmUsage } from "@/types/llm";

export function getLocalMonthStart(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

export function summarizeMonthlyCost(usages: readonly LlmUsage[]): { totalUsd: number; uncountedCalls: number } {
  return usages.reduce((summary, usage) => {
    if (usage.costUsd === null) summary.uncountedCalls += 1;
    else summary.totalUsd += usage.costUsd;
    return summary;
  }, { totalUsd: 0, uncountedCalls: 0 });
}
