import type { Inventory } from "@/types/inventory";
import { InventoryParseError, normalizeContainerRow, normalizeResourceRow } from "./normalize";
import { splitSubnets } from "./split-subnets";
import { buildExplicitRelations } from "./relations";
import { summarizeInventory } from "./summarize";

export function buildInventory(input: {
  source: "live" | "import";
  collectedAt: Date;
  resourceRows: readonly unknown[];
  containerRows: readonly unknown[];
}): Inventory {
  let skippedRows = 0;
  function normalizeUnique<T extends { id: string }>(rows: readonly unknown[], normalize: (row: unknown) => T): T[] {
    const byId = new Map<string, T>();
    for (const row of rows) {
      try {
        const item = normalize(row);
        if (!byId.has(item.id)) byId.set(item.id, item);
      } catch (error) {
        if (!(error instanceof InventoryParseError)) throw error;
        skippedRows++;
      }
    }
    return [...byId.values()];
  }

  const resources = splitSubnets(normalizeUnique(input.resourceRows, normalizeResourceRow));
  const containers = normalizeUnique(input.containerRows, normalizeContainerRow);
  const relations = buildExplicitRelations(resources);
  return {
    source: input.source,
    collectedAt: input.collectedAt.toISOString(),
    resources, containers, relations,
    summary: summarizeInventory(resources, containers),
    skippedRows,
  };
}
