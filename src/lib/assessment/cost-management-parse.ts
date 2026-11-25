import { z } from "zod";
import { actualCostRowSchema } from "@/lib/completion/schema";
import { isCanonicalArmResourceId } from "@/lib/inventory/normalize";
import type { ActualCost, ActualCostRow } from "@/types/assessment";

const pageSchema = z.object({ properties: z.object({
  columns: z.array(z.object({ name: z.string().min(1), type: z.enum(["Number", "String"]) })).min(1),
  rows: z.array(z.array(z.unknown())), nextLink: z.string().min(1).nullish(),
}) });
const invalid = () => new Error("Invalid cost response.");

/** 숫자/통화를 강제 변환하지 않는다. 잘못된 페이지는 합계를 왜곡하지 않도록 통째로 거절한다. */
export function parseCostPage(raw: unknown, subscriptionId: string, resourceIds: readonly string[]): {
  rows: ActualCostRow[]; nextLink: string | null;
} {
  if (raw === null) return { rows: [], nextLink: null };
  const parsed = pageSchema.safeParse(raw);
  if (!parsed.success) throw invalid();
  const { columns, rows, nextLink } = parsed.data.properties;
  const names = columns.map(c => c.name.toLowerCase());
  if (new Set(names).size !== names.length) throw invalid();
  const required = [["pretaxcost", "Number"], ["currency", "String"], ["resourceid", "String"]] as const;
  for (const [name, type] of required) {
    const index = names.indexOf(name);
    if (index < 0 || columns[index].type !== type) throw invalid();
  }
  const amountIndex = names.indexOf("pretaxcost");
  const currencyIndex = names.indexOf("currency");
  const resourceIndex = names.indexOf("resourceid");
  const inventory = new Set(resourceIds.map(id => id.trim().toLowerCase()).filter(isCanonicalArmResourceId));
  const result: ActualCostRow[] = [];
  for (const row of rows) {
    if (row.length !== columns.length) throw invalid();
    const rawId = row[resourceIndex];
    const id = typeof rawId === "string" ? rawId.trim().toLowerCase() : null;
    let attribution: ActualCostRow["attribution"];
    if (rawId === null || id === "") attribution = { kind: "unattributed", resourceId: null, reason: "missing-resource-id" };
    else if (!id || !isCanonicalArmResourceId(id)) attribution = { kind: "unattributed", resourceId: null, reason: "invalid-resource-id" };
    else attribution = inventory.has(id) ? { kind: "resource", resourceId: id }
      : { kind: "unattributed", resourceId: id, reason: "outside-inventory" };
    const value = actualCostRowSchema.safeParse({ subscriptionId, amount: row[amountIndex], currency: row[currencyIndex], attribution });
    if (!value.success) throw invalid();
    result.push(value.data);
  }
  return { rows: result, nextLink: nextLink ?? null };
}

export function costPeriods(retrievedAt: string): { monthToDate: ActualCost["period"]; trailing30Days: ActualCost["period"] } {
  if (!z.iso.datetime({ offset: true }).safeParse(retrievedAt).success) throw new Error("Invalid cost period.");
  const now = new Date(retrievedAt);
  const to = now.toISOString();
  return {
    monthToDate: { preset: "month-to-date", from: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString(), to },
    trailing30Days: { preset: "trailing30-days", from: new Date(now.getTime() - 30 * 86_400_000).toISOString(), to },
  };
}

/** 통화별 원금액만 합산하며 서로 다른 통화를 합치지 않는다. */
export function costTotals(rows: readonly ActualCostRow[]): ActualCost["totals"] {
  return [...new Set(rows.map(row => row.currency))].sort().map(currency => {
    const group = rows.filter(row => row.currency === currency);
    return { currency, amount: group.reduce((sum, row) => sum + row.amount, 0),
      subscriptionIds: [...new Set(group.map(row => row.subscriptionId))].sort() };
  });
}
