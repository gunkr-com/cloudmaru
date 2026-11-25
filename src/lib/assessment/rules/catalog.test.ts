import { describe, expect, it } from "vitest";
import raw from "@/catalog/assessment-rules.json";
import {
  assessmentRuleCatalogSchema, loadAssessmentRules, listAssessmentRules,
  parseAssessmentRules, AssessmentCatalogError,
} from "./catalog";
import { ruleFixtures } from "./fixtures.test-data";

const ids = ["web-https-only", "web-minimum-tls", "storage-https-only", "storage-minimum-tls",
  "storage-disallow-blob-public-access", "sql-minimum-tls", "keyvault-soft-delete",
  "keyvault-purge-protection", "nsg-management-ports"];
const changed = (edit: (value: typeof raw) => void) => {
  const value = structuredClone(raw);
  edit(value);
  return value;
};

describe("assessment catalog v1", () => {
  it("loads exactly the approved first pack with deterministic listing", () => {
    const catalog = loadAssessmentRules();
    expect(catalog.rules.map(rule => rule.id).sort()).toEqual([...ids].sort());
    expect(listAssessmentRules(catalog).map(rule => rule.id)).toEqual([...ids].sort());
    const reversed = { ...catalog, rules: [...catalog.rules].reverse() };
    expect(listAssessmentRules(reversed)).toEqual(listAssessmentRules(catalog));
    expect(reversed.rules[0]).toEqual(catalog.rules.at(-1));
  });
  it("lists exact applicable types without parent-type or unsupported passing fallbacks", () => {
    const catalog = loadAssessmentRules();
    expect(listAssessmentRules(catalog, "microsoft.web/sites/slots").map(r => r.id))
      .toEqual(["web-https-only", "web-minimum-tls"]);
    for (const type of ["microsoft.web/sites/config", "microsoft.compute/virtualmachines",
      "microsoft.hybridcompute/machines", "microsoft.documentdb/databaseaccounts", "microsoft.synapse/workspaces"]) {
      expect(listAssessmentRules(catalog, type)).toEqual([]);
    }
  });
  it("validates bilingual documents and approved official sources for every rule", () => {
    for (const rule of loadAssessmentRules().rules) {
      for (const field of [rule.title, rule.description, rule.remediation]) {
        expect(field.en.trim()).not.toBe("");
        expect(field.en).not.toMatch(/\p{Script=Hangul}/u);
        expect(field.ko).toMatch(/\p{Script=Hangul}/u);
      }
      for (const source of rule.sources) {
        expect(new URL(source).hostname).toBe("learn.microsoft.com");
        expect(new URL(source).protocol).toBe("https:");
      }
    }
  });
  it.each([
    ["duplicate ID", (v: typeof raw) => { v.rules.push(v.rules[0]); }],
    ["unsupported evaluator", (v: typeof raw) => { v.rules[0].evaluatorId = "model-verdict"; }],
    ["wrong evaluator mapping", (v: typeof raw) => { v.rules[0].evaluatorId = "sql-minimum-tls"; }],
    ["wrong target", (v: typeof raw) => { v.rules[0].resourceTypes = ["microsoft.compute/virtualmachines"]; }],
    ["missing rule", (v: typeof raw) => { v.rules.pop(); }],
    ["wrong required path", (v: typeof raw) => { v.rules[0].requiredPaths = ["/properties/other"]; }],
    ["missing language", (v: typeof raw) => { v.rules[0].title.ko = ""; }],
    ["whitespace documentation", (v: typeof raw) => { v.rules[0].remediation.en = "   "; }],
    ["wrong version", (v: typeof raw) => { v.schemaVersion = 2; }],
  ])("rejects %s", (_name, edit) => {
    const invalid = changed(edit);
    expect(assessmentRuleCatalogSchema.safeParse(invalid).success).toBe(false);
    expect(() => parseAssessmentRules(invalid)).toThrow(AssessmentCatalogError);
  });
  it.each(["properties.httpsOnly", "/properties/~2bad", "/properties/", "/properties/../httpsOnly", ""])
    ("rejects malformed property pointer %s", path => {
      expect(assessmentRuleCatalogSchema.safeParse(changed(v => { v.rules[0].requiredPaths = [path]; })).success).toBe(false);
    });
  it.each(["https://evil.example/path", "http://learn.microsoft.com/en-us/azure/templates/microsoft.web/sites",
    "https://learn.microsoft.com.evil.example/path", "https://user@learn.microsoft.com/en-us/azure/templates/microsoft.web/sites",
    "https://learn.microsoft.com/en-us/unreviewed", "https://learn.microsoft.com:444/en-us/azure/templates/microsoft.web/sites"])
    ("rejects unapproved source %s", source => {
      expect(assessmentRuleCatalogSchema.safeParse(changed(v => { v.rules[0].sources = [source]; })).success).toBe(false);
    });
  it("rejects unknown fields at every level and sanitized errors do not echo input", () => {
    for (const value of [{ ...raw, extra: true }, { ...raw, rules: [{ ...raw.rules[0], modelPrompt: "secret-value" }] },
      changed(v => { Object.assign(v.rules[0].title, { extra: true }); })]) {
      expect(assessmentRuleCatalogSchema.safeParse(value).success).toBe(false);
      expect(() => parseAssessmentRules(value)).toThrow("assessment-catalog-invalid");
    }
  });
  it("provides explicit pass/violation/missing/malformed fixtures per rule for the next engine step", () => {
    expect(Object.keys(ruleFixtures).sort()).toEqual([...ids].sort());
    for (const cases of Object.values(ruleFixtures)) {
      expect(cases.map(c => c.verdict)).toEqual(["pass", "violation", "unknown", "unknown"]);
      expect(cases[2].properties).toEqual({});
      expect(cases[3].reasonCode).toBe("invalid-data");
    }
  });
});
