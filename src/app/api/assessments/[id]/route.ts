import { z } from "zod";
import { isAssessmentStale } from "@/lib/assessment/app/job";
import { getAssessment, failAssessment } from "@/services/db/assessments";
import { getCurrentWorkspace } from "@/services/current-workspace";

const json = (body: unknown, status: number) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await context.params;
    if (!z.uuid().safeParse(id).success) return json({ code: "not-found" }, 404);
    let record = await getAssessment(id);
    if (!record) return json({ code: "not-found" }, 404);
    if (isAssessmentStale(record,new Date())) {
      // pending 조건부 갱신 뒤 다시 읽어 동시 완료된 로컬 결과를 보존한다.
      await failAssessment(id, "interrupted");
      record = await getAssessment(id);
      if (!record) return json({ code: "not-found" }, 404);
    }
    const workspace = await getCurrentWorkspace();
    return json({ ...record, workspaceMismatch: record.workspaceId !== workspace.id }, 200);
  } catch {
    return json({ code: "internal" }, 500);
  }
}
