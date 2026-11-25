import { createTranslator } from "@/i18n/translate";
import { describe, expect, it } from "vitest";
import { reportFixture } from "./fixtures.test-data";
import { actualCost } from "@/lib/completion/fixtures.test-data";
import type { ActualCost } from "@/types/assessment";
import type { JsonValue } from "@/types/completion";
import { buildAssessmentReport } from "./document";

const serialized = (value: unknown) => JSON.stringify(value);
describe("saved assessment display projection", () => {
  it("projects every finding, pinned remediation/sources, provenance, coverage and independent states in EN/KO", () => {
    const {record,catalogData} = reportFixture();
    catalogData.rules.rules[0].title = { en: "Pinned rule", ko: "저장된 규칙" };
    const before = structuredClone(record);
    const en = buildAssessmentReport(record, catalogData, "en"), ko = buildAssessmentReport(record, catalogData, "ko");
    expect(en.sections.filter(s => s.id.startsWith("finding-"))).toHaveLength(record.result!.local.findings.length);
    expect(serialized(en)).toContain("Pinned rule"); expect(serialized(ko)).toContain("저장된 규칙");
    expect(serialized(en)).toContain(record.result!.sourceScan.collectedAt);
    expect(serialized(en)).toContain("Collection completeness"); expect(serialized(en)).toContain("Not requested");
    expect(serialized(en)).toContain("Rule pack version"); expect(record).toEqual(before);
    expect(en).not.toHaveProperty("inventory"); expect(en).not.toHaveProperty("usage");
  });
  it("preserves both signed original cost windows, real zero, attribution and partial/failed/no-data", () => {
    const {record,catalogData} = reportFixture();
    const cost: ActualCost = structuredClone(actualCost); cost.rows[0].amount = -0.000000000001; cost.scope.paginationComplete = false;
    for (const total of cost.totals) total.amount = cost.rows.filter(r => r.currency === total.currency).reduce((s,r) => s+r.amount,0);
    record.result!.actualCost.monthToDate = {state:"partial",data:cost,reasons:["collection-partial"]};
    record.result!.actualCost.trailing30Days = {state:"unavailable",reason:"no-data"};
    const doc = serialized(buildAssessmentReport(record,catalogData,"en"));
    expect(doc).toContain("-1e-12"); expect(doc).toContain("CAD"); expect(doc).toContain("USD");
    expect(doc).toContain("Last 30 days"); expect(doc).toContain("No billing data returned");
    expect(doc).toContain("Partially available"); expect(doc).toContain(cost.period.from);
    expect(doc).toContain(cost.retrievedAt); expect(doc).toContain("Original billing currencies");
    record.result!.actualCost.trailing30Days = {state:"failed",reason:"timeout"};
    expect(serialized(buildAssessmentReport(record,catalogData,"ko"))).toContain("시간");
  });
  it.each(["https://user:SECRET@host/path", "Pwd=SECRET", "sig=SECRET", {name:"API_TOKEN",value:"SECRET"}, {password:"SECRET"}])("redacts observation secrets using the shared diff policy: %j", value => {
    const {record,catalogData} = reportFixture();
    record.result!.local.findings[0].evidence[0].observation = {state:"present",value:value as JsonValue};
    expect(serialized(buildAssessmentReport(record,catalogData,"en")).includes("SECRET")).toBe(false);
  });
  it("does not turn arbitrary observed URLs into catalog links or expand inventory properties", () => {
    const {record,catalogData} = reportFixture();
    record.result!.local.findings[0].evidence[0].observation = {state:"present",value:"https://evil.example/image.png"};
    const doc = buildAssessmentReport(record,catalogData,"en");
    expect(serialized(doc)).toContain("https://evil.example/image.png");
    expect(doc.sections.flatMap(s=>s.blocks).filter(b=>b.kind === "source").every(b => b.kind === "source" && b.href.startsWith("https://learn.microsoft.com/"))).toBe(true);
  });
  it("fails closed on incomplete/foreign bindings or catalog/version mismatches", () => {
    const {record,catalogData} = reportFixture();
    expect(()=>buildAssessmentReport({...record,status:"pending",result:null},catalogData,"en")).toThrow("assessment-report-unavailable");
    expect(()=>buildAssessmentReport({...record,workspaceId:record.id},catalogData,"en")).toThrow("assessment-report-unavailable");
    catalogData.rules.version = "99.0.0";
    expect(()=>buildAssessmentReport(record,catalogData,"en")).toThrow("assessment-report-unavailable");
  });
});
it("redacts the returned evidence path as well as its value",()=>{
  const {record,catalogData}=reportFixture();
  record.result!.local.findings[0].evidence[0].propertyPath="/properties/settings/Pwd=PATHSECRET/value";
  record.result!.local.findings[0].evidence[0].observation={state:"present",value:"VALUESECRET"};
  const doc=JSON.stringify(buildAssessmentReport(record,catalogData,"en"));
  expect(doc.includes("PATHSECRET")).toBe(false);expect(doc.includes("VALUESECRET")).toBe(false);
});
it("preserves a long nonsecret JSON array without the model redactor's 20-row truncation",()=>{
  const {record,catalogData}=reportFixture();
  record.result!.local.findings[0].evidence[0].observation={state:"present",value:Array.from({length:40},(_,i)=>({label:`row-${i}`}))};
  const doc=JSON.stringify(buildAssessmentReport(record,catalogData,"en"));
  expect(doc.includes("row-39")).toBe(true);
});

it.each(["en", "ko"] as const)("uses roadmap-specific failure labels in %s with safe unknown fallback", locale => {
  const { record, catalogData } = reportFixture();
  record.roadmap.status = "failed";
  for (const code of ["timeout", "interrupted", "not-configured", "no-data", "private-unknown"]) {
    record.roadmap.error = { schemaVersion: 1, code: code as "timeout" };
    const report = buildAssessmentReport(record, catalogData, locale);
    const roadmap = JSON.stringify(report.sections.find(s => s.id === "roadmap"));
    const key = code === "not-configured" ? "key-unavailable" : code === "private-unknown" ? "internal" : code;
    expect(roadmap).toContain(createTranslator(locale)(`assessmentRoadmap.errors.${key}` as "assessmentRoadmap.errors.timeout"));
    expect(roadmap).not.toContain("private-unknown");
  }
});
