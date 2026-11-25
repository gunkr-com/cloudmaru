import { expect, it } from "vitest";
import { overview as en } from "../en/overview";
import { overview as ko } from "../ko/overview";

const shape = (value: object): unknown => Object.fromEntries(Object.entries(value).map(([key, leaf]) => [key, typeof leaf === "string" ? "string" : shape(leaf)]));
const placeholders = (value: object): unknown => Object.fromEntries(Object.entries(value).map(([key, leaf]) =>
  [key, typeof leaf === "string" ? [...leaf.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort() : placeholders(leaf)]));

it("keeps the overview dictionaries in the same shape with the same placeholders", () => {
  expect(shape(ko)).toEqual(shape(en));
  expect(placeholders(ko)).toEqual(placeholders(en));
});

it("states that the overview has no health score and does not refresh external data", () => {
  expect(en.noScore).toContain("no overall health score");
  expect(ko.noScore).toContain("건강 점수는 없습니다");
  expect(en.description).toContain("does not query Azure, Claude or prices");
  expect(ko.description).toContain("조회하지 않습니다");
});
