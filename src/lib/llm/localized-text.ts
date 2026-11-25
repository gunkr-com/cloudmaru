import { z } from "zod";
import type { LocalizedText } from "@/types/i18n";

// 완성형·호환 자모·조합 자모와 확장·반각 자모도 영어 글에 섞이지 않게 한다.
const HANGUL = /\p{Script=Hangul}/u;

// 프롬프트에 적는 글자 수는 목표다. 모델은 한국어 글자 수를 정확히 세지 못해 가끔 조금 넘기므로,
// 검증은 그 1.25배까지 받는다(ADR-022). 화면은 이 길이까지 줄바꿈으로 버틴다.
export const LENGTH_TOLERANCE = 1.25;

export function validationLimit(stated: number): number {
  return Math.min(Number.MAX_SAFE_INTEGER, Math.ceil(stated * LENGTH_TOLERANCE));
}

// 분석·결과물 프롬프트의 글 규칙에 함께 넣는다. 공백을 빼고 세면 한국어 글이 한도를 크게 넘는다.
export const LENGTH_RULE = "- 글자 수 한도는 공백과 문장 부호를 포함해 셉니다. 한도에 맞춰 늘리지 말고 넉넉히 짧게 씁니다.";

// 오류 문장은 재시도 때 모델에 가므로 은/는을 이름의 마지막 글자 받침에 맞춘다. 한글로 끝나지 않으면 둘 다 적는다.
function withTopicParticle(label: string): string {
  const syllable = label.charCodeAt(label.length - 1) - 0xac00;
  if (!(syllable >= 0 && syllable < 11172)) return `${label}은(는)`;
  return `${label}${syllable % 28 === 0 ? "는" : "은"}`;
}

// limits는 프롬프트에 적은 글자 수다. en을 생략하면 ko의 두 배다.
export function localizedTextSchema(limits: { ko: number; en?: number }, label: string): z.ZodType<LocalizedText> {
  const subject = withTopicParticle(label);
  const text = (stated: number) => {
    const max = validationLimit(stated);
    return z.string().trim()
      .min(1, `${subject} 빈 문자열일 수 없습니다.`)
      .max(max, `${subject} ${max}자 이하여야 합니다.`);
  };
  return z.object({
    en: text(limits.en ?? limits.ko * 2).refine(value => !HANGUL.test(value), "영어 글에 한국어가 섞였습니다"),
    ko: text(limits.ko),
  }).strip();
}

export const LOCALIZED_TEXT_JSON_SCHEMA = {
  type: "object",
  properties: { en: { type: "string" }, ko: { type: "string" } },
  required: ["en", "ko"],
  additionalProperties: false,
} as const;

// 저장된 글에는 새 생성 규칙을 소급하지 않는다. M2 중 저장된 문자열도 그대로 연다.
export function readStoredText(value: unknown): LocalizedText | null {
  if (typeof value === "string") return { en: value, ko: value };
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const text = value as Record<string, unknown>;
  return typeof text.en === "string" && typeof text.ko === "string" ? { en: text.en, ko: text.ko } : null;
}
