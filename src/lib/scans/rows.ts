import { z } from "zod";
import { RowParseError } from "@/lib/db/pg-rows";
import type { ScanInventory, ScanRecord } from "@/types/scan";
import { parseScanErrorCode } from "./error-codes";

const object = z.record(z.string(), z.unknown());
const tags = z.record(z.string(), z.string());
const strings = z.array(z.string());
const count = z.number().int().nonnegative();
const counts = z.record(z.string(), count);
const summary = z.object({
  resourceCount: count, subscriptionIds: strings, byType: counts, byLocation: counts,
  byResourceGroup: counts, byFamily: counts, untaggedCount: count, resourceGroupCount: count.optional(),
});
const inventory = z.object({
  resources: z.array(z.object({
    id: z.string(), name: z.string(), type: z.string(), kind: z.string().nullable(),
    location: z.string().nullable(), subscriptionId: z.string(), resourceGroup: z.string(),
    sku: object.nullable(), tags, zones: strings, managedBy: z.string().nullable(),
    properties: object, parentId: z.string().nullable(),
    observedFields: z.array(z.enum(["tags", "zones", "managedBy", "sku", "properties", "location", "kind"]))
      .refine(fields => new Set(fields).size === fields.length).optional(),
  })),
  containers: z.array(z.object({
    id: z.string(), kind: z.enum(["subscription", "resourceGroup"]), name: z.string(),
    subscriptionId: z.string(), location: z.string().nullable(), tags,
  })),
  relations: z.array(z.object({ sourceId: z.string(), targetId: z.string(), type: z.enum(["connects_to", "secures", "routes", "hosts"]), evidence: strings })),
  skippedRows: count,
});
const time = z.union([z.string(), z.date()]).transform((value, ctx) => {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    ctx.addIssue({ code: "custom", message: "invalid-time" });
    return z.NEVER;
  }
  return date.toISOString();
});
const scanRow = z.object({
  id: z.string(), workspace_id: z.string(), source: z.enum(["live", "import"]),
  status: z.enum(["pending", "succeeded", "failed"]), subscription_ids: strings,
  summary: summary.nullable(), collected_at: time.nullable(), error_code: z.unknown(),
  created_at: time, completed_at: time.nullable(),
});

export function parseScanRow(value: unknown): ScanRecord {
  const parsed = scanRow.safeParse(value);
  if (!parsed.success) throw new RowParseError();
  const row = parsed.data;
  return {
    id: row.id, workspaceId: row.workspace_id, source: row.source, status: row.status,
    subscriptionIds: row.subscription_ids, summary: row.summary, collectedAt: row.collected_at,
    errorCode: row.error_code === null ? null : parseScanErrorCode(row.error_code),
    createdAt: row.created_at, completedAt: row.completed_at,
  };
}
export function parseScanInventory(value: unknown): ScanInventory {
  const parsed = inventory.safeParse(value);
  if (!parsed.success) throw new RowParseError();
  return parsed.data;
}
