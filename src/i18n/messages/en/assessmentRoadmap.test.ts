import { expect, it } from "vitest";
import { assessmentRoadmap as en } from "./assessmentRoadmap";
import { assessmentRoadmap as ko } from "../ko/assessmentRoadmap";
it("defines matching localized roadmap operational states", () => {
  for (const dictionary of [en, ko]) {
    expect(dictionary.errors["no-data"]).toBeTruthy();
    expect(dictionary.ui.reload).toBeTruthy();
    expect(dictionary.ui.coverage).toContain("{included}");
  }
  expect(Object.keys(ko.errors)).toEqual(Object.keys(en.errors));
});

it("defines report labels",()=>{expect(en).toHaveProperty("report.title","Assessment report");});
