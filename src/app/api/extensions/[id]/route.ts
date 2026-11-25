import { z } from "zod";
import { getCurrentWorkspace } from "@/services/current-workspace";
import { extensionJobs } from "@/services/extension-job";

const json = (body: unknown, status: number) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await context.params;
    if (!z.uuid().safeParse(id).success) return json({ code: "not-found" }, 404);
    const record = await extensionJobs.get(id);
    if (!record) return json({ code: "not-found" }, 404);
    const workspace = await getCurrentWorkspace();
    return json({ ...record, workspaceMismatch: record.workspaceId !== workspace.id }, 200);
  } catch { return json({ code: "internal" }, 500); }
}
