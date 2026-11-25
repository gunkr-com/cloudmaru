import { createTranslator } from "@/i18n/translate";
import { formatNumber } from "@/i18n/format";
import { normalizeCostTotalForDisplay } from "@/lib/assessment/app/cost-display";
import type { Locale } from "@/types/i18n";
import { canonicalId } from "@/lib/inventory/normalize";
import type { Topology } from "@/lib/assessment/topology";
import { redactInventoryDisplay } from "@/lib/inventory/diff";
import type { AssessmentCatalogData, AssessmentRecord } from "@/types/assessment";
import type { AnalysisResult } from "@/types/analysis";
import type { ExtensionDisplay } from "@/lib/extend-app/result";
import type { AssessmentReport, ReportSection as EvidenceSection } from "@/lib/assessment/report/document";
import type { ConsultingReport, ReportOwner, ReportSection } from "@/types/report";
import { ownerBlocks } from "./owner";
import type { ReportSelection, SectionId } from "./selection";
import { sectionKeys } from "./selection";
// Tiny nonzero adjustments keep their saved value in locale fixed-decimal form, never scientific notation.
const formatMoney = (amount: number, currency: string, locale: Locale) => `${currency} ${formatNumber(amount, locale, amount !== 0 && Math.abs(amount) < 0.01 ? { maximumSignificantDigits: 17 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const safe = (value: string) => String(redactInventoryDisplay(value).value);
const excerpt = (value: string) => value.length > 440 ? `${value.slice(0, 440)}…` : value;
export function appendixGroup(id: string): SectionId {
    if (id.startsWith("finding-") || id === "local")
        return "findings";
    if (id.startsWith("cost"))
        return "cost";
    if (id === "diff")
        return "changes";
    if (id === "roadmap" || id === "advisor")
        return id;
    if (id.startsWith("source"))
        return "sources";
    if (id.startsWith("plan"))
        return "proposal";
    return "evidence";
}
function picked(selection: ReportSelection, section: SectionId) { return selection.sections.includes(section); }
function selectedAppendix(sections: EvidenceSection[], selection: ReportSelection) {
    const included = sections.filter(s => picked(selection, appendixGroup(s.id))).map(s => ({ ...s, blocks: s.blocks.filter(b => b.kind !== "source" || picked(selection, "sources")) }));
    if (picked(selection, "sources")) {
        const extra = sections.filter(s => !picked(selection, appendixGroup(s.id))).flatMap(s => s.blocks.filter(b => b.kind === "source"));
        if (extra.length)
            included.push({ id: "sources", title: createTranslator(selection.locale)("reports.sources"), level: 2, blocks: [...new Map(extra.map(b => [b.kind === "source" ? b.href : "", b])).values()] });
    }
    return included;
}
function identity(id: string, owner: ReportOwner, createdAt: string, selection: ReportSelection): EvidenceSection {
    const t = createTranslator(selection.locale);
    return { id: "identity", title: t("reports.identity"), level: 2, blocks: [{ kind: "text", text: t("reports.record") }, { kind: "code", text: id }, { kind: "text", text: t("reports.workspace") }, { kind: "code", text: owner.workspaceId }, ...ownerBlocks(owner, selection.locale), { kind: "time", label: t("reports.created"), value: createdAt }] };
}
/** Labels must belong to the saved record's owner; another workspace's labels are never substituted. */
function bound(owner: ReportOwner, workspaceId: string): ReportOwner {
    if (owner.workspaceId !== workspaceId)
        throw Error("report-unavailable");
    return owner;
}
/** Display-only projection. Caller supplies the proof-verified record and pinned document. */
export function assessDocument(record: AssessmentRecord, catalog: AssessmentCatalogData, evidence: AssessmentReport, selection: ReportSelection, owner: ReportOwner, topology?: Topology): ConsultingReport {
    const r = record.result;
    bound(owner, record.workspaceId);
    if (!r || record.status !== "succeeded" || evidence.id !== record.id || evidence.locale !== selection.locale)
        throw Error("report-unavailable");
    const t = createTranslator(selection.locale), locale = selection.locale;
    const resourceNames = new Map(topology?.nodes.map(node => [node.id, node.name]));
    const findings = r.local.findings.filter(f => (selection.severity === "all" || f.severity === selection.severity) && (selection.pillar === "all" || f.pillar === selection.pillar));
    const rank = { violation: 0, unknown: 1, pass: 2 }, severity = { critical: 0, high: 1, medium: 2, low: 3, informational: 4 };
    findings.sort((a, b) => rank[a.verdict] - rank[b.verdict] || severity[a.severity] - severity[b.severity] || a.id.localeCompare(b.id));
    const count = (verdict: string) => r.local.findings.filter(f => f.verdict === verdict).length;
    const sections: ReportSection[] = [{ id: "findings", title: t("reports.priority"), paragraphs: [t("reports.topItems")], table: { headers: [t("reports.finding"), t("reports.affectedResource"), t("reports.verdict"), t("reports.severity")], rows: findings.map(f => {
                    const rule = catalog.rules.rules.find(r => r.id === f.ruleId);
                    if (!rule)
                        throw Error("report-unavailable");
                    return [safe(rule.title[locale]), resourceNames.get(canonicalId(f.resourceId)) ?? t("reports.resourceUnavailable"), t(`assessment.verdict.${f.verdict}`), t(`assessment.severity.${f.severity}`)];
                }) } }];
    const roadmapParagraphs = [t(`assessmentRoadmap.status.${record.roadmap.status}`)];
    if (record.roadmap.content)
        roadmapParagraphs.push(excerpt(safe(record.roadmap.content.summary[locale])));
    sections.push({ id: "roadmap", title: t("reports.roadmap"), paragraphs: roadmapParagraphs });
    sections.push({ id: "advisor", title: t("reports.advisor"), paragraphs: [t(`assessment.componentStatus.${r.advisor.state}`), "data" in r.advisor ? t("assessment.ui.coverage", { total: r.advisor.data.coverage.total, included: r.advisor.data.coverage.included, excluded: r.advisor.data.coverage.excluded }) : "reason" in r.advisor ? t(`assessment.reasons.${r.advisor.reason}`) : t("assessment.ui.advisorNotice")] });
    sections.push({ id: "changes", title: t("reports.changes"), paragraphs: [t(`assessment.componentStatus.${r.diff.state}`), "data" in r.diff ? t("assessmentRoadmap.report.counts", r.diff.data.counts) : "reason" in r.diff ? t(`assessment.reasons.${r.diff.reason}`) : t("assessment.ui.diffNotice")] });
    const costTable = { headers: [t("reports.cost"), t("reports.state"), t("reports.amount")], rows: (["monthToDate", "trailing30Days"] as const).map(key => {
            const c = r.actualCost[key];
            return [t(`assessment.cost.${key}`) + ("data" in c ? ` · ${c.data.period.from.slice(0, 10)} / ${c.data.period.to.slice(0, 10)}` : ""), t(`assessment.componentStatus.${c.state}`), "data" in c ? c.data.totals.map(v => formatMoney(normalizeCostTotalForDisplay(v.amount, c.data.rows.filter(row => row.currency === v.currency)), v.currency, locale)).join(" / ") || t("reports.noData") : t("reports.noData")];
        }) };
    sections.push({ id: "cost", title: t("reports.cost"), paragraphs: [t("assessment.ui.provisional"), t("assessment.ui.noSavings")], table: costTable });
    const components = [r.advisor, r.diff, r.actualCost.monthToDate, r.actualCost.trailing30Days];
    const limits = [t("assessment.ui.coverage", { total: r.local.coverage.total, included: r.local.coverage.included, excluded: r.local.coverage.excluded }), t("reports.unknownNotice"), t(`assessment.ui.${r.sourceScan.completeness.state}`), ...r.sourceScan.completeness.reasons.map(reason => t(`assessment.reasons.${reason}`)), ...r.local.coverage.reasons.map(reason => `${t(`assessment.reasons.${reason.code}`)} · ${reason.count}`)];
    for (const [index, key] of (["advisor", "changes", "cost", "cost"] as const).entries()) {
        const c = components[index];
        limits.push(`${t(sectionKeys[key])}: ${t(`assessment.componentStatus.${c.state}`)}`);
        if ("reason" in c)
            limits.push(t(`assessment.reasons.${c.reason}`));
        if ("reasons" in c)
            limits.push(...c.reasons.map(reason => t(`assessment.reasons.${reason}`)));
    }
    const details: ReportSection[] = [];
    if (topology && picked(selection, "evidence")) {
        const rows = topology.edges.map(edge => [
            resourceNames.get(edge.sourceId) ?? t("reports.resourceUnavailable"),
            t(`assessment.topology.relations.${edge.type}`),
            resourceNames.get(edge.targetId) ?? t("reports.resourceUnavailable"),
        ]);
        details.push({
            id: "evidence", title: t("assessment.topology.title"),
            paragraphs: [
                t("assessment.topology.totals", { resources: formatNumber(topology.nodes.length, locale), connections: formatNumber(rows.length, locale) }),
                t("assessment.topology.scope"),
            ],
            table: rows.length ? { headers: [t("reports.connectionFrom"), t("reports.connection"), t("reports.connectionTo")], rows } : undefined,
        });
    }
    const allowed = new Set(findings.map(f => `finding-${f.id}`));
    return { kind: "assess", id: record.id, workspaceId: record.workspaceId, owner, title: t("reports.assess"), subject: t("reports.saved"), createdAt: record.createdAt, selection, total: r.local.findings.length, included: findings.length,
        partial: r.sourceScan.completeness.state !== "complete" || r.local.coverage.excluded > 0 || components.some(c => c.state !== "available"), limits,
        metrics: [{ label: t("reports.findings"), value: String(r.local.findings.length) }, { label: t("reports.violations"), value: String(count("violation")) }, { label: t("reports.unknown"), value: String(count("unknown")) }],
        chart: { title: t("reports.verdicts"), total: r.local.findings.length, rows: [{ label: t("reports.violations"), value: count("violation"), tone: "danger" }, { label: t("reports.unknown"), value: count("unknown"), tone: "caution" }, { label: t("reports.passed"), value: count("pass"), tone: "success" }] },
        sections: sections.filter(s => picked(selection, s.id)), details, appendix: selectedAppendix(evidence.sections.filter(s => !s.id.startsWith("finding-") || allowed.has(s.id)), selection) };
}
export function buildDocument(record: {
    id: string;
    workspaceId: string;
    createdAt: string;
    result: AnalysisResult;
}, selection: ReportSelection, owner: ReportOwner): ConsultingReport {
    bound(owner, record.workspaceId);
    const r = record.result, t = createTranslator(selection.locale), locale = selection.locale;
    const plans = r.plans.filter(p => selection.tier === "all" || p.tier === selection.tier);
    const rows = plans.map(p => [t(`common.tiers.${p.tier}`) + (p.tier === r.recommendedTier ? ` · ${t("reports.recommended")}` : ""), safe(p.title[locale]), formatMoney(p.cost.total, p.cost.currency, locale)]);
    const details: ReportSection[] = plans.map(p => ({ id: "proposal", title: t(`common.tiers.${p.tier}`), paragraphs: p.pros.map(v => safe(v[locale])), table: { headers: [t("reports.component"), t("reports.quantity"), t("reports.amount")], rows: p.cost.lines.map(l => [safe(l.name[locale]), `${l.quantity} ${safe(l.unitLabel[locale])}`, formatMoney(l.amount, r.currency, locale)]) } }));
    const appendix: EvidenceSection[] = [identity(record.id, owner, record.createdAt, selection), { id: "input", title: t("reports.request"), level: 2, blocks: [{ kind: "text", text: safe(r.input.description) }] }];
    for (const p of plans) {
        appendix.push({ id: `plan-${p.tier}`, title: t(`common.tiers.${p.tier}`), level: 2, blocks: [{ kind: "text", text: safe(p.title[locale]) }, { kind: "code", text: p.services.map(s => `${s.componentId}: ${s.quantity}`).join("\n") }, { kind: "code", text: safe(JSON.stringify(p.connections ?? [], null, 2)) }, { kind: "code", text: safe(p.mermaid[locale]) }, { kind: "text", text: t("reports.snapshot") }, { kind: "code", text: r.priceAsOf }, { kind: "code", text: JSON.stringify({ currency: p.cost.currency, total: p.cost.total, budgetRatio: p.cost.budgetRatio, lines: p.cost.lines.map(({ componentId, quantity, amount, hourly, isAssumption }) => ({ componentId, quantity, amount, hourly, isAssumption })) }, null, 2) }, ...p.cost.lines.filter(l => l.assumptionLabel).map(l => ({ kind: "text" as const, text: safe(l.assumptionLabel![locale]).replaceAll("{quantity}", String(l.quantity)) }))] });
        appendix.push({ id: `sources-${p.tier}`, title: safe(p.referenceArchitecture.name[locale]), level: 2, blocks: p.referenceArchitecture.sources.map(s => ({ kind: "source", label: s.title, href: s.url })) });
    }
    return { kind: "build", id: record.id, workspaceId: record.workspaceId, owner, title: t("reports.build"), subject: safe(r.requestTitle[locale]), createdAt: record.createdAt, selection, total: r.plans.length, included: plans.length, partial: r.outOfScope,
        metrics: [{ label: t("reports.region"), value: r.region }, { label: t("reports.snapshot"), value: r.priceAsOf }, { label: t("reports.budget"), value: formatMoney(r.input.monthlyBudget, r.currency, locale) }], limits: [t("reports.estimateNotice"), ...(r.outOfScope ? [t("analysis.result.outOfScope")] : [])],
        sections: [{ id: "proposal", title: t("reports.proposal"), paragraphs: [excerpt(safe(r.recommendationReason[locale]))], table: { headers: [t("reports.option"), t("reports.recommendation"), t("reports.monthly")], rows } }].filter(s => picked(selection, s.id as SectionId)) as ReportSection[],
        details: picked(selection, "proposal") ? details : [], appendix: selectedAppendix(appendix, selection) };
}
export function extendDocument(display: ExtensionDisplay, selection: ReportSelection, owner: ReportOwner): ConsultingReport {
    bound(owner, display.result.workspaceId);
    const r = display.result, t = createTranslator(selection.locale), locale = selection.locale;
    const plans = r.plans.filter(p => selection.tier === "all" || p.tier === selection.tier);
    const appendix: EvidenceSection[] = [identity(r.id, owner, r.createdAt, selection), { id: "scan", title: t("reports.evidence"), level: 2, blocks: [{ kind: "text", text: t("reports.sourceScan") }, { kind: "code", text: r.sourceScanId }, { kind: "time", label: t("reports.collected"), value: r.sourceScan.collectedAt }, { kind: "text", text: safe(r.input.description) }, { kind: "code", text: JSON.stringify({ sourceScan: r.sourceScan, catalogVersion: r.catalogVersion, reusePolicyVersion: r.reusePolicyVersion, contextCoverage: r.contextCoverage }, null, 2) }] }];
    const details: ReportSection[] = [];
    for (const p of plans) {
        const cost = p.incrementalCost;
        const changeRows = [...p.newItems.map(i => ({ ...i, kind: "new" as const, resourceId: null })), ...p.usageIncreases.map(i => ({ ...i, kind: "usage-increase" as const }))].map(i => {
            const line = "data" in cost ? cost.data.lines.find(l => l.kind === i.kind && l.componentId === i.componentId && l.resourceId === i.resourceId) : undefined;
            return [safe(display.components[i.componentId].name[locale]), i.kind === "new" ? t("reports.new") : t("reports.increase"), `${i.quantity} ${safe(display.components[i.componentId].unitLabel[locale])}`, line && "data" in cost ? formatMoney(line.amount, cost.data.currency, locale) : t("assessment.componentStatus.unavailable")];
        });
        const checks = p.checks.map(c => ({ ...c, evidence: c.evidence.map(e => {
                const redacted = redactInventoryDisplay(e.observation.state === "present" ? e.observation.value : null, e.propertyPath, display.resources[e.resourceId]?.type ?? "");
                return { ...e, propertyPath: redacted.path, observation: e.observation.state === "present" ? { state: "present", value: redacted.value } : e.observation };
            }) }));
        details.push({ id: "proposal", title: t(`common.tiers.${p.tier}`), paragraphs: [...p.pros.map(v => safe(v[locale])), ...("reason" in cost ? [t(`extension.reasons.${cost.reason}`)] : "reasons" in cost ? cost.reasons.map(reason => t(`extension.reasons.${reason}`)) : []), ...[...p.newItems, ...p.usageIncreases].flatMap(i => { const a = display.components[i.componentId].assumption; return a ? [safe(a[locale]).replaceAll("{quantity}", String(i.quantity))] : []; })], table: { headers: [t("reports.component"), t("reports.kind"), t("reports.quantity"), t("reports.amount")], rows: [...p.reusedResources.map(i => [safe(display.components[i.componentId].name[locale]), t("reports.reuse"), "-", "-"]), ...changeRows] } });
        details.push({ id: "proposal", title: `${t(`common.tiers.${p.tier}`)} · ${t("reports.checks")}`, paragraphs: [], table: { headers: [t("reports.checks"), t("reports.verdict"), t("reports.assumptions")], rows: p.checks.map(c => [t(`extension.result.${c.kind}`), t(`assessment.verdict.${c.verdict}`), c.reasonCodes.map(code => t(`extension.reasons.${code}`)).join(" · ")]) } });
        appendix.push({ id: `plan-${p.tier}`, title: t(`common.tiers.${p.tier}`), level: 2, blocks: [{ kind: "text", text: safe(p.title[locale]) }, { kind: "code", text: safe(JSON.stringify({ reusedResources: p.reusedResources, newItems: p.newItems, usageIncreases: p.usageIncreases, subnetProposals: p.subnetProposals, incrementalCost: p.incrementalCost, checks }, null, 2)) }] });
        const ref = display.references[p.referenceArchitectureId];
        const urls = [...ref.sources, ...[...p.newItems, ...p.reusedResources, ...p.usageIncreases].flatMap(i => display.components[i.componentId].sources)];
        appendix.push({ id: `sources-${p.tier}`, title: safe(ref.name[locale]), level: 2, blocks: [...new Map(urls.map(s => [s.url, s])).values()].map(s => ({ kind: "source", label: s.title, href: s.url })) });
    }
    return { kind: "extend", id: r.id, workspaceId: r.workspaceId, owner, title: t("reports.extend"), subject: safe(r.requestTitle[locale]), createdAt: r.createdAt, selection, total: r.plans.length, included: plans.length,
        partial: r.contextCoverage.excluded > 0 || r.sourceScan.completeness.state !== "complete" || r.plans.some(p => p.incrementalCost.state !== "available" || p.checks.some(c => c.verdict === "unknown")),
        metrics: [{ label: t("reports.region"), value: display.region[locale] }, { label: t("reports.snapshot"), value: display.priceAsOf }, { label: t("reports.budget"), value: formatMoney(r.input.monthlyBudget, "CAD", locale) }],
        limits: [t("reports.incrementalNotice"), t("reports.estimateNotice"), t("assessment.ui.coverage", { total: r.contextCoverage.total, included: r.contextCoverage.included, excluded: r.contextCoverage.excluded }), t(`assessment.ui.${r.sourceScan.completeness.state}`), ...r.sourceScan.completeness.reasons.map(reason => t(`assessment.reasons.${reason}`))],
        sections: [{ id: "proposal", title: t("reports.proposal"), paragraphs: [excerpt(safe(r.recommendationReason[locale]))], table: { headers: [t("reports.option"), t("reports.state"), t("reports.monthly")], rows: plans.map(p => [t(`common.tiers.${p.tier}`) + (p.tier === r.recommendedTier ? ` · ${t("reports.recommended")}` : ""), t(`assessment.componentStatus.${p.incrementalCost.state}`), "data" in p.incrementalCost ? formatMoney(p.incrementalCost.data.total, p.incrementalCost.data.currency, locale) : t("reports.noData")]) } }].filter(s => picked(selection, s.id as SectionId)) as ReportSection[],
        details: picked(selection, "proposal") ? details : [], appendix: selectedAppendix(appendix, selection) };
}
