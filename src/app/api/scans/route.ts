import { after } from "next/server";
import { readJsonBody, SCAN_BODY_MAX_BYTES } from "@/lib/scans/read-json-body";
import { runLiveScanJob, startScan } from "@/lib/scans/scan-job";
import { getCurrentWorkspace } from "@/services/current-workspace";
import { reserveLiveScan, createImportScan, completeScan, failScan } from "@/services/db/scans";
import { getWorkspaceAzureSettings } from "@/services/db/workspace-azure";
import { createCertificateTokenProvider } from "@/services/azure/credential";
import { collectInventoryRows } from "@/services/azure/resource-graph";

// live 스캔의 전체 제한 시간은 10분이다.
export const maxDuration = 600;
const headers = { "Cache-Control": "no-store" };
const json = (body: unknown, status: number) => Response.json(body, { status, headers });

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await readJsonBody(request, SCAN_BODY_MAX_BYTES);
    if (!body.ok) return json({ code: body.code }, body.code === "import-too-large" ? 413 : 400);
    const workspace = await getCurrentWorkspace();
    const result = await startScan({ workspaceId: workspace.id, body: body.value, now: new Date() }, {
      getWorkspaceAzureSettings,
      reserveLiveScan,
      createImportScan,
      schedule: task => after(task),
      failScan,
      runJob: job => runLiveScanJob(job, {
        getWorkspaceAzureSettings,
        createTokenProvider: createCertificateTokenProvider,
        collectInventoryRows,
        completeScan,
        failScan,
        now: () => new Date(),
      }),
    });
    const { status, ...payload } = result;
    return json(payload, status);
  } catch {
    return json({ code: "internal" }, 500);
  }
}
