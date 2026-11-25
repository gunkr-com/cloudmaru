import { expect, it } from "vitest";
import { validateExtensionForm } from "./form";
import { extensionInputSchema } from "@/lib/completion/schema";
import { loadExtensionSupportCatalog } from "@/lib/catalog/extension-support";
import { extension } from "@/lib/completion/fixtures.test-data";

const input = extension.input;
const values = { ...input, monthlyBudget: String(input.monthlyBudget) };
const options = { workspaceId: input.workspaceId, scanIds: [input.sourceScanId], regionIds: loadExtensionSupportCatalog().regions.map(r => r.id) };
it("uses the actual schema with full Korean requirements and the validated three regions", () => {
  expect(options.regionIds).toEqual(["canadacentral", "westus2", "centralus"]);
  for (const region of options.regionIds) {
    const result = validateExtensionForm({ ...values, description: "가".repeat(2000), region }, options);
    expect(result.ok).toBe(true);
    if (result.ok) expect(extensionInputSchema.parse(result.input).description).toHaveLength(2000);
  }
});
it.each([
  ["description", "a".repeat(2001)], ["description", "short"], ["expectedUsers", "wrong"],
  ["monthlyBudget", "9"], ["monthlyBudget", "12.5"], ["monthlyBudget", "Infinity"],
  ["monthlyBudget", "abc"], ["availability", "wrong"], ["region", "canadaeast"],
  ["sourceScanId", "foreign"],
])("rejects schema or membership error for %s", (field, value) => {
  const result = validateExtensionForm({ ...values, [field]: value }, options);
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.errors).toHaveProperty(field);
});
it("does not infer another scan or region when options change, and ignores spoofed owner fields", () => {
  expect(validateExtensionForm(values, { ...options, scanIds: [] }).ok).toBe(false);
  expect(validateExtensionForm(values, { ...options, regionIds: [] }).ok).toBe(false);
  const spoofed = { ...values, workspaceId: "foreign" };
  const result = validateExtensionForm(spoofed, options);
  expect(result.ok && result.input.workspaceId).toBe(input.workspaceId);
});
