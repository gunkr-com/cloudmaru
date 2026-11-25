import { describe, expect, it } from "vitest";
import { loadAssessmentRules } from "./catalog";
import { ruleFixtures } from "./fixtures.test-data";
import { evaluateAssessmentRules, evaluateRule } from "./engine";
import { codeFindingSchema, coverageSchema } from "@/lib/completion/schema";
import { normalizeResourceRow } from "@/lib/inventory/normalize";

const catalog = loadAssessmentRules();
const subscriptionId = "00000000-0000-4000-8000-000000000001";
function resource(type: string, properties: Record<string, unknown>, name = "sample") {
  return normalizeResourceRow({ id: `/subscriptions/${subscriptionId}/resourceGroups/sample/providers/${type}/${name}`,
    name, type, properties, subscriptionId, resourceGroup: "sample" });
}

describe("assessment rules", () => {
  for (const rule of catalog.rules) {
    for (const [index, fixture] of ruleFixtures[rule.id].entries()) {
      it(`${rule.id} fixture ${index}`, () => {
        const finding = evaluateRule(rule, resource(rule.resourceTypes[0], fixture.properties));
        expect(finding.verdict).toBe(fixture.verdict);
        expect(finding.reasonCode).toBe(fixture.reasonCode);
        expect(codeFindingSchema.safeParse(finding).success).toBe(true);
        expect(finding.evidence.map(e => e.propertyPath)).toEqual(expect.arrayContaining([...rule.requiredPaths]));
      });
    }
  }
  it("accounts for 30 rows, unsupported types and unknown findings without inventing tag policy", () => {
    const rows = Array.from({length: 30}, (_, i) => resource(i < 25 ? "microsoft.web/sites" : "microsoft.hybridcompute/machines", {}, `sample-${i}`));
    const result = evaluateAssessmentRules(rows, "2026-11-11T00:00:00Z");
    expect(result.coverage).toEqual({ total: 30, included: 25, excluded: 5, reasons: [{code: "no-applicable-rule", count: 5}] });
    expect(coverageSchema.safeParse(result.coverage).success).toBe(true);
    expect(result.findings).toHaveLength(50);
    expect(result.findings.every(f => f.verdict === "unknown")).toBe(true);
    expect(evaluateAssessmentRules([...rows].reverse(), result.evaluatedAt)).toEqual(result);
  });
  it("canonical identity and version determine stable UUIDs", () => {
    const rule = catalog.rules[0];
    const row = resource(rule.resourceTypes[0], {});
    const first = evaluateRule(rule, row);
    expect(evaluateRule(rule, {...row, id: ` ${row.id.toUpperCase()}/ `}).id).toBe(first.id);
    expect(evaluateRule({...rule, version: "2.0.0"}, row).id).not.toBe(first.id);
  });
  it("does not serialize arbitrary malformed secret values into evidence", () => {
    const rule = catalog.rules.find(r => r.id === "web-https-only")!;
    const finding = evaluateRule(rule, resource(rule.resourceTypes[0], {httpsOnly: {password: "private-value"}}));
    expect(finding.evidence[0].observation).toEqual({state: "invalid", reason: "invalid-data"});
    expect(JSON.stringify(finding)).not.toContain("private-value");
  });
  it("treats malformed intermediate objects and explicit null separately from missing", () => {
    const rule = catalog.rules.find(r => r.id === "web-minimum-tls")!;
    for (const siteConfig of [null, [], "bad"]) {
      expect(evaluateRule(rule, resource(rule.resourceTypes[0], {siteConfig})).reasonCode).toBe("invalid-data");
    }
  });
  it("uses exact TLS enums and conservative purge prerequisites", () => {
    for (const [id, properties, verdict] of [
      ["web-minimum-tls", {siteConfig: {minTlsVersion: "1.3"}}, "pass"],
      ["storage-minimum-tls", {minimumTlsVersion: "TLS1_3"}, "unknown"],
      ["web-minimum-tls", {siteConfig: {minTlsVersion: "TLS1_2"}}, "unknown"],
      ["keyvault-purge-protection", {enablePurgeProtection: false}, "unknown"],
      ["keyvault-purge-protection", {enablePurgeProtection: true, enableSoftDelete: false}, "unknown"],
      ["keyvault-purge-protection", {enablePurgeProtection: false, enableSoftDelete: true}, "violation"],
    ] as const) {
      const rule = catalog.rules.find(r => r.id === id)!;
      expect(evaluateRule(rule, resource(rule.resourceTypes[0], properties)).verdict).toBe(verdict);
    }
  });
  it("rejects duplicate canonical IDs and invalid identities without leaking input", () => {
    const row = resource("microsoft.web/sites", {});
    const result = evaluateAssessmentRules([row, {...row}, {...row, id: "bad-secret"}], "2026-11-11T00:00:00Z");
    expect(result.coverage).toEqual({total: 3, included: 0, excluded: 3, reasons: [{code: "invalid-data", count: 3}]});
    expect(result.findings).toEqual([]);
  });
});

