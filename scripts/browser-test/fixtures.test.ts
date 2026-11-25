import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildInventory } from "@/lib/inventory/build-inventory";
import { parseImportedInventory } from "@/lib/inventory/import";
import { queryInventoryResources } from "@/lib/inventory/resource-table";
import { familiesByStage, inventoryFacts } from "@/lib/inventory/view";

// docs/BROWSER_TESTING.md UC4 states these numbers. Change both together.
const fixture = (name: string) => JSON.parse(readFileSync(join(process.cwd(), "scripts/browser-test/fixtures", name), "utf8")) as unknown;

function importInventory(name: string) {
  const parsed = parseImportedInventory(fixture(name));
  if (!parsed.ok) throw new Error(parsed.code);
  return buildInventory({ source: "import", collectedAt: new Date("2026-11-07T00:00:00Z"), resourceRows: parsed.rows.resources, containerRows: parsed.rows.containers });
}

describe("browser test import fixtures", () => {
  const inventory = importInventory("inventory-import.json");
  const query = (q: string, type: string | null = null, page = 1) =>
    queryInventoryResources({ resources: inventory.resources, containers: inventory.containers, relations: inventory.relations, skippedRows: inventory.skippedRows }, { q, type, page });

  it("matches the summary tiles in UC4", () => {
    expect(inventoryFacts(inventory.summary)).toEqual({ resources: 57, subscriptions: 2, resourceGroups: 4, regions: 4, untagged: 33 });
    expect(inventory.skippedRows).toBe(1);
  });

  it("matches the by-family list in UC4", () => {
    const stages = familiesByStage(inventory.resources);
    const families = new Map(stages.flatMap(stage => stage.families.map(item => [item.family, item.count] as const)));
    expect([...families.values()].reduce((sum, count) => sum + count, 0)).toBe(57);
    expect(families.get("web-app")).toBe(33);
    expect(families.get("app-plan")).toBe(2);
  });

  it("matches the resource table pages, search and type filter in UC4", () => {
    expect(query("")).toMatchObject({ matched: 57, from: 1, to: 50, pageCount: 2 });
    expect(query("", null, 2)).toMatchObject({ from: 51, to: 57 });
    expect(query("app-dev-1")).toMatchObject({ matched: 10 });
    expect(query("", "microsoft.web/sites")).toMatchObject({ matched: 33 });
    expect(query("no-such-resource")).toMatchObject({ matched: 0 });
  });

  it("rejects the invalid file and has no resources in the empty file", () => {
    expect(parseImportedInventory(fixture("inventory-import-invalid.json"))).toEqual({ ok: false, code: "import-invalid" });
    expect(importInventory("inventory-import-empty.json").resources).toHaveLength(0);
  });

  it("uses only placeholder subscription IDs", () => {
    expect(inventory.summary.subscriptionIds.every(id => id.startsWith("00000000-0000-4000-8000-"))).toBe(true);
  });
});
