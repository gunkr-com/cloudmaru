"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { workspaceInputSchema } from "@/lib/workspace/input-schema";
import { createWorkspace, getWorkspace, updateWorkspace } from "@/services/db/workspaces";
import { setCurrentWorkspaceCookie } from "@/services/current-workspace";
import type { WorkspaceFormState } from "@/types/workspace";

const saveError = "workspace.errors.save" satisfies import("@/i18n/messages/types").MessageKey;

async function saveWorkspace(formData: FormData, update: boolean): Promise<WorkspaceFormState> {
  const raw = {
    name: formData.get("name"),
    companyName: formData.get("companyName"),
    defaultRegion: formData.get("defaultRegion"),
  };
  const values = {
    name: typeof raw.name === "string" ? raw.name : "",
    companyName: typeof raw.companyName === "string" ? raw.companyName : "",
    defaultRegion: typeof raw.defaultRegion === "string" ? raw.defaultRegion : "",
  };
  const parsed = workspaceInputSchema.safeParse(raw);
  if (!parsed.success) return { values, errors: z.flattenError(parsed.error).fieldErrors };

  const id = formData.get("workspaceId");
  if (update && (typeof id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))) {
    return { values, message: saveError };
  }
  try {
    if (update) {
      if (typeof id !== "string" || !await getWorkspace(id)) return { values, message: saveError };
      if (!await updateWorkspace(id, parsed.data)) return { values, message: saveError };
    } else {
      const workspace = await createWorkspace(parsed.data);
      await setCurrentWorkspaceCookie(workspace.id);
    }
  } catch {
    return { values, message: saveError };
  }
  // redirect는 제어 흐름 예외를 던지므로 저장 오류 처리 밖에서 호출한다.
  revalidatePath("/", "layout");
  redirect(update ? "/workspaces" : "/analyses/new");
}

export async function createWorkspaceAction(_prev: WorkspaceFormState, formData: FormData): Promise<WorkspaceFormState> {
  return saveWorkspace(formData, false);
}

export async function updateWorkspaceAction(_prev: WorkspaceFormState, formData: FormData): Promise<WorkspaceFormState> {
  return saveWorkspace(formData, true);
}
