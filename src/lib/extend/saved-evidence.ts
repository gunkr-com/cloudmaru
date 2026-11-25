import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { extensionResultSchema } from "@/lib/completion/schema";
import { validateCatalog } from "@/lib/catalog/validate";
import { parseExtensionSupportCatalog } from "@/lib/catalog/extension-support-schema";
import { getExtensionCoreVersions } from "./process";
import type { ExtensionCoreData } from "./process";
import { ExtensionStorageError } from "./storage-validation";
import type { ExtensionResult } from "@/types/extension";

const envelope = z.strictObject({ schemaVersion: z.literal(1), catalog: z.unknown(), support: z.unknown(),
  sourceDigest: z.string().regex(/^[a-f0-9]{64}$/),
  resultDigest: z.string().regex(/^[a-f0-9]{64}$/) });
// JSONB may reorder object keys. Array ordering remains part of the saved result.
function digest(value: unknown): string {
  const json = JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : item);
  return createHash("sha256").update(json).digest("hex");
}
function core(raw: { catalog: unknown; support: unknown }): ExtensionCoreData {
  const shape = z.strictObject({components: z.unknown(), architectures: z.unknown(), prices: z.unknown()}).parse(raw.catalog);
  const parsed = validateCatalog(shape);
  if (!parsed.ok) throw new ExtensionStorageError();
  return { catalog: parsed.catalog, support: parseExtensionSupportCatalog(raw.support, parsed.catalog) };
}

/** Call only AFTER full semantic write validation. Private DB evidence, never a client payload.
 * The digest detects stored corruption; it is not a signature against someone rewriting the DB.
 */
export function sealExtensionEvidence(result: ExtensionResult, data: ExtensionCoreData, source: unknown) {
  const saved = core(data);
  const sourceDigest = digest(source);
  return { schemaVersion: 1 as const, ...saved, sourceDigest, resultDigest: digest([result, saved, sourceDigest]) };
}

/** Historical reads verify the original evidence without applying today's prices or engines. */
export function readExtensionEvidence(raw: unknown, rawResult: unknown, source: unknown): ExtensionCoreData {
  try {
    const saved = envelope.parse(raw), result = extensionResultSchema.parse(rawResult), data = core(saved);
    const versions = getExtensionCoreVersions(data.catalog, data.support);
    if (result.catalogVersion !== versions.catalogVersion || result.reusePolicyVersion !== versions.reusePolicyVersion
      || saved.sourceDigest !== digest(source) || saved.resultDigest !== digest([result, data, saved.sourceDigest])) throw new ExtensionStorageError();
    return data;
  } catch { throw new ExtensionStorageError(); }
}
