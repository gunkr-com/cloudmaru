import type { ArtifactView } from "@/lib/artifacts/artifact-job";
import type { ArtifactKind } from "@/types/artifact";
import type { Tier } from "@/types/catalog";

export type ArtifactsApi = {
  list(analysisId: string): Promise<{ ok: true; artifacts: ArtifactView[] } | { ok: false; status: number }>;
  request(analysisId: string, tier: Tier, kind: ArtifactKind): Promise<
    | { ok: true; status: 200 | 202; artifact: ArtifactView }
    | { ok: false; status: number; message?: string; errors?: string[]; workspaceId?: string }
  >;
};

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const value: unknown = await response.json();
    return value && typeof value === "object" ? value as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

export const artifactsApi: ArtifactsApi = {
  async list(analysisId) {
    try {
      const response = await fetch(`/api/analyses/${encodeURIComponent(analysisId)}/artifacts`, { method: "GET" });
      const body = await readJson(response);
      if (!response.ok || !Array.isArray(body.artifacts)) return { ok: false, status: response.status };
      return { ok: true, artifacts: body.artifacts as ArtifactView[] };
    } catch {
      return { ok: false, status: 0 };
    }
  },
  async request(analysisId, tier, kind) {
    try {
      const response = await fetch(`/api/analyses/${encodeURIComponent(analysisId)}/artifacts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier, kind }),
      });
      const body = await readJson(response);
      if ((response.status === 200 || response.status === 202) && body.artifact) {
        return { ok: true, status: response.status, artifact: body.artifact as ArtifactView };
      }
      return {
        ok: false,
        status: response.status,
        ...(typeof body.message === "string" ? { message: body.message } : {}),
        ...(typeof body.workspaceId === "string" ? { workspaceId: body.workspaceId } : {}),
        ...(Array.isArray(body.errors) ? { errors: body.errors.filter((error): error is string => typeof error === "string") } : {}),
      };
    } catch {
      return { ok: false, status: 0 };
    }
  },
};
