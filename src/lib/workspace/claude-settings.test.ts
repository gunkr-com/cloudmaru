import { expect, it } from "vitest";
import { claudeApiKeyEnvSchema } from "./claude-settings";

it("accepts dedicated key references and an explicit disabled state", () => {
  expect(claudeApiKeyEnvSchema.parse(" CLOUDSIGHT_CLAUDE_KEY_ACME ")).toBe("CLOUDSIGHT_CLAUDE_KEY_ACME");
  expect(claudeApiKeyEnvSchema.parse(null)).toBeNull();
});
it.each(["", "ANTHROPIC_API_KEY", "HOME", "CLOUDSIGHT_CLAUDE_KEY_", "CLOUDSIGHT_CLAUDE_KEY_acme", "CLOUDSIGHT_CLAUDE_KEY_A\nB", "fake-secret-value", "CLOUDSIGHT_CLAUDE_KEY_" + "A".repeat(65), undefined])("rejects non-reference input %s", value => {
  expect(claudeApiKeyEnvSchema.safeParse(value).success).toBe(false);
});
