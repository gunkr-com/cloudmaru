import { z } from "zod";
import type { WorkspaceAzureSettings } from "@/types/scan";

const guidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const guid = (error: string) => z.string({ error }).regex(guidPattern, { error }).toLowerCase();
export const subscriptionIdsSchema = z.array(guid("subscriptions-invalid"), { error: "subscriptions-invalid" })
  .max(50, { error: "subscriptions-invalid" }).transform(ids => [...new Set(ids)]);

export const azureSettingsInputSchema = z.object({
  tenantId: guid("tenant-id-invalid"),
  clientId: guid("client-id-invalid"),
  certificatePath: z.string({ error: "certificate-path-invalid" }).trim()
    .min(1, { error: "certificate-path-invalid" }).max(1024, { error: "certificate-path-invalid" })
    .refine(path => path.startsWith("/") && !path.includes("\0"), { error: "certificate-path-invalid" }),
  certificatePasswordEnv: z.string({ error: "password-env-invalid" })
    .refine(value => value === "" || /^[A-Z][A-Z0-9_]{2,63}$/.test(value), { error: "password-env-invalid" })
    .nullable().transform(value => value === "" ? null : value),
  subscriptionIds: subscriptionIdsSchema.refine(ids => ids.length > 0, { error: "subscriptions-invalid" }),
}).transform(({ subscriptionIds, ...connection }): WorkspaceAzureSettings => ({ connection, subscriptionIds }));
