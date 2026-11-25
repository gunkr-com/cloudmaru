"use server";

import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";
import { parseAzureConnectionForm } from "@/lib/scans/connection-form";
import { saveWorkspaceAzureSettings } from "@/services/db/workspace-azure";
import type { AzureConnectionField, AzureConnectionFormState } from "@/types/scan";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const saveError = "inventory.connection.form.errors.save";

export async function saveAzureConnectionAction(_prev: AzureConnectionFormState, formData: FormData): Promise<AzureConnectionFormState> {
  const stringValue = (field: AzureConnectionField) => {
    const value = formData.get(field);
    return typeof value === "string" ? value : "";
  };
  const values = {
    tenantId: stringValue("tenantId"), clientId: stringValue("clientId"),
    certificatePath: stringValue("certificatePath"), certificatePasswordEnv: stringValue("certificatePasswordEnv"),
    subscriptionIds: stringValue("subscriptionIds"),
  };
  const id = formData.get("workspaceId");
  if (typeof id !== "string" || !uuidPattern.test(id)) return { message: saveError };
  const parsed = parseAzureConnectionForm(values);
  if (!parsed.ok) return { errors: parsed.errors };
  try {
    if (!await saveWorkspaceAzureSettings(id, parsed.settings)) return { message: saveError };
  } catch {
    return { message: saveError };
  }
  // redirect는 제어 흐름 예외이므로 저장 오류 처리 밖에 둔다.
  revalidatePath("/", "layout");
  redirect(`/workspaces/${id}/connection?saved=1`);
}

export async function removeAzureConnectionAction(formData: FormData): Promise<void> {
  const id = formData.get("workspaceId");
  if (typeof id !== "string" || !uuidPattern.test(id)) notFound();
  let saved = false;
  try {
    saved = await saveWorkspaceAzureSettings(id, { connection: null, subscriptionIds: [] });
  } catch {
    // 원본 오류 대신 페이지에서 공용 저장 오류 문구를 보여 준다.
  }
  if (!saved) redirect(`/workspaces/${id}/connection?error=save`);
  revalidatePath("/", "layout");
  redirect(`/workspaces/${id}/connection?removed=1`);
}
