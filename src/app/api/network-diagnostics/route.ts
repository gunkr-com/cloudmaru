import { readJsonBody } from "@/lib/scans/read-json-body";
import { networkInputSchema, validateNetworkMembers, NETWORK_BODY_MAX_BYTES, NetworkInputError } from "@/lib/network-diagnostics/validation";
import { diagnosePath } from "@/lib/network";
import { toCompletionSourceScan } from "@/lib/completion/source-scan";
import { getCurrentWorkspace } from "@/services/current-workspace";
import { getNetworkSourceScan, reserveNetworkDiagnostic, completeNetworkDiagnostic, failNetworkDiagnostic } from "@/services/db/network-diagnostics";

const json = (body: unknown, status: number) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
export async function POST(request: Request): Promise<Response> {
  let reservedId: string | undefined;
  try {
    const body = await readJsonBody(request, NETWORK_BODY_MAX_BYTES);
    if (!body.ok) return json({ code: "invalid-query" }, 400);
    const parsed = networkInputSchema.safeParse(body.value);
    if (!parsed.success) return json({ code: "invalid-query" }, 400);
    const input = parsed.data;
    const workspace = await getCurrentWorkspace();
    if (workspace.id !== input.workspaceId) return json({ code: "workspace-changed" }, 409);
    const saved = await getNetworkSourceScan(input.sourceScanId);
    if (!saved || saved.scan.workspaceId !== workspace.id) return json({ code: "scan-missing" }, 404);
    if (saved.scan.status !== "succeeded") return json({ code: "scan-not-succeeded" }, 409);
    if (!saved.inventory) return json({ code: "internal" }, 500);
    const resources = validateNetworkMembers(saved.inventory.resources, input.query);
    const reserved = await reserveNetworkDiagnostic(input);
    if (!reserved) return json({ code: "scan-missing" }, 404);
    reservedId = reserved.id;
    const engine = diagnosePath(resources, input.query, toCompletionSourceScan(saved.scan, saved.inventory));
    if (!await completeNetworkDiagnostic(reserved.id, engine)) throw new Error("operation failed");
    return json({ id: reserved.id }, 201);
  } catch (error) {
    if (reservedId) {
      try { await failNetworkDiagnostic(reservedId, "internal"); } catch { /* 읽기 시 stale 판정으로 복구한다. */ }
    }
    if (!reservedId && error instanceof NetworkInputError) return json({ code: error.code }, error.code === "inventory-too-large" ? 413 : 400);
    return json({ code: "internal" }, 500);
  }
}
