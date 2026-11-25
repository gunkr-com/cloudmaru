import { azureSettingsInputSchema } from "./connection-schema";
import type { AzureConnectionField, WorkspaceAzureSettings } from "@/types/scan";

export type { AzureConnectionField } from "@/types/scan";

export function parseAzureConnectionForm(input: Record<AzureConnectionField, unknown>):
  | { ok: true; settings: WorkspaceAzureSettings }
  | { ok: false; values: Record<AzureConnectionField, string>; errors: Partial<Record<AzureConnectionField, string>> } {
  const stringValue = (field: AzureConnectionField) => typeof input[field] === "string" ? input[field] : "";
  const values = {
    tenantId: stringValue("tenantId"), clientId: stringValue("clientId"),
    certificatePath: stringValue("certificatePath"), certificatePasswordEnv: stringValue("certificatePasswordEnv"),
    subscriptionIds: stringValue("subscriptionIds"),
  };
  // 포털에서 복사한 값 끝의 공백·줄바꿈 때문에 맞는 GUID가 형식 오류가 되지 않게 한다. 오류 때는 원래 입력을 돌려준다.
  const parsed = azureSettingsInputSchema.safeParse({
    ...values, tenantId: values.tenantId.trim(), clientId: values.clientId.trim(), certificatePasswordEnv: values.certificatePasswordEnv.trim(),
    subscriptionIds: values.subscriptionIds.split(/[\s,]+/).filter(Boolean),
  });
  if (parsed.success) return { ok: true, settings: parsed.data };
  const errors: Partial<Record<AzureConnectionField, string>> = {};
  for (const issue of parsed.error.issues) {
    const field = issue.path[0] as AzureConnectionField;
    if (Object.hasOwn(values, field)) errors[field] ??= issue.message;
  }
  return { ok: false, values, errors };
}
