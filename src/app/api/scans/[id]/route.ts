import { resolveScanStatus } from "@/lib/scans/timing";
import { getScan } from "@/services/db/scans";

const headers = { "Cache-Control": "no-store" };
const json = (body: unknown, status: number) => Response.json(body, { status, headers });
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await context.params;
    if (!uuidPattern.test(id)) return json({ code: "not-found" }, 404);
    const record = await getScan(id);
    if (!record) return json({ code: "not-found" }, 404);
    const scan = resolveScanStatus(record, new Date());
    return json({
      id: scan.id,
      workspaceId: scan.workspaceId,
      source: scan.source,
      status: scan.status,
      errorCode: scan.errorCode,
      subscriptionIds: scan.subscriptionIds,
      summary: scan.summary,
      collectedAt: scan.collectedAt,
      createdAt: scan.createdAt,
      completedAt: scan.completedAt,
    }, 200);
  } catch {
    return json({ code: "internal" }, 500);
  }
}
