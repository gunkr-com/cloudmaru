import { expect, it } from "vitest";
import { workspaceSecretSchema } from "./setup-schema";
it("accepts only explicit scoped sources, bounded keys and model IDs", () => {
  expect(workspaceSecretSchema.parse({ source: "key", apiKey: " synthetic ", model: "claude-opus-5-5" })).toEqual({ source: "key", apiKey: "synthetic", model: "claude-opus-5-5" });
  for (const value of [{ source: "env", apiKeyEnv: "ANTHROPIC_API_KEY" }, { source: "key", apiKey: "" }, { source: "key", apiKey: "key\nvalue" }, { source: "key", apiKey: "key", model: "https://evil" }]) expect(workspaceSecretSchema.safeParse(value).success).toBe(false);
});
