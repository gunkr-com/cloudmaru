import { describe, expect, it } from "vitest";
import { buildArtifactDownloadHref } from "./links";

const id = "11111111-1111-4111-8111-111111111111";

describe("artifact links", () => {
  it("결과물 다운로드 경로를 만든다", () => {
    expect(buildArtifactDownloadHref(id, "low", "bicep")).toBe(`/api/analyses/${id}/artifacts/download?tier=low&kind=bicep`);
  });

});
