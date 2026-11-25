import { expect, it } from "vitest";
import { roadmapFixture, roadmapModelFixture } from "./fixtures.test-data";
import { validateRoadmapOutput } from "./model";
import { validateRoadmapForWrite } from "./write-validation";
import { buildRoadmapContext, readRoadmapBinding } from "./context";

it("validates resolved complete content against the immutable saved basis without changing phase ids or order", () => {
  const fixture = roadmapFixture();
  const context = buildRoadmapContext(fixture.parent, fixture.catalogData);
  const { assessment, catalogData } = readRoadmapBinding(context);
  const generatedAt = "2026-11-12T10:01:00Z";
  const parsed = validateRoadmapOutput(roadmapModelFixture(context.payload), context, generatedAt);
  if (!parsed.ok) throw Error("invalid fixture");
  parsed.value.phases[0].id = "saved-first";
  const before = structuredClone(parsed.value);
  expect(validateRoadmapForWrite(parsed.value, { assessment, catalogData,
    createdAt: assessment.local.evaluatedAt, completedAt: generatedAt })).toEqual(before);
  expect(parsed.value).toEqual(before);
});
