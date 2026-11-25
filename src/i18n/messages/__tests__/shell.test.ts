import { expect, it } from "vitest";
import { shell as en } from "../en/shell";
import { shell as ko } from "../ko/shell";
it("shell 사전 구조가 같다", () => {
  const keys = (value: object): unknown => Object.fromEntries(Object.entries(value).map(([key, leaf]) => [key, typeof leaf === "string" ? "string" : keys(leaf)]));
  expect(keys(ko)).toEqual(keys(en));
});
