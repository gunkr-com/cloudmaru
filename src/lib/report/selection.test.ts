import { expect, it } from "vitest";
import { parseSelection, selectionQuery, defaultSelection } from "./selection";
it("defaults to complete report and preserves locale and filter intent in shareable URLs", () => {
    expect(parseSelection({}, "ko")).toEqual(defaultSelection("ko"));
    const query = { lang: "ko", scope: "summary", sections: "findings,cost", severity: "high", pillar: "security", tier: "balanced", paper: "letter" };
    const selected = parseSelection(query, "en");
    expect(parseSelection(Object.fromEntries(selectionQuery(selected)), "en")).toEqual(selected);
});
it.each([{ lang: ["en", "ko"] }, { scope: "all" }, { sections: "cost,cost" }, { sections: "invented" }, { severity: "urgent" }, { pillar: "other" }, { tier: "none" }, { secret: "x" }, { sections: "" }, { paper: "A4" }, { paper: "legal" }, { paper: ["a4", "letter"] }])("rejects ambiguous/unknown scope %j", query => {
    expect(() => parseSelection(query, "en")).toThrow("invalid-report-selection");
});
it("rejects report-inapplicable filters instead of silently ignoring them", () => {
    expect(() => parseSelection({ severity: "high" }, "en", "build")).toThrow("invalid-report-selection");
    expect(() => parseSelection({ pillar: "security" }, "en", "extend")).toThrow("invalid-report-selection");
    expect(() => parseSelection({ tier: "low" }, "en", "assess")).toThrow("invalid-report-selection");
});
it("normalizes legacy paper links and leaves paper out of generated URLs", () => {
    for (const kind of ["assess", "build", "extend"] as const) {
        const selection = defaultSelection("en", kind);
        expect(parseSelection({ paper: "a4" }, "en", kind)).toEqual(selection);
        expect(parseSelection({ paper: "letter" }, "en", kind)).toEqual(selection);
        expect(selectionQuery(selection).has("paper")).toBe(false);
    }
});
it("F2 uses report-kind section defaults and rejects sections that do not apply before any read", () => {
    expect(defaultSelection("en", "assess").sections).toEqual(["findings", "roadmap", "advisor", "cost", "changes", "sources", "evidence"]);
    for (const kind of ["build", "extend"] as const) {
        expect(defaultSelection("en", kind).sections).toEqual(["proposal", "sources", "evidence"]);
        expect(parseSelection({}, "en", kind).sections).toEqual(["proposal", "sources", "evidence"]);
        expect(() => parseSelection({ sections: "findings,cost" }, "en", kind)).toThrow("invalid-report-selection");
        expect(parseSelection({ sections: "sources" }, "en", kind).sections).toEqual(["sources"]);
    }
    expect(parseSelection({}, "en", "assess").sections).not.toContain("proposal");
    expect(() => parseSelection({ sections: "proposal" }, "en", "assess")).toThrow("invalid-report-selection");
    expect(() => parseSelection({ sections: "findings,proposal" }, "en", "assess")).toThrow("invalid-report-selection");
    const build = parseSelection({ tier: "low" }, "en", "build");
    expect(parseSelection(Object.fromEntries(selectionQuery(build)), "en", "build")).toEqual(build);
});
