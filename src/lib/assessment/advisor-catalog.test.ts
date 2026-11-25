import { describe, expect, it } from "vitest";
import { advisorCatalog, parseAdvisorCatalog } from "./advisor-catalog";

describe("Advisor catalog", () => {
  it("검증된 일곱 유형과 독립 rule/action 이름을 제공한다", () => {
    expect(advisorCatalog.entries).toHaveLength(7);
    for (const entry of advisorCatalog.entries) {
      expect(entry.ruleId).toMatch(/^advisor-/);
      expect(entry.actionId).toMatch(/^advisor-action-/);
      expect(entry.title.en).toMatch(/Review/);
      expect(entry.title.ko).not.toBe("");
      expect(entry.sources).toEqual(["https://learn.microsoft.com/en-us/azure/advisor/advisor-reference-cost-recommendations"]);
    }
  });
  it("중복/임의 필드/잘못된 GUID와 출처를 거부한다", () => {
    const first = advisorCatalog.entries[0];
    for (const entries of [[first, first], [{ ...first, recommendationTypeId: "invented" }],
      [{ ...first, sources: ["https://evil.test"] }], [{ ...first, arbitrary: true }]]) {
      expect(() => parseAdvisorCatalog({ ...advisorCatalog, entries })).toThrow();
    }
  });
});
