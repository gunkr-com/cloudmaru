import { describe, expect, it } from "vitest";
import { countValues, csvDocument, exploreRows, readExplorerState, writeExplorerState, signedCostGroups } from "./explorer";
const rows = [
  { id: "a", values: { name: "Alpha", verdict: "unknown", amount: 2, region: null } },
  { id: "b", values: { name: "Beta", verdict: "pass", amount: 10, region: "east" } },
  { id: "c", values: { name: "Gamma", verdict: "unknown", amount: -3, region: "east" } },
];
describe("saved result exploration", () => {
  it("combines search and exact facets, sorts numerically and never mutates saved rows", () => {
    expect(exploreRows(rows, { q: "a", filters: { verdict: "unknown" }, sort: "amount", direction: "desc", page: 1 }, 50).rows.map(r => r.id)).toEqual(["a", "c"]);
    expect(rows.map(r => r.id)).toEqual(["a", "b", "c"]);
    expect(exploreRows(rows, { q: "", filters: {}, sort: "amount", direction: "asc", page: 99 }, 2)).toMatchObject({ matched: 3, page: 2, pageCount: 2, rows: [rows[1]] });
    expect(exploreRows(rows, { q: "missing", filters: {}, sort: "name", direction: "asc", page: 1 })).toMatchObject({ matched: 0, page: 1, pageCount: 1 });
  });
  it("counts unknown as its own bucket and distinguishes an empty value from literal unknown", () => {
    expect(countValues(rows, "verdict")).toEqual([{ value: "unknown", count: 2 }, { value: "pass", count: 1 }]);
    expect(countValues(rows, "region")).toEqual([{ value: "east", count: 2 }, { value: "", count: 1 }]);
  });
  it("validates URL state and only replaces this explorer's owned keys", () => {
    const params = new URLSearchParams("tier=ha&findings_verdict=unknown&findings_sort=bogus&findings_page=-9&other_q=x");
    const state = readExplorerState(params, "findings", ["name", "amount"], { verdict: ["pass", "unknown"] });
    expect(state).toEqual({ q: "", filters: { verdict: "unknown" }, sort: "name", direction: "asc", page: 1 });
    const next = writeExplorerState(params, "findings", { ...state, q: "a & b", filters: {}, sort: "amount", direction: "desc", page: 2 });
    expect(next.get("tier")).toBe("ha"); expect(next.get("other_q")).toBe("x"); expect(next.has("findings_verdict")).toBe(false);
    expect(readExplorerState(next, "findings", ["name", "amount"], { verdict: ["pass", "unknown"] }).q).toBe("a & b");
  });
  it("quotes CSV delimiters/newlines and neutralizes formula and control-prefix injection", () => {
    const csv = csvDocument(["name", "value"], [["=HYPERLINK(\"x\")", "a,b\nline"], ["\t +SUM(1)", "-3"], ["@command", -3], ["ordinary", null]]);
    expect(csv).toContain('"\'=HYPERLINK(""x"")"'); expect(csv).toContain('"a,b\nline"');
    expect(csv).toContain('"\'\t +SUM(1)"'); expect(csv).toContain('"\'-3"'); expect(csv).toContain('"@command"'.replace('@', "'@"));
    expect(csv).toContain(',"-3"'); expect(csv.startsWith("\uFEFF")).toBe(true);
  });
  it("keeps currency and sign separate and preserves zero/tiny signed source amounts", () => {
    const source = [{ currency: "CAD", amount: 2 }, { currency: "CAD", amount: -2 }, { currency: "USD", amount: 10 }, { currency: "CAD", amount: -1e-12 }, { currency: "CAD", amount: 0 }];
    const groups = signedCostGroups(source);
    expect(groups.map(g => [g.currency, g.sign, g.rows.length])).toEqual([["CAD", "positive", 1], ["CAD", "negative", 2], ["CAD", "zero", 1], ["USD", "positive", 1]]);
    expect(groups[1].rows[1].amount).toBe(-1e-12);
  });
});
