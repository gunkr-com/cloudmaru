import { expect, it } from "vitest";
import { roadmapErrorMessageKey } from "./error-message";
it("maps roadmap failure labels with a safe unknown fallback", () => {
  for (const code of ["timeout", "interrupted", "no-data", "workspace-changed", "validation-failed", "assessment-missing", "assessment-not-succeeded", "invalid-body"]) expect(roadmapErrorMessageKey(code)).toBe(`assessmentRoadmap.errors.${code}`);
  for (const code of ["key-unavailable", "not-configured"]) expect(roadmapErrorMessageKey(code)).toBe("assessmentRoadmap.errors.key-unavailable");
  for (const code of ["SECRET", "constructor", "__proto__"]) expect(roadmapErrorMessageKey(code)).toBe("assessmentRoadmap.errors.internal");
});
