import { after } from "next/server";
import { z } from "zod";
import { extensionInputSchema } from "@/lib/completion/schema";
import { readJsonBody } from "@/lib/scans/read-json-body";
import { getCurrentWorkspace } from "@/services/current-workspace";
import { extensionJobs } from "@/services/extension-job";

export const maxDuration = 300;
// 한국어 2,000자(UTF-8 6KB), JSON의 전체 \uXXXX 표현(12KB)과 식별자도 수용한다.
const BODY_MAX_BYTES = 16 * 1024;
const requestSchema = extensionInputSchema.extend({ sourceExtensionId: z.uuid().nullable().optional() });
const querySchema = z.strictObject({
  sourceScanId: z.uuid().optional(),
  limit: z.string().regex(/^[1-9]\d*$/).transform(Number).pipe(z.number().int().min(1).max(100)).optional(),
});
const json = (body: unknown, status: number) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await readJsonBody(request, BODY_MAX_BYTES);
    if (!body.ok) return json({ code: "invalid-body" }, body.code === "import-too-large" ? 413 : 400);
    const parsed = requestSchema.safeParse(body.value);
    if (!parsed.success) return json({ code: "invalid-body" }, 400);
    const { sourceExtensionId, ...input } = parsed.data;
    const workspace = await getCurrentWorkspace();
    const { status, ...payload } = await extensionJobs.start({ workspaceId: workspace.id, body: input, sourceExtensionId }, task => after(task));
    return json(payload, status);
  } catch { return json({ code: "internal" }, 500); }
}

export async function GET(request: Request): Promise<Response> {
  try {
    const query = new URL(request.url).searchParams;
    // 중복 필드를 마지막 값으로 조용히 덮어쓰지 않는다.
    if ([...query.keys()].some(key => query.getAll(key).length !== 1)) return json({ code: "invalid-query" }, 400);
    const parsed = querySchema.safeParse(Object.fromEntries(query));
    if (!parsed.success) return json({ code: "invalid-query" }, 400);
    const workspace = await getCurrentWorkspace();
    const records = await extensionJobs.list(workspace.id, parsed.data);
    return json({ extensions: records.map(record => ({ ...record, workspaceMismatch: record.workspaceId !== workspace.id })) }, 200);
  } catch { return json({ code: "internal" }, 500); }
}
