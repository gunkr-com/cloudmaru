// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { collectAssessmentInsights } from "./insights";
import { completeSnapshot, ids } from "@/lib/completion/fixtures.test-data";
import { summarizeInventory } from "@/lib/inventory/summarize";
import { advisorResultSchema, actualCostWindowsSchema } from "@/lib/completion/schema";
import { advisorCatalog } from "@/lib/assessment/advisor-catalog";
import type { ScanRecord } from "@/types/scan";

const time = "2026-11-11T15:30:00Z";
const inventory = completeSnapshot.inventory;
const rid = inventory.resources.find(r => r.type === "microsoft.web/sites")!.id;
const scan: ScanRecord = { id: ids.scan, workspaceId: ids.workspace, source: "live", status: "succeeded",
  subscriptionIds: [ids.subscription], summary: summarizeInventory(inventory.resources, inventory.containers),
  collectedAt: "2026-11-10T12:00:00Z", createdAt: "2026-11-10T12:00:00Z", completedAt: time, errorCode: null };
const args = { scan, inventory, requested: { advisor: true, actualCost: true }, retrievedAt: time };
const recommendation = (name: string, type = "cc9d34f5-f9b8-4d4f-9de7-98b45c698a49") => ({
  id: `/subscriptions/${ids.subscription}/providers/Microsoft.Advisor/recommendations/${name}`,
  properties: { recommendationTypeId: type, resourceMetadata: { resourceId: rid },
    shortDescription: { problem: "PRIVATE RAW TEXT" }, url: "https://untrusted.example" },
});
const cost = (rows: unknown[][] = [[0, rid, "CAD"], [-2, null, "USD"], [5, rid + "-gone", "USD"]]) => ({ properties: {
  columns: [{ name: "Currency", type: "String" }, { name: "ResourceId", type: "String" }, { name: "PreTaxCost", type: "Number" }],
  rows: rows.map(([amount, id, currency]) => [currency, id, amount]), nextLink: null,
} });
function transport(handler: (url: string, init: RequestInit) => Response) {
  return { getToken: vi.fn(async () => "PRIVATE TOKEN"), fetch: vi.fn<typeof fetch>(async (url, init) => handler(String(url), init!)) };
}
const good = (url: string) => Response.json(url.includes("Microsoft.Advisor")
  ? { value: [recommendation("mapped"), recommendation("unknown", "00000000-0000-0000-0000-000000000001")] } : cost());

