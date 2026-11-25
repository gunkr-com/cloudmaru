import type { z } from "zod";
import type { extensionSupportCatalogSchema, reusePolicySchema } from "@/lib/catalog/extension-support-schema";

export type ExtensionSupportCatalog = z.infer<typeof extensionSupportCatalogSchema>;
export type ReusePolicy = z.infer<typeof reusePolicySchema>;
