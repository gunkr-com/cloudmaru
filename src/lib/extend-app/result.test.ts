import { expect, it } from "vitest";
import { processedFixture, proposalInventory, proposalCatalog, proposalSupport } from "@/lib/extend/proposal.test-data";
import { buildExtensionDisplay, selectExtensionTier } from "./result";

it("projects only selected pinned labels, sources, resource names and parent ranges without mutating the result", () => {
  const { result } = processedFixture();
  const original = JSON.stringify(result);
  const catalog = structuredClone(proposalCatalog);
  catalog.components.find(c => c.id === "postgres-flex-b1ms")!.name = { en: "Pinned database", ko: "저장된 데이터베이스" };
  catalog.architectures[0].sources[0].title = "Pinned source";
  const display = buildExtensionDisplay(result, { catalog, support: proposalSupport }, proposalInventory);
  expect(display.result).toEqual(result);
  expect(display.components["postgres-flex-b1ms"].name.en).toBe("Pinned database");
  expect(display.resources[result.plans[0].reusedResources[0].resourceId].name).toBe("sample-vnet");
  expect(display.resources[result.plans[0].reusedResources[0].resourceId].addressPrefixes).toEqual(["10.1.0.0/16"]);
  expect(Object.keys(display.components)).toHaveLength(8);
  expect(JSON.stringify(display)).not.toMatch(/saved_evidence|aliasToResourceId|unitPrice|productName|skuName/);
  expect(JSON.stringify(result)).toBe(original);
});
it("rejects missing catalog membership and missing source labels rather than inventing services", () => {
  const { result } = processedFixture();
  expect(() => buildExtensionDisplay(result, { catalog: { ...proposalCatalog, components: [] }, support: proposalSupport }, proposalInventory)).toThrow("display-unavailable");
  expect(() => buildExtensionDisplay(result, { catalog: proposalCatalog, support: proposalSupport }, { ...proposalInventory, resources: [] })).toThrow("display-unavailable");
});
it("reopens a valid tier and otherwise selects the saved recommendation", () => {
  expect(selectExtensionTier("ha", "balanced")).toBe("ha");
  expect(selectExtensionTier(["low", "ha"], "balanced")).toBe("balanced");
  expect(selectExtensionTier("invented", "low")).toBe("low");
});
it("retains the pinned snapshot date even when no costs can be calculated", () => {
  const { result } = processedFixture();
  for (const plan of result.plans) plan.incrementalCost = { state: "unavailable", reason: "price-unavailable" };
  const display = buildExtensionDisplay(result, { catalog: proposalCatalog, support: proposalSupport }, proposalInventory);
  expect(display.priceAsOf).toBe(proposalCatalog.prices.asOf);
});
