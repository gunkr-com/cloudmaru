import { expect, it } from "vitest";
import { reportFixture } from "@/lib/assessment/report/fixtures.test-data";
import { buildAssessmentReport } from "@/lib/assessment/report/document";
import { processedFixture } from "@/lib/extend/proposal.test-data";
import { buildExtensionDisplay } from "@/lib/extend-app/result";
import sample from "@/lib/analysis/fixtures/sample-result.json";
import type { AnalysisResult } from "@/types/analysis";
import { assessDocument, buildDocument, extendDocument } from "./document";
import { defaultSelection } from "./selection";
import { createTranslator } from "@/i18n/translate";
const owner=(workspaceId:string,companyName:string|null="Synthetic examples only · 합성 예제 전용")=>({workspaceId,name:"Synthetic offline demo",companyName});
it.each(["en", "ko"] as const)("projects saved Assess %s totals, coverage and complete redacted appendix without changing input", locale => {
    const f = reportFixture(), before = structuredClone(f);
    const legacy = buildAssessmentReport(f.record, f.catalogData, locale);
    const doc = assessDocument(f.record, f.catalogData, legacy, defaultSelection(locale), owner(f.record.workspaceId));
    expect(doc.kind).toBe("assess");
    expect(doc.metrics[0].value).toBe(String(f.record.result!.local.findings.length));
    expect(doc.sections.find(s => s.id === "findings")?.table?.rows).toHaveLength(f.record.result!.local.findings.length);
    expect(doc.appendix).toEqual(legacy.sections);
    expect(doc.workspaceId).toBe(f.record.workspaceId);
    expect(doc.chart?.rows.reduce((n, r) => n + r.value, 0)).toBe(f.record.result!.local.findings.length);
    expect(f).toEqual(before);
});
it("keeps original denominator and explicit filter scope; raw IDs never enter executive table", () => {
    const f = reportFixture();
    const doc = assessDocument(f.record, f.catalogData, buildAssessmentReport(f.record, f.catalogData, "en"), { ...defaultSelection("en"), severity: "critical" }, owner(f.record.workspaceId));
    expect(doc.total).toBe(f.record.result!.local.findings.length);
    expect(doc.included).toBe(f.record.result!.local.findings.filter(f => f.severity === "critical").length);
    expect(JSON.stringify(doc.sections)).not.toContain(f.record.result!.sourceScanId);
    expect(doc.partial).toBe(true);
});
it("Build preserves saved totals and snapshot even if line sum differs; source URLs come from saved reference", () => {
    const result = structuredClone(sample) as AnalysisResult;
    result.plans[0].cost.total = 123.456;
    const before = structuredClone(result);
    const doc = buildDocument({ id: "build-id", workspaceId: "owner-id", createdAt: "2026-11-13T12:00:00Z", result }, defaultSelection("en"), owner("owner-id"));
    expect(JSON.stringify(doc)).toContain("123.46");
    expect(JSON.stringify(doc)).toContain(result.priceAsOf);
    expect(doc.sections.find(s => s.id === "proposal")?.table?.rows).toHaveLength(result.plans.length);
    expect(result).toEqual(before);
});
it("Extend uses pinned display and incremental costs, preserves unknowns and source scan partialness", () => {
    const f = processedFixture();
    const display = buildExtensionDisplay(f.result, { catalog: f.context.catalog, support: f.context.support }, f.context.inventory);
    const before = structuredClone(display);
    const doc = extendDocument(display, defaultSelection("ko"), owner(display.result.workspaceId));
    expect(doc.kind).toBe("extend");
    expect(JSON.stringify(doc)).toContain(f.result.sourceScan.collectedAt);
    expect(JSON.stringify(doc)).toContain("CAD");
    expect(doc.sections.find(s => s.id === "proposal")?.table?.rows).toHaveLength(3);
    expect(display).toEqual(before);
});
it("source section selection independently includes pinned references and excludes them when deselected", () => {
    const f = reportFixture(), legacy = buildAssessmentReport(f.record, f.catalogData, "en");
    const only = assessDocument(f.record, f.catalogData, legacy, { ...defaultSelection("en"), sections: ["sources"] }, owner(f.record.workspaceId));
    expect(only.appendix.flatMap(s => s.blocks).some(b => b.kind === "source")).toBe(true);
    const without = assessDocument(f.record, f.catalogData, legacy, { ...defaultSelection("en"), sections: ["findings"] }, owner(f.record.workspaceId));
    expect(without.appendix.flatMap(s => s.blocks).some(b => b.kind === "source")).toBe(false);
});
it("raw Build costs and quantities remain available in appendix with resolved assumptions", () => {
    const result = structuredClone(sample) as AnalysisResult;
    result.plans[0].cost.total = 123.456;
    const doc = buildDocument({ id: "id", workspaceId: "owner", createdAt: "2026-11-13T12:00:00Z", result }, defaultSelection("en"), owner("owner"));
    expect(JSON.stringify(doc.appendix)).toContain("123.456");
    expect(JSON.stringify(doc.appendix)).not.toContain("{quantity}");
});
it("coverage gaps are distinct from a report-only filter", () => {
    const r = structuredClone(sample) as AnalysisResult;
    const doc = buildDocument({ id: "id", workspaceId: "owner", createdAt: "2026-11-13T12:00:00Z", result: r }, { ...defaultSelection("en"), tier: "low" }, owner("owner"));
    expect(doc.partial).toBe(false);
    expect(doc.included).toBe(1);
});
it("executive roadmap describes its actual saved state before explanatory notices", () => {
    const f = reportFixture();
    const doc = assessDocument(f.record, f.catalogData, buildAssessmentReport(f.record, f.catalogData, "en"), defaultSelection("en"), owner(f.record.workspaceId));
    expect(doc.sections.find(s => s.id === "roadmap")?.paragraphs[0]).toBe("Not requested");
});
it.each(["/properties/settings/API_TOKEN/value", "/properties/settings/Pwd=PATHSECRET/value"])("Extend redacts original observation context and path before serialization: %s", propertyPath => {
    const f = processedFixture();
    const display = buildExtensionDisplay(f.result, { catalog: f.context.catalog, support: f.context.support }, f.context.inventory);
    const check = display.result.plans[0].checks[0];
    check.evidence = [{ resourceId: display.result.plans[0].reusedResources[0].resourceId, propertyPath, observation: { state: "present", value: "VALUESECRET" } }];
    const serialized = JSON.stringify(extendDocument(display, defaultSelection("en"), owner(display.result.workspaceId)));
    expect(serialized).not.toContain("VALUESECRET");
    expect(serialized).not.toContain("PATHSECRET");
});
it("Extend shows unpriced new quantities and usage increases even when saved cost is unavailable", () => {
    const f = processedFixture();
    const display = buildExtensionDisplay(f.result, { catalog: f.context.catalog, support: f.context.support }, f.context.inventory);
    const p = display.result.plans[0];
    p.incrementalCost = { state: "unavailable", reason: "price-unavailable" };
    const doc = extendDocument(display, { ...defaultSelection("en"), tier: "low" }, owner(display.result.workspaceId));
    expect(doc.details?.[0].table?.rows).toHaveLength(p.reusedResources.length + p.newItems.length + p.usageIncreases.length);
    expect(doc.partial).toBe(true);
});
it("binds every report kind to the saved owner and rejects labels from another workspace", () => {
    const f = reportFixture(), other = "00000000-0000-4000-8000-0000000000bb";
    const legacy = buildAssessmentReport(f.record, f.catalogData, "en");
    expect(assessDocument(f.record, f.catalogData, legacy, defaultSelection("en"), owner(f.record.workspaceId)).owner).toEqual(owner(f.record.workspaceId));
    expect(() => assessDocument(f.record, f.catalogData, legacy, defaultSelection("en"), owner(other))).toThrow("report-unavailable");
    const result = structuredClone(sample) as AnalysisResult;
    expect(() => buildDocument({ id: "id", workspaceId: "owner", createdAt: "2026-11-13T12:00:00Z", result }, defaultSelection("en"), owner(other))).toThrow("report-unavailable");
    const e = processedFixture();
    const display = buildExtensionDisplay(e.result, { catalog: e.context.catalog, support: e.context.support }, e.context.inventory);
    expect(() => extendDocument(display, defaultSelection("en"), owner(other))).toThrow("report-unavailable");
});
it.each(["en", "ko"] as const)("Build and Extend %s provenance keeps the owner ID and adds stored workspace/company labels", locale => {
    const result = structuredClone(sample) as AnalysisResult;
    const build = buildDocument({ id: "id", workspaceId: "owner", createdAt: "2026-11-13T12:00:00Z", result }, defaultSelection(locale), owner("owner", null));
    const e = processedFixture();
    const display = buildExtensionDisplay(e.result, { catalog: e.context.catalog, support: e.context.support }, e.context.inventory);
    const extend = extendDocument(display, defaultSelection(locale), owner(display.result.workspaceId));
    for (const [doc, id, company] of [[build, "owner", locale === "en" ? "Not set" : "설정 안 됨"], [extend, display.result.workspaceId, "Synthetic examples only · 합성 예제 전용"]] as const) {
        const identity = doc.appendix.find(s => s.id === "identity")!;
        expect(identity.blocks).toContainEqual({ kind: "code", text: id });
        expect(identity.blocks).toContainEqual({ kind: "code", text: "Synthetic offline demo" });
        expect(JSON.stringify(identity.blocks)).toContain(company);
    }
    // Summary-only scope keeps the cover owner labels while provenance follows the selected sections.
    expect(buildDocument({ id: "id", workspaceId: "owner", createdAt: "2026-11-13T12:00:00Z", result }, { ...defaultSelection(locale), sections: ["proposal"] }, owner("owner")).owner.name).toBe("Synthetic offline demo");
});
it.each([["en"], ["ko"]] as const)("F1 %s executive cost totals use the saved-row precision normalizer and fixed-decimal tiny amounts", locale => {
    const f = reportFixture(), evidence = buildAssessmentReport(f.record, f.catalogData, locale);
    const window = (amounts: number[]) => ({ state: "available" as const, data: { schemaVersion: 1, retrievedAt: "2026-11-11T00:00:00Z", period: { from: "2026-11-01T00:00:00Z", to: "2026-11-11T00:00:00Z", preset: "month-to-date" },
        scope: { kind: "subscriptions", requestedSubscriptionIds: ["s"], availableSubscriptionIds: ["s"], paginationComplete: true },
        rows: amounts.map(amount => ({ subscriptionId: "s", currency: "CAD", amount, attribution: { kind: "unattributed", resourceId: null, reason: "missing-resource-id" } })),
        totals: [{ currency: "CAD", amount: amounts.reduce((a, b) => a + b, 0), subscriptionIds: ["s"] }] } });
    f.record.result!.actualCost = { schemaVersion: 1, monthToDate: window([0.1, 0.2, -0.3]), trailing30Days: window([-1e-12]) } as never;
    expect(0.1 + 0.2 - 0.3).not.toBe(0);
    const rows = assessDocument(f.record, f.catalogData, evidence, defaultSelection(locale), owner(f.record.workspaceId)).sections.find(s => s.id === "cost")!.table!.rows;
    expect(rows[0][2]).toBe("CAD 0.00");
    expect(rows[1][2]).toBe("CAD -0.000000000001");
    expect(JSON.stringify(rows)).not.toMatch(/\de-\d/);
});
it("F4 Extend details show unit labels, Extend reason wording and the saved incremental-cost currency", () => {
    const f = processedFixture();
    const display = buildExtensionDisplay(f.result, { catalog: f.context.catalog, support: f.context.support }, f.context.inventory);
    const plan = display.result.plans.find(p => "data" in p.incrementalCost && p.incrementalCost.data.lines.length && p.checks.some(c => c.reasonCodes.length))!;
    expect(plan).toBeDefined();
    if (!("data" in plan.incrementalCost)) throw Error("fixture");
    (plan.incrementalCost.data as { currency: string }).currency = "USD";
    const doc = extendDocument(display, { ...defaultSelection("en"), tier: plan.tier }, owner(display.result.workspaceId));
    const changes = doc.details![0].table!.rows.filter(r => r[1] === "New" || r[1] === "Usage increase");
    const items = [...plan.newItems, ...plan.usageIncreases];
    expect(changes.map(r => r[2])).toEqual(items.map(i => `${i.quantity} ${display.components[i.componentId].unitLabel.en}`));
    expect(changes.some(r => r[3].startsWith("USD "))).toBe(true);
    expect(JSON.stringify(changes)).not.toContain("CAD ");
    const t = createTranslator("en"), check = plan.checks.find(c => c.reasonCodes.length)!;
    const checkRows = doc.details![1].table!.rows;
    expect(checkRows[plan.checks.indexOf(check)][2]).toBe(check.reasonCodes.map(code => t(`extension.reasons.${code}`)).join(" · "));
});

it("names the affected resource and includes saved configuration links in the full report", () => {
    const f = reportFixture(), finding = f.record.result!.local.findings[0];
    const doc = assessDocument(f.record, f.catalogData, buildAssessmentReport(f.record, f.catalogData, "en"), defaultSelection("en"), owner(f.record.workspaceId), {
        nodes: [
            { id: finding.resourceId.toLowerCase(), name: "files", type: "storage", group: "demo" },
            { id: "endpoint", name: "private endpoint", type: "network", group: "demo" },
        ],
        edges: [{ sourceId: "endpoint", targetId: finding.resourceId.toLowerCase(), type: "connects_to" }],
    });
    expect(doc.sections.find(s => s.id === "findings")?.table?.rows.some(row => row.includes("files"))).toBe(true);
    expect(doc.details?.[0].table?.rows).toEqual([["private endpoint", "connects to", "files"]]);
    expect(JSON.stringify(doc.details)).not.toContain(finding.resourceId);
});
