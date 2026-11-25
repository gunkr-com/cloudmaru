import type { MessageKey } from "@/i18n/messages/types";
import { z } from "zod";
import type { WorkspaceInput } from "@/types/workspace";
import { isSupportedRegion } from "./regions";

export const workspaceInputSchema: z.ZodType<WorkspaceInput> = z.object({
  name: z.string({ error: "workspace.errors.nameRequired" satisfies MessageKey }).trim()
    .min(1, "workspace.errors.nameRequired" satisfies MessageKey)
    .max(80, "workspace.errors.nameTooLong" satisfies MessageKey),
  companyName: z.string({ error: "workspace.errors.companyInvalid" satisfies MessageKey }).trim()
    .max(120, "workspace.errors.companyTooLong" satisfies MessageKey)
    .nullable().transform(value => value || null),
  defaultRegion: z.string({ error: "workspace.errors.regionRequired" satisfies MessageKey }).trim()
    .refine(isSupportedRegion, "workspace.errors.regionUnsupported" satisfies MessageKey),
});
