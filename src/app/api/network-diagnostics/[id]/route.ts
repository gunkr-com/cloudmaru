import { z } from "zod";
import { getNetworkDiagnostic } from "@/services/db/network-diagnostics";
import { sanitizeNetworkDiagnostic } from "@/lib/network-diagnostics/presentation";
const json = (body: unknown, status: number) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await context.params;
    if (!z.uuid().safeParse(id).success) return json({ code: "not-found" }, 404);
    const record = await getNetworkDiagnostic(id);
    return record ? json({ ...record, result: record.result ? sanitizeNetworkDiagnostic(record.result) : null }, 200) : json({ code: "not-found" }, 404);
  } catch {
    return json({ code: "internal" }, 500);
  }
}
