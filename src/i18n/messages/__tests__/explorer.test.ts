import { expect, it } from "vitest";
import { en } from "../en";
import { ko } from "../ko";
it("registers matching explorer vocabulary in both locales", () => {
  expect(Object.keys(en.explorer).sort()).toEqual(Object.keys(ko.explorer).sort());
  expect(en.explorer.csv).toBe("Export filtered CSV"); expect(ko.explorer.csv).toBeTruthy();
});