it("masks malformed secret scalars even when another required field is missing", () => {
  const rule = catalog.rules.find(r => r.id === "keyvault-purge-protection")!;
  const finding = evaluateRule(rule, resource(rule.resourceTypes[0], {enablePurgeProtection: "Password=private-value"}));
  expect(JSON.stringify(finding)).not.toContain("private-value");
});
it("records actual NSG association paths and does not fabricate an empty rule list", () => {
  const rule = catalog.rules.find(r => r.id === "nsg-management-ports")!;
  const nsg = resource(rule.resourceTypes[0], ruleFixtures[rule.id][1].properties);
  const nic = resource("microsoft.network/networkinterfaces", {networkSecurityGroup: {id: nsg.id}});
  const finding = evaluateRule(rule, nsg, [nsg, nic]);
  expect(finding.verdict).toBe("violation");
  expect(finding.evidence).toContainEqual({resourceId: nic.id, propertyPath: "/properties/networkSecurityGroup/id", observation: {state: "present", value: nsg.id}});
  expect(finding.evidence[0].observation).not.toEqual({state: "present", value: []});
});
it("preserves collected empty associations instead of labeling them missing", () => {
  const rule = catalog.rules.find(r => r.id === "nsg-management-ports")!;
  const nsg = resource(rule.resourceTypes[0], {securityRules: [], networkInterfaces: [], subnets: []});
  expect(evaluateRule(rule, nsg).evidence).toContainEqual({resourceId: nsg.id, propertyPath: "/properties/subnets", observation: {state: "present", value: []}});
});
it("rejects mismatched resource type/subscription identity as excluded invalid data", () => {
  const row = resource("microsoft.web/sites", {httpsOnly: true});
  const result = evaluateAssessmentRules([{...row, type: "microsoft.storage/storageaccounts"},
    {...row, subscriptionId: "00000000-0000-4000-8000-000000000002", id: row.id + "2"}], "2026-11-11T00:00:00Z");
  expect(result.coverage.included).toBe(0);
  expect(result.coverage.reasons).toEqual([{code: "invalid-data", count: 2}]);
});
it("rejects invalid evaluation timestamps and validates an empty local result", () => {
  expect(() => evaluateAssessmentRules([], "not-a-timestamp")).toThrow("assessment-input-invalid");
  expect(evaluateAssessmentRules([], "2026-11-11T00:00:00Z").coverage).toEqual({total: 0, included: 0, excluded: 0, reasons: []});
});
it("explicit purge=false is a violation with a collected soft-delete boolean", () => {
  const rule = catalog.rules.find(r => r.id === "keyvault-purge-protection")!;
  expect(evaluateRule(rule, resource(rule.resourceTypes[0], {enableSoftDelete: false, enablePurgeProtection: false})).verdict).toBe("violation");
});
it("public network switches without an approved rule do not become violations", () => {
  const cosmos = resource("microsoft.documentdb/databaseaccounts", {publicNetworkAccess: "Enabled"});
  const storage = resource("microsoft.storage/storageaccounts", {publicNetworkAccess: "Enabled", allowBlobPublicAccess: false,
    supportsHttpsTrafficOnly: true, minimumTlsVersion: "TLS1_2"});
  const result = evaluateAssessmentRules([cosmos, storage], "2026-11-11T00:00:00Z");
  expect(result.findings.every(f => f.verdict === "pass")).toBe(true);
  expect(result.coverage).toMatchObject({total: 2, included: 1, excluded: 1});
});
