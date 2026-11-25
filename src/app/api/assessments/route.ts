import { after } from "next/server";
import { assessmentInputSchema } from "@/lib/assessment/app/storage-validation";
import { readJsonBody } from "@/lib/scans/read-json-body";
import { getCurrentWorkspace } from "@/services/current-workspace";
import { assessmentJobs } from "@/services/assessment-job";

// 작업의 3분 제한과 동일하다. 외부 입력에는 저장 계약 버전을 받지 않는다.
export const maxDuration = 180;
const requestSchema = assessmentInputSchema.omit({ schemaVersion: true });
const json = (body: unknown, status: number) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await readJsonBody(request, 4096);
    if (!body.ok) return json({ code: "invalid-body" }, body.code === "import-too-large" ? 413 : 400);
    const parsed = requestSchema.safeParse(body.value);
    if (!parsed.success) return json({ code: "invalid-body" }, 400);
    const workspace = await getCurrentWorkspace();
    // 소유권·비교 시각 검증과 예약 실패 처리는 기존 작업 시작 경로 하나를 따른다.
    const result = await assessmentJobs.start({ workspaceId: workspace.id, body: { schemaVersion: 1, ...parsed.data } }, task => after(task));
    const { status, ...payload } = result;
    return json(payload, status);
  } catch {
    return json({ code: "internal" }, 500);
  }
}
