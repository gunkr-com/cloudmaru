import { isSupportedRegion } from "@/lib/workspace/regions";
import { AVAILABILITY_OPTIONS, EXPECTED_USERS_OPTIONS } from "@/lib/analysis/input-schema";

export type AnalysisDraft = {
  description: string;
  expectedUsers: string;
  monthlyBudget: string;
  availability: string;
  region: string;
};

export const DRAFT_STORAGE_PREFIX = "cloudsight:analysis-draft:";

export function serializeDraft(draft: AnalysisDraft): string {
  return JSON.stringify(draft);
}

export function parseDraft(raw: string | null): AnalysisDraft | null {
  if (raw === null) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
    const candidate = value as Record<string, unknown>;
    if (["description", "expectedUsers", "monthlyBudget", "availability", "region"].some((key) => typeof candidate[key] !== "string")) return null;
    if (!isSupportedRegion(candidate.region as string)) return null;
    const expectedUsers = candidate.expectedUsers as string;
    const availability = candidate.availability as string;
    return {
      region: candidate.region as string,
      description: candidate.description as string,
      expectedUsers: EXPECTED_USERS_OPTIONS.some((option) => option.value === expectedUsers) ? expectedUsers : "",
      monthlyBudget: candidate.monthlyBudget as string,
      availability: AVAILABILITY_OPTIONS.some((option) => option.value === availability) ? availability : "",
    };
  } catch {
    return null;
  }
}

export function isEmptyDraft(draft: AnalysisDraft): boolean {
  return !draft.description && !draft.expectedUsers && !draft.monthlyBudget && !draft.availability;
}
