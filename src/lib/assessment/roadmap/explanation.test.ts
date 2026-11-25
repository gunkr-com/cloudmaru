import { expect, it } from "vitest";
import { roadmapFixture } from "./fixtures.test-data";
import { buildRoadmapContext } from "./context";
import { composeExplanation, validateExplanation, type Explanation } from "./explanation";

function fixture() {
  const f = roadmapFixture(), context = buildRoadmapContext(f.parent, f.catalogData);
  const ids = context.payload.actions.map(a => a.alias);
  return { payload: structuredClone(context.payload), ids, phases: ids.map(id => [id]) };
}
it.each(["before", "after"] as const)("decodes bilingual %s paraphrases to the same proposed order, grounded in saved findings", surface => {
  const f = fixture();
  const ast: Explanation = { relation: "sequence", actions: f.ids, focus: "mixed" };
  const text = composeExplanation(ast, f.payload, surface);
  expect(validateExplanation(text, f.payload, f.phases, "summary")).toEqual(ast);
  expect(text.en).toContain(f.payload.actions[0].meaning.title.en);
  expect(text.ko).toContain(f.payload.actions[1].meaning.title.ko);
  expect(text.en).toContain("unknown");
});
it("accepts English before with equivalent Korean after, without requiring the same surface wording", () => {
  const f = fixture(), ast: Explanation = { relation: "sequence", actions: f.ids, focus: "mixed" };
  const before = composeExplanation(ast, f.payload, "before"), after = composeExplanation(ast, f.payload, "after");
  expect(validateExplanation({ en: before.en, ko: after.ko }, f.payload, f.phases, "summary")).toEqual(ast);
});
it("supports grouped explanations and source-specific phase titles", () => {
  const f = fixture();
  const ast: Explanation = { relation: "together", actions: f.ids, focus: "unknowns" };
  expect(validateExplanation(composeExplanation(ast, f.payload), f.payload, [f.ids], "summary")).toEqual(ast);
  const title: Explanation = { relation: "review", actions: [f.ids[1]], focus: "review" };
  expect(validateExplanation(composeExplanation(title, f.payload, "before", true), f.payload, [[f.ids[1]]], "title")).toEqual(title);
});
it("rejects language reversal, agreed wrong phase order, foreign title anchors and false grouping", () => {
  const f = fixture(), ast: Explanation = { relation: "sequence", actions: f.ids, focus: "mixed" };
  const text = composeExplanation(ast, f.payload);
  const reversed = composeExplanation({ ...ast, actions: [...f.ids].reverse() }, f.payload);
  expect(() => validateExplanation({ en: text.en, ko: reversed.ko }, f.payload, f.phases, "summary")).toThrow();
  expect(() => validateExplanation(reversed, f.payload, f.phases, "summary")).toThrow();
  const together = composeExplanation({ ...ast, relation: "together" }, f.payload);
  expect(() => validateExplanation(together, f.payload, f.phases, "summary")).toThrow();
  const title = composeExplanation({ relation: "review", actions: [f.ids[0]], focus: "review" }, f.payload, "before", true);
  expect(() => validateExplanation(title, f.payload, [[f.ids[1]]], "title")).toThrow();
});
it.each([
  { en: "disable HTTPS-only traffic.", ko: "HTTPS 전용 트래픽을 설정합니다." },
  { en: "Disable HTTPS-only traffic.", ko: "HTTPS 전용 트래픽을 설정합니다." },
  { en: "HTTPS is configured. TLS is enabled.", ko: "HTTPS 설정과 TLS 확인이 필요합니다." },
  { en: "Review HTTPS before TLS.", ko: "TLS 이후 HTTPS를 검토합니다." },
  { en: "Review HTTPS enforcement before TLS compatibility.", ko: "TLS 호환성을 확인한 뒤 HTTPS 적용을 검토합니다." },
  { en: "Review HTTPS traffic protection.", ko: "가상데스크톱으로 전환 후 HTTPS 검토" },
])("rejects arbitrary action polarity, state assertions and unaligned free prose: $en", text => {
  const f = fixture(); expect(() => validateExplanation(text, f.payload, f.phases, "summary")).toThrow();
});
it("does not manufacture violations in an all-unknown group or silently change the input", () => {
  const f = fixture(); f.payload.findings.forEach(item => { item.verdict = "unknown"; });
  const text = composeExplanation({ relation: "review", actions: [f.ids[0]], focus: "violations" }, f.payload);
  const before = structuredClone(f.payload);
  expect(() => validateExplanation(text, f.payload, f.phases, "summary")).toThrow();
  expect(f.payload).toEqual(before);
});
