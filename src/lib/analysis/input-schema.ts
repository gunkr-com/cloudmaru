import type { LocalizedText } from "@/types/i18n";
import { en } from "@/i18n/messages/en";
import { ko } from "@/i18n/messages/ko";
import type { MessageKey } from "@/i18n/messages/types";
import { isSupportedRegion } from "@/lib/workspace/regions";
import { z } from "zod";
import type { AnalysisInput, Availability, ExpectedUsers } from "@/types/analysis";
import type { Tier } from "@/types/catalog";

// 프롬프트는 두 언어 라벨을 쓰고 화면 입력은 labelKey를 현재 언어로 번역한다.
export const EXPECTED_USERS_OPTIONS = [
  { value: "under-100", labelKey: "analysis.users100", label: { en: en.analysis.users100, ko: ko.analysis.users100 } },
  { value: "under-1k", labelKey: "analysis.users1k", label: { en: en.analysis.users1k, ko: ko.analysis.users1k } },
  { value: "under-10k", labelKey: "analysis.users10k", label: { en: en.analysis.users10k, ko: ko.analysis.users10k } },
  { value: "under-100k", labelKey: "analysis.users100k", label: { en: en.analysis.users100k, ko: ko.analysis.users100k } },
  { value: "over-100k", labelKey: "analysis.usersOver100k", label: { en: en.analysis.usersOver100k, ko: ko.analysis.usersOver100k } },
] as const satisfies ReadonlyArray<{ value: ExpectedUsers; labelKey: MessageKey; label: LocalizedText }>;

export const AVAILABILITY_OPTIONS = [
  { value: "low", labelKey: "analysis.availabilityLow", label: { en: en.analysis.availabilityLow, ko: ko.analysis.availabilityLow } },
  { value: "medium", labelKey: "analysis.availabilityMedium", label: { en: en.analysis.availabilityMedium, ko: ko.analysis.availabilityMedium } },
  { value: "high", labelKey: "analysis.availabilityHigh", label: { en: en.analysis.availabilityHigh, ko: ko.analysis.availabilityHigh } },
] as const satisfies ReadonlyArray<{ value: Availability; labelKey: MessageKey; label: LocalizedText }>;

// 모델 프롬프트용 두 언어 문장. 화면은 현재 언어의 사전 키를 쓴다.
export const EXPECTED_USERS_BASIS = { en: en.analysis.usersBasis, ko: ko.analysis.usersBasis };
export const EXPECTED_USERS_HELP = { en: en.analysis.usersHelp, ko: ko.analysis.usersHelp };

// 가용성 수준 설명. SLA 수치를 약속하지 않는다.
export const AVAILABILITY_DESCRIPTIONS = {
  low: { en: en.analysis.availabilityLowHelp, ko: ko.analysis.availabilityLowHelp },
  medium: { en: en.analysis.availabilityMediumHelp, ko: ko.analysis.availabilityMediumHelp },
  high: { en: en.analysis.availabilityHighHelp, ko: ko.analysis.availabilityHighHelp },
} as const satisfies Record<Availability, LocalizedText>;

export const TIER_LABELS = {
  low: { ko: ko.common.tiers.low, en: en.common.tiers.low },
  balanced: { ko: ko.common.tiers.balanced, en: en.common.tiers.balanced },
  ha: { ko: ko.common.tiers.ha, en: en.common.tiers.ha },
} as const satisfies Record<Tier, { ko: string; en: string }>;

export const analysisInputSchema = z.object({
  description: z.string({ error: "analysis.descriptionRequired" })
    .min(10, "analysis.descriptionMinimum")
    .max(2000, "analysis.descriptionMaximum"),
  expectedUsers: z.enum(EXPECTED_USERS_OPTIONS.map((option) => option.value), {
    error: "analysis.usersRequired",
  }),
  monthlyBudget: z.number({ error: "analysis.budgetNumber" })
    .int("analysis.budgetInteger")
    .min(10, "analysis.budgetMinimum"),
  region: z.string({ error: "analysis.regionInvalid" }).refine(isSupportedRegion, "analysis.regionInvalid"),
  availability: z.enum(AVAILABILITY_OPTIONS.map((option) => option.value), {
    error: "analysis.availabilityRequired",
  }),
}, { error: "analysis.invalidInput" }) satisfies z.ZodType<AnalysisInput>;
