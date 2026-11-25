import { after } from "next/server";
import { z } from "zod";
import { readJsonBody } from "@/lib/scans/read-json-body";
import { getCurrentWorkspace } from "@/services/current-workspace";
import { roadmapJobs } from "@/services/assessment-roadmap";
export const maxDuration = 300;
const uuid = z.uuid();
const requestSchema = z.strictObject({ workspaceId: uuid });
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
type Context = { params: Promise<{ id: string }> };
export async function POST(request: Request, context: Context): Promise<Response> {
  try {
    const { id } = await context.params;
    if (!uuid.safeParse(id).success) return json({ code: "assessment-missing" }, 404);
    const body = await readJsonBody(request, 4096);
    if (!body.ok) return json({ code: "invalid-body" }, body.code === "import-too-large" ? 413 : 400);
    const parsed = requestSchema.safeParse(body.value);
    if (!parsed.success) return json({ code: "invalid-body" }, 400);
    const current = await getCurrentWorkspace();
    const { status, ...payload } = await roadmapJobs.start(id, current.id, parsed.data.workspaceId, task => after(task));
    return json(payload, status);
  } catch { return json({ code: "internal" }, 500); }
}
export async function GET(_request: Request, context: Context): Promise<Response> {
  try {
    const { id } = await context.params;
    if (!uuid.safeParse(id).success) return json({ code: "assessment-missing" }, 404);
    const current = await getCurrentWorkspace();
    const saved = await roadmapJobs.get(id, current.id);
    return saved ? json(saved) : json({ code: "assessment-missing" }, 404);
  } catch { return json({ code: "internal" }, 500); }
}
