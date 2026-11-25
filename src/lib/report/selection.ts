import type { Locale } from "@/types/i18n";
export const sectionIds = ["findings", "roadmap", "advisor", "cost", "changes", "proposal", "sources", "evidence"] as const;
export type SectionId = typeof sectionIds[number];
export type ReportSelection = {
    locale: Locale;
    scope: "summary" | "full";
    sections: SectionId[];
    severity: string;
    pillar: string;
    tier: "all" | "low" | "balanced" | "ha";
};
export type ReportKind = "assess" | "build" | "extend";
/** Sections a report kind can show; defaults and URL validation both use this set. */
export function sectionsFor(kind: ReportKind): SectionId[] {
    return kind === "assess" ? ["findings", "roadmap", "advisor", "cost", "changes", "sources", "evidence"] : ["proposal", "sources", "evidence"];
}
export function defaultSelection(locale: Locale, kind?: ReportKind): ReportSelection { return { locale, scope: "full", sections: kind ? sectionsFor(kind) : [...sectionIds], severity: "all", pillar: "all", tier: "all" }; }
export function parseSelection(query: Record<string, string | string[] | undefined>, fallback: Locale, kind?: ReportKind): ReportSelection {
    const fail = (): never => { throw Error("invalid-report-selection"); };
    if (Object.entries(query).some(([k, v]) => !['lang', 'scope', 'sections', 'severity', 'pillar', 'tier', 'paper'].includes(k) || Array.isArray(v)))
        fail();
    const get = (key: string) => typeof query[key] === "string" ? query[key] as string : undefined;
    const value = defaultSelection(fallback, kind), lang = get("lang"), scope = get("scope"), sections = get("sections"), severity = get("severity"), pillar = get("pillar"), tier = get("tier"), paper = get("paper");
    if (lang !== undefined) {
        if (lang !== "en" && lang !== "ko")
            return fail();
        value.locale = lang;
    }
    if (scope !== undefined) {
        if (scope !== "summary" && scope !== "full")
            return fail();
        value.scope = scope;
    }
    if (sections !== undefined) {
        const ids = sections.split(",");
        const allowed: readonly string[] = kind ? sectionsFor(kind) : sectionIds;
        if (!ids.length || new Set(ids).size !== ids.length || ids.some(id => !allowed.includes(id)))
            fail();
        value.sections = ids as SectionId[];
    }
    if (severity !== undefined) {
        if (!["all", "critical", "high", "medium", "low", "informational"].includes(severity))
            fail();
        value.severity = severity;
    }
    if (pillar !== undefined) {
        if (!["all", "reliability", "security", "cost", "operations", "performance"].includes(pillar))
            fail();
        value.pillar = pillar;
    }
    if (tier !== undefined) {
        if (tier !== "all" && tier !== "low" && tier !== "balanced" && tier !== "ha")
            return fail();
        value.tier = tier;
    }
    // Accept legacy report URLs while always printing on Letter.
    if (paper !== undefined && paper !== "a4" && paper !== "letter")
        return fail();
    if (kind === "assess" && value.tier !== "all" || kind !== undefined && kind !== "assess" && (value.severity !== "all" || value.pillar !== "all"))
        return fail();
    return value;
}
export function selectionQuery(value: ReportSelection): URLSearchParams {
    return new URLSearchParams({ lang: value.locale, scope: value.scope, sections: value.sections.join(","), severity: value.severity, pillar: value.pillar, tier: value.tier });
}
export const sectionKeys = { findings: "reports.findings", roadmap: "reports.roadmap", advisor: "reports.advisor", cost: "reports.cost", changes: "reports.changes", proposal: "reports.proposal", sources: "reports.sources", evidence: "reports.evidence" } as const;
