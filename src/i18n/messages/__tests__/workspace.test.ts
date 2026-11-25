import { expect, it } from "vitest";
import { workspace as en } from "../en/workspace";
import { workspace as ko } from "../ko/workspace";
it("workspace 사전 구조가 같다", () => {
  const keys = (value: object): unknown => Object.fromEntries(Object.entries(value).map(([key, leaf]) => [key, typeof leaf === "string" ? "string" : keys(leaf)]));
  expect(keys(ko)).toEqual(keys(en));
});
it("explains the dedicated reference and disabled state in both locales", () => {
  expect(en.claude.help).toContain("CLOUDSIGHT_CLAUDE_KEY_ACME");
  expect(ko.claude.help).toContain("CLOUDSIGHT_CLAUDE_KEY_ACME");
  expect(en.claude.unavailable).toContain("No API request");
  expect(ko.claude.unavailable).toContain("API 요청");
});
