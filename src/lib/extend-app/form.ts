import { extensionInputSchema } from "@/lib/completion/schema";
import { parseBudgetInput } from "@/lib/form/budget";
import { isMessageKey } from "@/i18n/translate";
import type { MessageKey } from "@/i18n/messages/types";
import type { ExtensionInput } from "@/types/extension";

export type ExtensionFormValues = { sourceScanId: string; description: string; expectedUsers: string; monthlyBudget: string; availability: string; region: string };
export type ExtensionFormField = keyof ExtensionFormValues;
export type ExtensionFormErrors = Partial<Record<ExtensionFormField, MessageKey>>;
export const EXTENSION_FIELD_ORDER: ExtensionFormField[] = ["sourceScanId", "description", "expectedUsers", "monthlyBudget", "availability", "region"];

/** 스키마와 선택 목록을 함께 검사한다. 회사는 폼 값 대신 서버가 고정한 소속을 사용한다. */
export function validateExtensionForm(values: ExtensionFormValues, options: { workspaceId: string; scanIds: readonly string[]; regionIds: readonly string[] }):
  { ok: true; input: ExtensionInput } | { ok: false; errors: ExtensionFormErrors } {
  const parsed = extensionInputSchema.safeParse({
    schemaVersion: 1, workspaceId: options.workspaceId, sourceScanId: values.sourceScanId,
    description: values.description, expectedUsers: values.expectedUsers,
    monthlyBudget: parseBudgetInput(values.monthlyBudget), availability: values.availability, region: values.region,
  });
  const errors: ExtensionFormErrors = {};
  if (!parsed.success) for (const issue of parsed.error.issues) {
    const field = issue.path[0] as ExtensionFormField;
    if (EXTENSION_FIELD_ORDER.includes(field) && !errors[field]) {
      errors[field] = isMessageKey(issue.message) ? issue.message : "extension.errors.invalid-request";
    }
  }
  if (!options.scanIds.includes(values.sourceScanId)) errors.sourceScanId = "extension.ui.scanUnavailable";
  if (!options.regionIds.includes(values.region)) errors.region = "analysis.regionInvalid";
  if (Object.keys(errors).length || !parsed.success) return { ok: false, errors };
  return { ok: true, input: parsed.data };
}
