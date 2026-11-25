import { expect, it } from "vitest";
import { artifacts as en } from "../en/artifacts";
import { artifacts as ko } from "../ko/artifacts";
it("artifacts 사전 구조가 같다", () => {
  const keys = (value: object): unknown => Object.fromEntries(Object.entries(value).map(([key, leaf]) => [key, typeof leaf === "string" ? "string" : keys(leaf)]));
  expect(keys(ko)).toEqual(keys(en));
});
