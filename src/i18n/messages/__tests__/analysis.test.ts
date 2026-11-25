import { expect, it } from "vitest";
import { analysis as en } from "../en/analysis";
import { analysis as ko } from "../ko/analysis";
it("analysis 사전 구조가 같다", () => {
  const keys = (value: object): unknown => Object.fromEntries(Object.entries(value).map(([key, leaf]) => [key, typeof leaf === "string" ? "string" : keys(leaf)]));
  expect(keys(ko)).toEqual(keys(en));
});
