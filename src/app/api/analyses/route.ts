import { getCurrentWorkspace } from "@/services/current-workspace";
import { after } from "next/server";
import { acquireOperatorPrices } from "@/services/operator-prices";
import { ANALYSIS_LLM_TIMEOUT_MS, runAnalysisJob, startAnalysis } from "@/lib/analysis/analysis-job";
import { completeAnalysis, failAnalysis, createAnalysis, getAnalysis } from "@/services/db/analyses";
import { hasWorkspaceClaudeKey, requestAnalysisStructuredOutput } from "@/services/workspace-claude";

// src/lib/jobs/timing.ts의 JOB_MAX_DURATION_SECONDS와 같은 값입니다. Next.js는 리터럴을 요구합니다.
export const maxDuration = 300;
const headers = { "Cache-Control": "no-store" };
const json = (body: unknown, status: number) => Response.json(body, { status, headers });

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try { body = await request.json(); } catch { return json({ errors: ["analysis.invalidInput"] }, 400); }
  try {
    const workspace = await getCurrentWorkspace();
    const result = await startAnalysis({ workspaceId: workspace.id, body, now: new Date() }, {
      acquireOperatorPrices,
      getAnalysis,
      hasWorkspaceClaudeKey,
      createAnalysis,
      schedule: (task) => after(task),
      runJob: (job) => runAnalysisJob(job, {
        llm: (req) => requestAnalysisStructuredOutput(job.id, { ...req, timeoutMs: Math.min(req.timeoutMs ?? ANALYSIS_LLM_TIMEOUT_MS, ANALYSIS_LLM_TIMEOUT_MS) }),
        completeAnalysis,
        failAnalysis,
      }),
    });
    const { status, ...payload } = result;
    return json(payload, status);
  } catch {
    return json({ message: "analysis.startFailed" }, 500);
  }
}
