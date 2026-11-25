import type { Workspace } from "@/types/workspace";

export const DEFAULT_WORKSPACE_NAME = "Default workspace";

export function resolveCurrentWorkspace(
  cookieValue: string | undefined,
  workspaces: readonly Workspace[],
): Workspace | null {
  return workspaces.find(workspace => workspace.id === cookieValue) ?? workspaces[0] ?? null;
}
