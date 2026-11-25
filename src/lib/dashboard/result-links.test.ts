import { describe, expect, it } from "vitest";
import { buildResultHref, buildRerunHref, parseTierParam, RESULT_FOCUS_FLAG_PREFIX } from "@/lib/dashboard/result-links";

describe("result links", () => {
  it("accepts only a valid tier value", () => {
    expect(parseTierParam("ha")).toBe("ha");
    expect(parseTierParam(["balanced"])).toBe("balanced");
    expect(parseTierParam(undefined)).toBeNull();
    expect(parseTierParam("<script>")).toBeNull();
    expect(parseTierParam(["ha", "low"])).toBeNull();
  });
  it("builds safe in-app destinations and a focus key prefix", () => {
    expect(buildResultHref("abc", "ha")).toBe("/analyses/abc?tier=ha");
    expect(buildResultHref("abc")).toBe("/analyses/abc");
    expect(buildRerunHref("abc")).toBe("/analyses/new?from=abc");
    expect(RESULT_FOCUS_FLAG_PREFIX).toBe("cloudsight:focus-result:");
  });
});
