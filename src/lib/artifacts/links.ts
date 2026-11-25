import type { ArtifactKind } from "@/types/artifact";
import type { Tier } from "@/types/catalog";

export function buildArtifactDownloadHref(analysisId: string, tier: Tier, kind: ArtifactKind): string {
  return `/api/analyses/${analysisId}/artifacts/download?tier=${tier}&kind=${kind}`;
}
