import "server-only";
import { cookies } from "next/headers";
import type { Workspace } from "@/types/workspace";
import { resolveCurrentWorkspace } from "@/lib/workspace/resolve-current";
import { listWorkspaces, ensureDefaultWorkspace } from "@/services/db/workspaces";

export const WORKSPACE_COOKIE = "cs_workspace";

type CookieOptions = { httpOnly: boolean; sameSite: "lax"; path: string; maxAge: number };
type Deps = {
  cookies: () => Promise<{
    get(name: string): { value: string } | undefined;
    set(name: string, value: string, options: CookieOptions): unknown;
  }>;
  listWorkspaces: () => Promise<Workspace[]>;
  ensureDefaultWorkspace: () => Promise<Workspace>;
};

export function createCurrentWorkspaceService(deps: Deps) {
  return {
    async getCurrentWorkspace(): Promise<Workspace> {
      const jar = await deps.cookies();
      const workspaces = await deps.listWorkspaces();
      return resolveCurrentWorkspace(jar.get(WORKSPACE_COOKIE)?.value, workspaces)
        ?? deps.ensureDefaultWorkspace();
    },
    // Server Action 또는 Route Handler에서만 호출한다.
    async setCurrentWorkspaceCookie(id: string): Promise<void> {
      const jar = await deps.cookies();
      jar.set(WORKSPACE_COOKIE, id, {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        maxAge: 365 * 24 * 60 * 60,
      });
    },
  };
}

export const { getCurrentWorkspace, setCurrentWorkspaceCookie } =
  createCurrentWorkspaceService({ cookies, listWorkspaces, ensureDefaultWorkspace });
