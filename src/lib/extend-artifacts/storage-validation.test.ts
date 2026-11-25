// @vitest-environment node
import { expect, it } from "vitest";
import { processedFixture } from "@/lib/extend/proposal.test-data";
import { ids } from "@/lib/completion/fixtures.test-data";
import type { ExtensionArtifact } from "@/types/extension";
import { validateArtifactMembers } from "./storage-validation";

const f = processedFixture();
const text = { en: "Attach the new workload", ko: "새 워크로드를 연결합니다." };
const binding = { id: ids.network, extensionId: f.result.id, workspaceId: f.result.workspaceId,
  sourceScanId: f.result.sourceScanId, tier: "low" as const, kind: "guide" as const, createdAt: f.result.createdAt };
function artifact(): ExtensionArtifact {
  return { schemaVersion: 1, ...binding, content: { overview: text, prerequisites: [text], cautions: [],
    steps: [{ title: text, goal: text, instructions: [text], componentIds: ["postgres-flex-b1ms"],
      reusedResourceIds: [f.result.plans[0].reusedResources[0].resourceId], verification: text }] } };
}
const context = { extension: f.result, catalogData: { catalog: f.context.catalog, support: f.context.support }, inventory: f.context.inventory };
it("checks the strict envelope and exact saved selected option membership", () => {
  expect(validateArtifactMembers(artifact(), binding, context)).toEqual(artifact());
  for (const patch of [{ tier: "ha" }, { sourceScanId: ids.oldScan }, { workspaceId: ids.otherWorkspace },
    { extensionId: ids.assessment }, { createdAt: "2026-11-12T13:00:00.000Z" }, { evidence: {} }]) {
    expect(() => validateArtifactMembers({ ...artifact(), ...patch }, binding, context)).toThrow("validation-failed");
  }
});
it("rejects catalog components outside this option, scan IDs outside reused set, and missing inventory/catalog members", () => {
  const value = artifact();
  if (value.kind !== "guide") throw Error();
  value.content.steps[0].componentIds = ["virtual-network"]; // reused components are also selected
  expect(() => validateArtifactMembers(value, binding, context)).not.toThrow();
  value.content.steps[0].componentIds = ["app-service-linux-b1"];
  expect(() => validateArtifactMembers(value, binding, context)).toThrow("validation-failed");
  value.content.steps[0].componentIds = ["postgres-flex-b1ms"];
  value.content.steps[0].reusedResourceIds = ["/subscriptions/00000000-0000-4000-8000-000000000001/resourcegroups/fake/providers/microsoft.web/sites/other"];
  expect(() => validateArtifactMembers(value, binding, context)).toThrow("validation-failed");
  expect(() => validateArtifactMembers(artifact(), binding, { ...context, inventory: { ...context.inventory, resources: [] } })).toThrow("validation-failed");
  expect(() => validateArtifactMembers(artifact(), binding, { ...context, catalogData: { ...context.catalogData,
    catalog: { ...context.catalogData.catalog, components: [] } } })).toThrow("validation-failed");
});
it("checks Bicep claimed IDs independently of the later semantic/compiler validator", () => {
  const b = { ...binding, kind: "bicep" as const };
  const plan = f.result.plans[0];
  const value = { schemaVersion: 1, ...b, content: { code: "param location string", parameters: [], deploymentNotes: [text],
    existingResourceIds: plan.reusedResources.map(r => r.resourceId), newComponentIds: plan.newItems.map(r => r.componentId), unverifiedDraft: true } };
  expect(() => validateArtifactMembers(value, b, context)).not.toThrow();
  value.content.newComponentIds.push("app-service-linux-b1");
  expect(() => validateArtifactMembers(value, b, context)).toThrow("validation-failed");
});