describe("Assess insights integration (mock HTTP only)", () => {
  it("maps all seven reviewed catalog types with exact saved inventory membership", async () => {
    const resources = advisorCatalog.entries.map((entry, index) => ({ ...inventory.resources[0],
      id: `/subscriptions/${ids.subscription}/resourcegroups/rg-synthetic/providers/${entry.resourceTypes[0]}/item-${index}`,
      type: entry.resourceTypes[0], name: `item-${index}`, parentId: null }));
    const rows = advisorCatalog.entries.map((entry, index) => ({ ...recommendation(`rec-${index}`), properties: {
      recommendationTypeId: entry.recommendationTypeId.toUpperCase(), resourceMetadata: { resourceId: resources[index].id } } }));
    const deps = transport(() => Response.json({ value: rows }));
    const result = await collectAssessmentInsights({ ...args, inventory: { ...inventory, resources },
      scan: { ...scan, summary: summarizeInventory(resources, inventory.containers) }, requested: { advisor: true, actualCost: false } }, deps);
    expect(result.advisor).toMatchObject({ state: "available", data: { mappingVersion: advisorCatalog.version,
      coverage: { total: 7, included: 7, excluded: 0, reasons: [] }, recommendations: advisorCatalog.entries.map((entry, index) => ({
        ruleId: entry.ruleId, actionId: entry.actionId, resourceId: resources[index].id })) } });
  });

  it("distinguishes no billing data from an explicit returned zero while preserving Advisor", async () => {
    const deps = transport((url, init) => url.includes("Microsoft.Advisor") ? good(url)
      : JSON.parse(init.body as string).timePeriod.from === "2026-11-01T00:00:00.000Z"
        ? new Response(null, { status: 204 }) : Response.json(cost([[0, rid, "CAD"]])));
    const result = await collectAssessmentInsights(args, deps);
    expect(result.advisor.state).toBe("partial");
    expect(result.actualCost.monthToDate).toEqual({ state: "unavailable", reason: "no-data" });
    expect(result.actualCost.trailing30Days).toMatchObject({ state: "available", data: { totals: [{ currency: "CAD", amount: 0 }] } });
  });

  it("joins catalog-only Advisor coverage and independent signed original currencies without mutating the scan", async () => {
    const before = JSON.stringify(args);
    const deps = transport(good);
    const result = await collectAssessmentInsights(args, deps);
    expect(result.advisor).toMatchObject({ state: "partial", reasons: ["unmapped-advisor-type"], data: {
      retrievedAt: time, recommendations: [{ resourceId: rid }], coverage: { total: 2, included: 1, excluded: 1 } } });
    for (const window of [result.actualCost.monthToDate, result.actualCost.trailing30Days]) {
      expect(window).toMatchObject({ state: "available", data: { retrievedAt: time,
        totals: [{ currency: "CAD", amount: 0 }, { currency: "USD", amount: 3 }], rows: [
          { attribution: { kind: "resource" } }, { amount: -2, attribution: { reason: "missing-resource-id" } },
          { attribution: { reason: "outside-inventory" } }] } });
    }
    expect(actualCostWindowsSchema.safeParse(result.actualCost).success).toBe(true);
    if (result.advisor.state === "partial") expect(advisorResultSchema.safeParse(result.advisor.data).success).toBe(true);
    expect(result.collection).toMatchObject({ retrievedAt: time, advisorScope: { paginationComplete: true },
      costScopes: { monthToDate: { paginationComplete: true }, trailing30Days: { paginationComplete: true } } });
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE|untrusted|certificate|getToken/u);
    expect(JSON.stringify(args)).toBe(before);
    expect(deps.fetch).toHaveBeenCalledTimes(3);
    expect(deps.fetch.mock.calls.every(([url, init]) => String(url).startsWith("https://management.azure.com/subscriptions/")
      && ["GET", "POST"].includes(init!.method!) && init!.redirect === "error")).toBe(true);
  });

  it.each(["advisor", "month", "trailing"])("%s failure does not erase the other insights", async failed => {
    const deps = transport((url, init) => {
      const isAdvisor = url.includes("Microsoft.Advisor");
      const body = init.body ? JSON.parse(init.body as string) : null;
      const isMonth = body?.timePeriod.from === "2026-11-01T00:00:00.000Z";
      return (failed === "advisor" ? isAdvisor : !isAdvisor && (failed === "month" ? isMonth : !isMonth))
        ? new Response("PRIVATE ERROR", { status: 403 }) : good(url);
    });
    const result = await collectAssessmentInsights(args, deps);
    expect(result.advisor.state).toBe(failed === "advisor" ? "unavailable" : "partial");
    expect(result.actualCost.monthToDate.state).toBe(failed === "month" ? "unavailable" : "available");
    expect(result.actualCost.trailing30Days.state).toBe(failed === "trailing" ? "unavailable" : "available");
    expect(JSON.stringify(result)).not.toContain("PRIVATE");
  });

  it("retains each successful subscription and collection scope on partial permissions", async () => {
    const deps = transport(url => url.includes(ids.otherSubscription) ? new Response(null, { status: 403 }) : good(url));
    const result = await collectAssessmentInsights({ ...args, scan: { ...scan, subscriptionIds: [ids.subscription, ids.otherSubscription] } }, deps);
    expect(result.advisor).toMatchObject({ state: "partial", reasons: ["forbidden", "unmapped-advisor-type"] });
    expect(result.collection.advisorScope).toMatchObject({ requestedSubscriptionIds: [ids.subscription, ids.otherSubscription],
      availableSubscriptionIds: [ids.subscription], paginationComplete: false });
    for (const window of [result.actualCost.monthToDate, result.actualCost.trailing30Days]) {
      expect(window).toMatchObject({ state: "partial", reasons: ["forbidden"], data: { scope: { availableSubscriptionIds: [ids.subscription] } } });
    }
  });

  it.each(["import", "missing", "not-requested"])("%s skips credentials and network, keeping explicit states", async mode => {
    const deps = transport(good);
    const result = await collectAssessmentInsights({ ...args, scan: { ...scan, source: mode === "import" ? "import" : "live" },
      requested: { advisor: mode !== "not-requested", actualCost: mode !== "not-requested" } }, mode === "missing" ? null : deps);
    const state = mode === "not-requested" ? { state: "not-requested" } : { state: "unavailable", reason: mode === "import" ? "not-supported" : "not-configured" };
    expect(result.advisor).toEqual(state);
    expect(result.actualCost).toEqual({ schemaVersion: 1, monthToDate: state, trailing30Days: state });
    expect(result.collection).toEqual({ retrievedAt: time, advisorScope: null, costScopes: null });
    expect(deps.getToken).not.toHaveBeenCalled(); expect(deps.fetch).not.toHaveBeenCalled();
  });

  it.each([true, false])("allows independently requesting Advisor=%s", async advisor => {
    const deps = transport(good);
    const result = await collectAssessmentInsights({ ...args, requested: { advisor, actualCost: !advisor } }, deps);
    expect(result.advisor.state).toBe(advisor ? "partial" : "not-requested");
    expect(result.actualCost.monthToDate.state).toBe(advisor ? "not-requested" : "available");
    expect(deps.fetch).toHaveBeenCalledTimes(advisor ? 1 : 2);
  });

  it("preserves bounded partial pagination in both collectors", async () => {
    const deps = transport(url => Response.json(url.includes("Microsoft.Advisor")
      ? { value: [recommendation("first")], nextLink: url + "&$skiptoken=next" }
      : { properties: { ...cost().properties, nextLink: url + "&$skiptoken=next" } }));
    const result = await collectAssessmentInsights(args, { ...deps, maxPages: 1 });
    expect(result.advisor).toMatchObject({ state: "partial", reasons: ["collection-partial"] });
    expect(result.actualCost.monthToDate).toMatchObject({ state: "partial", reasons: ["collection-partial"] });
    expect(result.actualCost.trailing30Days).toMatchObject({ state: "partial", reasons: ["collection-partial"] });
    expect(deps.fetch).toHaveBeenCalledTimes(3);
  });

  it("rejects invalid server inputs before obtaining any token", async () => {
    const deps = transport(good);
    for (const invalid of [{ ...args, retrievedAt: "PRIVATE INVALID" }, { ...args, scan: { ...scan, status: "pending" as const } },
      { ...args, inventory: { ...inventory, resources: [{ ...inventory.resources[0], subscriptionId: ids.otherSubscription }] } }]) {
      await expect(collectAssessmentInsights(invalid, deps)).rejects.toThrow("Azure request failed (disallowed).");
    }
    expect(deps.getToken).not.toHaveBeenCalled();
  });
});
