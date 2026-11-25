import { expect, it } from "vitest";
import { extensionModelOutputSchema, EXTENSION_MODEL_OUTPUT_JSON_SCHEMA } from "./model-output-schema";
import { fixture, savedProposal } from "./proposal.test-data";

it("accepts only explicit role bindings to new subnet IDs or model aliases without defaulting old fields", () => {
  const { raw } = fixture();
  raw.plans[0].deploymentBindings = [{ role: "gateway-subnet", target: { kind: "new-subnet", subnetProposalId: "workload-subnet" } }];
  expect(extensionModelOutputSchema.safeParse(raw).success).toBe(true);
  raw.plans[0].deploymentBindings = [{ role: "container-environment-subnet", target: { kind: "reused-subnet", resourceId: "r000001" } }];
  expect(extensionModelOutputSchema.safeParse(raw).success).toBe(true);
  raw.plans[0].deploymentBindings[0].target = { kind: "reused-subnet", resourceId: "/subscriptions/private/subnet" };
  expect(extensionModelOutputSchema.safeParse(raw).success).toBe(false);
  delete raw.plans[0].deploymentBindings;
  raw.plans[0].subnetProposals[0].delegation = "Microsoft.App/environments";
  expect(extensionModelOutputSchema.safeParse(raw).success).toBe(true);
  Object.assign(raw.plans[0].subnetProposals[0], { delegation: "Microsoft.Web/serverFarms" });
  expect(extensionModelOutputSchema.safeParse(raw).success).toBe(false);
});


it("accepts only alias-shaped model references, keeping strict nested objects and JSON schema", () => {
  const { raw } = fixture();
  expect(extensionModelOutputSchema.safeParse(raw).success).toBe(true);
  expect(extensionModelOutputSchema.safeParse(savedProposal).success).toBe(false);
  expect(EXTENSION_MODEL_OUTPUT_JSON_SCHEMA.additionalProperties).toBe(false);
  const schema = JSON.stringify(EXTENSION_MODEL_OUTPUT_JSON_SCHEMA);
  expect(schema).toContain('"resourceId"');
  expect(schema).toContain('"addressPrefixes"');
});
it.each(["requestTitle", "reason", "parent"])("rejects unknown nested %s fields", field => {
  const { raw } = fixture();
  const target = field === "requestTitle" ? raw.requestTitle : field === "reason" ? raw.plans[0].reusedResources[0].reason : raw.plans[0].subnetProposals[0].parent;
  Object.assign(target, { url: "https://evil.example" });
  expect(extensionModelOutputSchema.safeParse(raw).success).toBe(false);
});

it.each([undefined, -1, 1.5, 1001, Infinity, "1"])("requires an explicit bounded integer instanceCount: %s", instanceCount => {
  const { raw } = fixture();
  Object.assign(raw.plans[0].newItems[0], { instanceCount });
  expect(extensionModelOutputSchema.safeParse(raw).success).toBe(false);
});
it("requires instanceCount in the provider JSON schema too", () => {
  expect(EXTENSION_MODEL_OUTPUT_JSON_SCHEMA).toMatchObject({ properties: { plans: { items: {
    properties: { newItems: { items: { required: expect.arrayContaining(["instanceCount"]) } } },
  } } } });
});
