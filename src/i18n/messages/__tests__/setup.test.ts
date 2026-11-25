import { expect, it } from "vitest";
import { setup as en } from "../en/setup";
import { setup as ko } from "../ko/setup";
it("provides matching setup translations and makes testing boundaries clear", () => {
  expect(Object.keys(en).sort()).toEqual(Object.keys(ko).sort());
  expect(en.testHelp).toContain("No generation");
  expect(ko.testHelp).toContain("생성");
});
