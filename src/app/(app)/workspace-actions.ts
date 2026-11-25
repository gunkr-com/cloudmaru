"use server";

import { redirect } from "next/navigation";
import { getWorkspace } from "@/services/db/workspaces";
import { setCurrentWorkspaceCookie } from "@/services/current-workspace";

export async function selectWorkspace(formData: FormData): Promise<void> {
  const id = formData.get("workspaceId");
  if (typeof id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return;
  const workspace = await getWorkspace(id);
  if (!workspace) return;
  await setCurrentWorkspaceCookie(workspace.id);
  redirect("/analyses/new");
}
