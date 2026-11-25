import { expect, it } from "vitest";
import { common as en } from "../en/common";
import { common as ko } from "../ko/common";
it("common 사전 구조가 같다", () => {
  const keys = (value: object): unknown => Object.fromEntries(Object.entries(value).map(([key, leaf]) => [key, typeof leaf === "string" ? "string" : keys(leaf)]));
  expect(keys(ko)).toEqual(keys(en));
});
