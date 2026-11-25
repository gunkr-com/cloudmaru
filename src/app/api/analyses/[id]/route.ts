import { resolveAnalysisStatus } from "@/lib/analysis/analysis-job";
import { getAnalysis } from "@/services/db/analyses";

const headers = { "Cache-Control": "no-store" };
const json = (body: unknown, status: number) => Response.json(body, { status, headers });
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await context.params;
  if (!uuidPattern.test(id)) return json({ message: "common.analysisNotFound" }, 404);
  try {
    const record = await getAnalysis(id);
    if (!record) return json({ message: "common.analysisNotFound" }, 404);
    return json({ id, ...resolveAnalysisStatus(record, new Date()) }, 200);
  } catch {
    return json({ message: "analysis.requestFailed" }, 500);
  }
}
