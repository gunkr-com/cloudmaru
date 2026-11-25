import type { Locale } from "@/types/i18n";
import type { AssessmentReport } from "./document";

/** 인라인 문법·HTML·GFM 자동 링크·줄바꿈은 문자 참조로 보존한다. */
const escaped = (value: string) => value.replace(/[\u0000-\u002f\u003a-\u0040\u005b-\u0060\u007b-\u007f]/g,
  char => char === " " ? " " : `&#${char.charCodeAt(0)};`);
function fenced(value: string): string {
  let length = 3;
  for (const match of value.matchAll(/`+/g)) length = Math.max(length, match[0].length + 1);
  const fence = "`".repeat(length);
  return `${fence}text\n${value}\n${fence}`;
}
/** JSON은 길이가 충분한 fence 안에, 출처만 카탈로그 링크로 출력한다. */
export function reportMarkdown(report: AssessmentReport): string {
  const parts = [`# ${escaped(report.title)}`];
  for (const section of report.sections) {
    parts.push(`${"#".repeat(section.level)} ${escaped(section.title)}`);
    for (const block of section.blocks) {
      if (block.kind === "code") parts.push(fenced(block.text));
      else if (block.kind === "text") parts.push(escaped(block.text));
      else if (block.kind === "time") parts.push(`${escaped(block.label)}: ${escaped(block.value)}`);
      else parts.push(`[${escaped(block.label)}](${block.href.replace(/[()]/g, char => char === "(" ? "%28" : "%29")})`);
    }
  }
  return parts.join("\n\n") + "\n";
}
export function parseReportQuery(params: URLSearchParams, fallback: Locale): {format: "markdown"; locale: Locale} {
  if ([...params.keys()].some(key => !["format", "lang"].includes(key) || params.getAll(key).length !== 1)
    || params.has("format") && params.get("format") !== "markdown"
    || params.has("lang") && params.get("lang") !== "en" && params.get("lang") !== "ko") throw new Error("invalid-query");
  return { format: "markdown", locale: params.get("lang") as Locale | null ?? fallback };
}
