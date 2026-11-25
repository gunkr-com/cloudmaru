import { expect, it } from "vitest";
import { extension, completeSnapshot } from "@/lib/completion/fixtures.test-data";
import { loadCatalog } from "@/lib/catalog/load";
import type { ExtensionResult } from "@/types/extension";
import { validateExtensionStorageMembers } from "./storage-validation";

it("does not accept structural-only synthetic catalog identities", () => {
  expect(() => validateExtensionStorageMembers(extension, completeSnapshot.inventory, loadCatalog())).toThrow("validation-failed");
});

it("checks every evidence resource against saved inventory membership", () => {
  const catalog = loadCatalog();
  const result: ExtensionResult = structuredClone(extension);
  for (const plan of result.plans) {
    plan.referenceArchitectureId = catalog.architectures[0].id;
    plan.reusedResources[0].componentId = "virtual-network";
    plan.newItems[0].componentId = "app-service-linux-b1";
    if ("data" in plan.incrementalCost) plan.incrementalCost.data.lines[0].componentId = "app-service-linux-b1";
    plan.checks[0].componentIds = ["virtual-network"];
  }
  expect(() => validateExtensionStorageMembers(result, completeSnapshot.inventory, catalog)).not.toThrow();
  result.plans[0].checks[0].evidence.push({
    resourceId: `${completeSnapshot.inventory.resources[0].id}-outside`, propertyPath: "/location",
    observation: { state: "present", value: "canadacentral" },
  });
  expect(() => validateExtensionStorageMembers(result, completeSnapshot.inventory, catalog)).toThrow("validation-failed");
});
