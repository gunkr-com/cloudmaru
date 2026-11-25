import type { NextRequest } from "next/server";
import { getLocale } from "@/i18n/server";
import { ARTIFACT_KINDS } from "@/lib/artifacts/labels";
import { renderArtifactFile } from "@/lib/artifacts/render-file";
import { toArtifactView } from "@/lib/artifacts/artifact-job";
import { tierSchema } from "@/lib/catalog/schema";
import { getAnalysis } from "@/services/db/analyses";
import { listArtifacts } from "@/services/db/artifacts";
import type { ArtifactKind } from "@/types/artifact";
import type { Tier } from "@/types/catalog";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const noStore = { "Cache-Control": "no-store", Vary: "Cookie" };
const missingMessage = { message: "artifacts.downloadMissing" };
const internalMessage = { message: "artifacts.internalError" };

function errorResponse(status: 400 | 404 | 500, body: { message: string }): Response {
  return Response.json(body, { status, headers: noStore });
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {

    const params = request.nextUrl.searchParams;
    const tierResult = tierSchema.safeParse(params.get("tier"));
    const kindValue = params.get("kind");
    if (!tierResult.success || !kindValue || !ARTIFACT_KINDS.includes(kindValue as ArtifactKind)) {
      return errorResponse(400, missingMessage);
    }
    const tier = tierResult.data as Tier;
    const kind = kindValue as ArtifactKind;

    const { id } = await context.params;
    if (!uuidPattern.test(id)) return errorResponse(404, missingMessage);
    const analysis = await getAnalysis(id);
    if (!analysis || analysis.status !== "succeeded" || !analysis.result) return errorResponse(404, missingMessage);

    const record = (await listArtifacts(id)).find((entry) => entry.tier === tier && entry.kind === kind);
    if (!record) return errorResponse(404, missingMessage);
    const artifact = toArtifactView(record, new Date());
    if (artifact.status !== "succeeded" || artifact.content === null) return errorResponse(404, missingMessage);

    const locale = await getLocale();
    const file = renderArtifactFile(kind, artifact.content as never, { result: analysis.result, tier }, locale);
    return new Response(file.body, {
      status: 200,
      headers: {
        "Content-Type": file.contentType,
        "Content-Disposition": `attachment; filename="${file.filename}"`,
        "Cache-Control": "private, no-store",
        Vary: "Cookie",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return errorResponse(500, internalMessage);
  }
}
