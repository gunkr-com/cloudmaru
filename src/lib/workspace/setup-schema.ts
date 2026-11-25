import { z } from "zod";
import { claudeApiKeyEnvSchema } from "./claude-settings";

export const workspaceIdSchema = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
export const workspaceModelSchema = z.string().trim().regex(/^claude-[a-z0-9][a-z0-9.-]{0,99}$/);
export const workspaceSecretSchema = z.discriminatedUnion("source", [
  z.object({ source: z.literal("key"), apiKey: z.string().trim().min(1).max(4096).regex(/^[\x21-\x7e]+$/), model: workspaceModelSchema.optional() }).strict(),
  z.object({ source: z.literal("env"), apiKeyEnv: claudeApiKeyEnvSchema.unwrap(), model: workspaceModelSchema.optional() }).strict(),
  z.object({ source: z.literal("disabled") }).strict(),
]);
export type WorkspaceSecret = z.infer<typeof workspaceSecretSchema>;
