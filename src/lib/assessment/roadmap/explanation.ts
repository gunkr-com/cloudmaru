import "server-only";
import { isDeepStrictEqual } from "node:util";
import type { LocalizedText } from "@/types/i18n";
import type { RoadmapPayload } from "./context";

/** Proposed review priority, never a technical dependency or a configuration fact.
 * Only exact pinned catalog titles supply the dynamic nouns/actions.
 */
export type Explanation = {
  relation: "review" | "sequence" | "together";
  actions: string[];
  focus: "review" | "violations" | "unknowns" | "mixed";
};
const focusText: Record<Explanation["focus"], LocalizedText> = {
  review: { en: " Review the catalog actions before deciding changes.", ko: " 변경을 결정하기 전에 카탈로그 조치를 검토합니다." },
  violations: { en: " Review recorded violations before deciding changes.", ko: " 변경을 결정하기 전에 기록된 위반을 검토합니다." },
  unknowns: { en: " Verify unknown findings before deciding changes.", ko: " 변경을 결정하기 전에 알 수 없는 결과를 확인합니다." },
  mixed: { en: " Review recorded violations and verify unknown findings before deciding changes.", ko: " 변경을 결정하기 전에 기록된 위반을 검토하고 알 수 없는 결과를 확인합니다." },
};
const forms = {
  en: { review: ["Review ", ""], before: ["Proposed review order: ", " before "], after: ["Proposed review order: ", " after "], together: ["Review together: ", " and "] },
  ko: { review: ["검토: ", ""], before: ["제안 검토 순서: ", " 다음 "], after: ["제안 검토 순서: ", "에 앞서 "], together: ["함께 검토: ", " 및 "] },
} as const;
function invalid(): never { throw new Error("assessment-roadmap-explanation-invalid"); }
export function composeExplanation(ast: Explanation, payload: RoadmapPayload, surface: "before" | "after" = "before", title = false): LocalizedText {
  const render = (locale: "en" | "ko") => {
    const form = ast.relation === "sequence" ? surface : ast.relation;
    const ids = form === "after" ? [...ast.actions].reverse() : ast.actions;
    const names = ids.map(id => {
      const action = payload.actions.find(a => a.alias === id);
      if (!action || /[«»]/u.test(action.meaning.title[locale])) return invalid();
      return `«${action.meaning.title[locale]}»`;
    });
    return forms[locale][form][0] + names.join(forms[locale][form][1]) + "." + (title ? "" : focusText[ast.focus][locale]);
  };
  return { en: render("en"), ko: render("ko") };
}
function decode(text: string, locale: "en" | "ko", payload: RoadmapPayload, title: boolean): Explanation {
  let focus: Explanation["focus"] = "review";
  if (!title) {
    const entry = (Object.entries(focusText) as [Explanation["focus"], LocalizedText][]).find(([, pair]) => text.endsWith(pair[locale]));
    if (!entry) return invalid();
    focus = entry[0]; text = text.slice(0, -entry[1][locale].length);
  }
  if (!text.endsWith(".")) return invalid();
  for (const form of ["together", "before", "after", "review"] as const) {
    const [prefix, separator] = forms[locale][form];
    if (!text.startsWith(prefix)) continue;
    const body = text.slice(prefix.length, -1);
    const quoted = body.match(/«[^«»]+»/gu) ?? [];
    if (quoted.length < (form === "review" ? 1 : 2) || form === "review" && quoted.length !== 1
      || quoted.join(separator) !== body) continue;
    const actions = quoted.map(part => {
      if (!/^«[^«»]+»$/u.test(part)) return invalid();
      const matches = payload.actions.filter(a => a.meaning.title[locale] === part.slice(1, -1));
      return matches.length === 1 ? matches[0].alias : invalid();
    });
    if (new Set(actions).size !== actions.length) return invalid();
    if (form === "after") actions.reverse();
    return { relation: form === "before" || form === "after" ? "sequence" : form, actions, focus };
  }
  return invalid();
}
export function validateExplanation(pair: LocalizedText, payload: RoadmapPayload, phases: string[][], kind: "summary" | "title"): Explanation {
  const ast = decode(pair.en, "en", payload, kind === "title");
  if (!isDeepStrictEqual(ast, decode(pair.ko, "ko", payload, kind === "title"))) return invalid();
  const positions = ast.actions.map(id => {
    const matches = phases.flatMap((phase, index) => phase.includes(id) ? [index] : []);
    return matches.length === 1 ? matches[0] : invalid();
  });
  if (ast.relation === "sequence" && positions.some((position, index) => index > 0 && position <= positions[index - 1])) return invalid();
  if (ast.relation === "together" && new Set(positions).size !== 1) return invalid();
  const findings = payload.findings.filter(f => ast.actions.includes(f.actionAlias));
  const violations = findings.some(f => f.verdict === "violation"), unknowns = findings.some(f => f.verdict === "unknown");
  if ((ast.focus === "violations" || ast.focus === "mixed") && !violations
    || (ast.focus === "unknowns" || ast.focus === "mixed") && !unknowns) return invalid();
  return ast;
}

/** A compositional grammar, not a finite list of generic summaries/titles.
 * The model chooses anchored groups/order/focus; both strings must decode to the
 * same AST and agree with its actual selected phases. No free factual clauses.
 */
export function explanationGrammar(): string {
  return [
    "Generate source-specific bilingual explanations using this compositional grammar exactly. A/B/... are exact meaning.title labels for selected action aliases, wrapped in «». Never output aliases in the text.",
    "Heads EN / KO: Review «A». / 검토: «A». ; Review together: «A» and «B» [and «C»...]. / 함께 검토: «A» 및 «B» [및 «C»...].",
    "Sequence EN / KO: Proposed review order: «A» before «B» [before «C»...]. / 제안 검토 순서: «A» 다음 «B» [다음 «C»...].",
    "Equivalent after EN / KO: Proposed review order: «B» after «A». / 제안 검토 순서: «B»에 앞서 «A». This means A first, B next in BOTH languages.",
    "Summary = one head + exactly one paired focus suffix below. Phase title = one review/together head only (no suffix), using anchors in that phase. A together group must share a phase; before/after must match distinct actual phase positions. Summary may focus on a relevant subset.",
    JSON.stringify(focusText),
    "Choose focus review, violations, unknowns or mixed only when supported by those selected actions' saved findings. Unknowns require verification, never an enabled/configured/completed assertion. Review order is a proposed priority, not an assertion of technical dependency. No extra sentences or instructions. Keep both language ASTs identical.",
  ].join("\n");
}
