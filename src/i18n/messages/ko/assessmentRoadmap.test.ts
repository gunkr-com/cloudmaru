import { expect, it } from "vitest";
import { assessmentRoadmap } from "./assessmentRoadmap";
it("localizes no-data and status recovery", () => {
  expect(assessmentRoadmap.errors["no-data"]).toMatch(/조치/);
  expect(assessmentRoadmap.ui.reload).toMatch(/상태/);
});

it("defines report labels",()=>{expect(assessmentRoadmap).toHaveProperty("report.title","점검 보고서");});
