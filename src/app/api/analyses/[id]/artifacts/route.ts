import { after, type NextRequest } from "next/server";
import { getAnalysis } from "@/services/db/analyses";
import { completeArtifact, failArtifact, listArtifacts, reserveArtifact } from "@/services/db/artifacts";
import { hasWorkspaceClaudeKey, requestAnalysisStructuredOutput } from "@/services/workspace-claude";
import { loadCatalog } from "@/lib/catalog/load";
import { requestArtifact, runArtifactJob, toArtifactViews } from "@/lib/artifacts/artifact-job";
import { ARTIFACT_MESSAGES } from "@/lib/artifacts/artifact-job";

export const maxDuration = 300;
const noStore = { "Cache-Control": "no-store" };
const internalError = { message: "artifacts.internalError" };

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await context.params;
    let body: unknown;
    try { body = await request.json(); } catch { return Response.json({ errors: ["artifacts.invalidRequest"] }, { status: 400, headers: noStore }); }
    const result = await requestArtifact({ analysisId: id, body, now: new Date() }, {
      hasWorkspaceClaudeKey,
      getAnalysis: getAnalysis,
      listArtifacts: listArtifacts,
      reserveArtifact,
      schedule: (task) => after(task),
      runJob: (job) => runArtifactJob(job, {
        catalog: loadCatalog(),
        llm: (llmRequest) => requestAnalysisStructuredOutput(id, { ...llmRequest, timeoutMs: Math.min(llmRequest.timeoutMs ?? 240_000, 240_000) }),
        complete: completeArtifact,
        fail: failArtifact,
      }),
    });
    if (result.status === 200 || result.status === 202) return Response.json({ artifact: result.artifact }, { status: result.status, headers: noStore });
    if (result.status === 400) return Response.json({ errors: result.errors }, { status: 400, headers: noStore });
    if (result.status === 409) return Response.json({ message: result.message, workspaceId: result.workspaceId }, { status: 409, headers: noStore });
    if ("message" in result) return Response.json({ message: result.message }, { status: result.status, headers: noStore });
    return Response.json(internalError, { status: 500, headers: noStore });
  } catch {
    return Response.json(internalError, { status: 500, headers: noStore });
  }
}

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await context.params;
    const analysis = await getAnalysis(id);
    if (!analysis) return Response.json({ message: ARTIFACT_MESSAGES.analysisUnavailable }, { status: 404, headers: noStore });
    const records = await listArtifacts(id);
    return Response.json({ artifacts: toArtifactViews(records, new Date()) }, { status: 200, headers: noStore });
  } catch {
    return Response.json(internalError, { status: 500, headers: noStore });
  }
}
