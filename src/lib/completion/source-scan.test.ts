// @vitest-environment node
import { describe, expect, it } from "vitest";
import { toCompletionSourceScan } from "./source-scan";
import { completeSnapshot, ids } from "./fixtures.test-data";
import { summarizeInventory } from "@/lib/inventory/summarize";
import { scanDiffSchema, sourceScanSchema } from "./schema";
import type { ScanInventory, ScanRecord } from "@/types/scan";

function snapshot() {
  const inventory: ScanInventory = { ...completeSnapshot.inventory, resources: completeSnapshot.inventory.resources.map(resource => ({ ...resource, observedFields: [] })) };
  const source = completeSnapshot.sourceScan;
  const scan: ScanRecord = { id: source.id, workspaceId: source.workspaceId, source: "live", status: "succeeded",
    subscriptionIds: source.subscriptionIds, summary: summarizeInventory(inventory.resources, inventory.containers),
    collectedAt: source.collectedAt, errorCode: null, createdAt: source.collectedAt, completedAt: source.collectedAt };
  return { scan, inventory };
}
describe("completion source scan", () => {
  it("accepts Azure subscription GUIDs with non-RFC version and variant bits", () => {
    const { scan, inventory } = snapshot();
    const subscription = "01234567-89ab-cdef-0123-456789abcdef";
    const original = scan.subscriptionIds[0];
    const replaced = JSON.parse(JSON.stringify(inventory).replaceAll(original, subscription)) as ScanInventory;
    expect(toCompletionSourceScan({ ...scan, subscriptionIds: [subscription] }, replaced))
      .toMatchObject({ subscriptionIds: [subscription], completeness: { state: "complete", reasons: [] } });
  });
  it("creates a validated immutable header from a successful complete snapshot", () => {
    const { scan, inventory } = snapshot(); const before = JSON.stringify({ scan, inventory });
    const value = toCompletionSourceScan(scan, inventory);
    expect(value).toMatchObject({ id: scan.id, workspaceId: scan.workspaceId, subscriptionIds: scan.subscriptionIds,
      status: "succeeded", completeness: { state: "complete", reasons: [] } });
    expect(sourceScanSchema.parse(value)).toEqual(value);
    expect(JSON.stringify({ scan, inventory })).toBe(before);
    expect(value).not.toHaveProperty("resources");
    expect(value).not.toHaveProperty("summary");
  });
  it("keeps legacy collection presence unknown rather than claiming complete", () => {
    const { scan, inventory } = snapshot();
    const legacy = { ...inventory, resources: inventory.resources.map(resource => {
      const { observedFields, ...old } = resource; expect(observedFields).toEqual([]); return old;
    }) };
    expect(toCompletionSourceScan(scan, legacy).completeness).toEqual({ state: "unknown", reasons: ["legacy-completeness-unknown"] });
  });
  it("does not certify uploaded subsets as complete or permit a missing row to become a confirmed deletion", () => {
    const { scan, inventory } = snapshot();
    const before = toCompletionSourceScan({ ...scan, source: "import" }, inventory);
    const subset = { ...inventory, resources: inventory.resources.slice(1) };
    const after = toCompletionSourceScan({ ...scan, id: ids.oldScan, source: "import",
      collectedAt: new Date(Date.parse(scan.collectedAt!) + 1000).toISOString(),
      summary: summarizeInventory(subset.resources, subset.containers) }, subset);
    for (const source of [before, after]) expect(source.completeness)
      .toEqual({ state: "unknown", reasons: ["import-scope-unverified"] });
    expect(scanDiffSchema.safeParse({ schemaVersion: 1, workspaceId: scan.workspaceId,
      baselineScan: before, comparisonScan: after, comparedAt: after.collectedAt,
      coverage: { total: inventory.resources.length, included: inventory.resources.length, excluded: 0, reasons: [] },
      counts: { added: 0, removed: 1, changed: 0, unknown: 0 },
      changes: [{ kind: "removed", resourceId: inventory.resources[0].id }] }).success).toBe(false);
  });
  it("retains independent partial and legacy reasons for imported files", () => {
    const { scan, inventory } = snapshot();
    const resources = inventory.resources.map(resource => {
      const { observedFields: omitted, ...legacy } = resource;
      expect(omitted).toEqual([]); return legacy;
    });
    expect(toCompletionSourceScan({ ...scan, source: "import" }, { ...inventory, resources, skippedRows: 1 }).completeness)
      .toEqual({ state: "partial", reasons: ["collection-partial", "import-scope-unverified", "legacy-completeness-unknown"] });
  });
  it("rejects a complete import header even when a consumer bypasses the converter", () => {
    const { scan, inventory } = snapshot();
    const complete = toCompletionSourceScan(scan, inventory);
    expect(sourceScanSchema.safeParse({ ...complete, source: "import" }).success).toBe(false);
    expect(sourceScanSchema.safeParse({ ...complete,
      completeness: { state: "unknown", reasons: ["import-scope-unverified"] } }).success).toBe(false);
  });
  it("keeps malformed ARM identities and mismatched resource facts from certifying completeness", () => {
    const { scan, inventory } = snapshot();
    const first = inventory.resources[0];
    const invalid = [
      { ...first, id: `/subscriptions/${first.subscriptionId}/garbage` },
      { ...first, id: `${first.id}?private-sentinel` },
      { ...first, id: `${first.id}#private-sentinel` },
      { ...first, id: `${first.id}\tprivate-sentinel` },
      { ...first, id: `${first.id}/../child` },
      { ...first, type: "microsoft.keyvault/vaults" },
      { ...first, resourceGroup: "different-group" },
    ];
    for (const resource of invalid) expect(toCompletionSourceScan(scan,
      { ...inventory, resources: [resource, ...inventory.resources.slice(1)] }).completeness)
      .toMatchObject({ state: "partial", reasons: expect.arrayContaining(["invalid-data"]) });
  });
  it("accepts matching nested and extension resource identities without changing the original inventory", () => {
    const { scan, inventory } = snapshot();
    const first = inventory.resources[0];
    const resource = { ...first, id: `${first.id}/providers/microsoft.insights/diagnosticsettings/settings`,
      type: "microsoft.insights/diagnosticsettings" };
    expect(toCompletionSourceScan(scan, { ...inventory, resources: [resource, ...inventory.resources.slice(1)] }).completeness)
      .toEqual({ state: "complete", reasons: [] });
  });
  it("preserves a valid alert name containing interior spaces as collected data", () => {
    const { scan, inventory } = snapshot();
    const first = inventory.resources[0];
    const resource = { ...first,
      id: `/subscriptions/${first.subscriptionId}/resourcegroups/${first.resourceGroup}/providers/microsoft.insights/metricalerts/cpu high alert`,
      type: "microsoft.insights/metricalerts", name: "CPU High Alert" };
    expect(toCompletionSourceScan(scan, { ...inventory, resources: [resource, ...inventory.resources.slice(1)] }).completeness)
      .toEqual({ state: "complete", reasons: [] });
  });
  it("marks skipped rows and unread requested subscriptions as partial without dropping requested scope", () => {
    const { scan, inventory } = snapshot();
    const unread = "00000000-0000-4000-8000-ffffffffffff";
    const value = toCompletionSourceScan({ ...scan, subscriptionIds: [...scan.subscriptionIds, unread] }, { ...inventory, skippedRows: 1 });
    expect(value.subscriptionIds).toContain(unread);
    expect(value.completeness).toEqual({ state: "partial", reasons: ["collection-partial", "scope-not-collected"] });
  });
  it("does not certify mismatched counts, duplicate IDs or out-of-scope resource facts", () => {
    const { scan, inventory } = snapshot();
    const first = inventory.resources[0];
    const cases = [
      { scan: { ...scan, summary: { ...scan.summary!, resourceCount: 999 } }, inventory },
      { scan, inventory: { ...inventory, resources: [...inventory.resources, first] } },
      { scan, inventory: { ...inventory, resources: [{ ...first, subscriptionId: "00000000-0000-4000-8000-ffffffffffff" }, ...inventory.resources.slice(1)] } },
      { scan, inventory: { ...inventory, resources: [{ ...first, id: first.id.replace(first.subscriptionId, "00000000-0000-4000-8000-ffffffffffff") }, ...inventory.resources.slice(1)] } },
    ];
    for (const value of cases) expect(toCompletionSourceScan(value.scan, value.inventory).completeness)
      .toMatchObject({ state: "partial", reasons: expect.arrayContaining(["invalid-data"]) });
  });
  it("retains legacy uncertainty when collection is also partial", () => {
    const { scan, inventory } = snapshot();
    const resources = inventory.resources.map(resource => { const { observedFields: omitted, ...legacy } = resource; expect(omitted).toEqual([]); return legacy; });
    expect(toCompletionSourceScan(scan, { ...inventory, resources, skippedRows: 2 }).completeness)
      .toEqual({ state: "partial", reasons: ["collection-partial", "legacy-completeness-unknown"] });
  });
  it("rejects nonsuccess, malformed headers and invalid presence metadata with a safe error", () => {
    const { scan, inventory } = snapshot();
    for (const value of [{ ...scan, status: "pending" as const }, { ...scan, summary: null },
      { ...scan, collectedAt: null }, { ...scan, id: "private-sentinel" },
      { ...scan, subscriptionIds: [] }, { ...scan, subscriptionIds: [...scan.subscriptionIds, scan.subscriptionIds[0]] }]) {
      expect(() => toCompletionSourceScan(value, inventory)).toThrow("Invalid completed scan.");
    }
    expect(() => toCompletionSourceScan(scan, { ...inventory, skippedRows: -1 })).toThrow("Invalid completed scan.");
    for (const observedFields of [["invented"], ["tags", "tags"], "tags", null]) {
      const malformed = { ...inventory, resources: [{ ...inventory.resources[0], observedFields }, ...inventory.resources.slice(1)] };
      expect(() => toCompletionSourceScan(scan, malformed as unknown as ScanInventory)).toThrow("Invalid completed scan.");
    }
  });
});
