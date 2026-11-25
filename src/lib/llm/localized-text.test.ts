import { describe, expect, it } from "vitest";
import { localizedTextSchema, LOCALIZED_TEXT_JSON_SCHEMA, readStoredText, validationLimit } from "./localized-text";

it("검증 한도는 프롬프트에 적은 글자 수의 1.25배(올림)다", () => {
  expect([4, 40, 120, 200, 300].map(validationLimit)).toEqual([5, 50, 150, 250, 375]);
  expect(validationLimit(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER);
});

describe("localizedTextSchema", () => {
  // ko 4자 → 검증 5자, en 기본 8자 → 검증 10자
  const schema = localizedTextSchema({ ko: 4 }, "글");
  it("두 언어의 공백을 없애고 추가 필드를 버린다", () => {
    expect(schema.parse({ en: "  English  ", ko: "  한국어  ", extra: 1 })).toEqual({ en: "English", ko: "한국어" });
    expect(schema.safeParse({ en: "a".repeat(10), ko: "가".repeat(5) }).success).toBe(true);
  });
  it.each([{}, "옛 글", { en: "English" }, { ko: "한국어" }, { en: " ", ko: "한" }, { en: "en", ko: " " }, { en: "a".repeat(11), ko: "한" }, { en: "en", ko: "가".repeat(6) }])("잘못된 글 %j를 거절한다", value => {
    expect(schema.safeParse(value).success).toBe(false);
  });
  it.each(["한", "ㄱ", "ㅏ", "한", "ㆆ", "ꥠ", "ힰ", "ﾡ"])("영어에 섞인 한글 %s를 거절한다", hangul => {
    const parsed = schema.safeParse({ en: hangul, ko: "Azure" });
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(parsed.error.issues).toContainEqual(expect.objectContaining({ path: ["en"], message: "영어 글에 한국어가 섞였습니다" }));
  });
  it("영어 한도를 따로 지정할 수 있다", () => {
    expect(localizedTextSchema({ ko: 4, en: 3 }, "제목").safeParse({ en: "four", ko: "한" }).success).toBe(true);
    expect(localizedTextSchema({ ko: 4, en: 3 }, "제목").safeParse({ en: "fives", ko: "한" }).success).toBe(false);
  });
  // 오류 문장은 재시도 때 모델에 간다. 이름의 받침에 맞춰 은/는을 고르고, 한글로 끝나지 않으면 둘 다 적는다.
  it.each([["배포 메모", "는"], ["절차", "는"], ["요청 제목", "은"], ["장점", "은"], ["Bicep", "은(는)"]])("오류 문장은 이름의 받침에 맞춰 조사를 고른다 (%s%s)", (label, particle) => {
    const parsed = localizedTextSchema({ ko: 4 }, label).safeParse({ en: " ", ko: "가".repeat(6) });
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(parsed.error.issues.map(({ message }) => message)).toEqual([
      `${label}${particle} 빈 문자열일 수 없습니다.`,
      `${label}${particle} 5자 이하여야 합니다.`,
    ]);
  });
  it("제공자 스키마는 두 언어가 필수인 엄격 객체다", () => {
    expect(LOCALIZED_TEXT_JSON_SCHEMA).toEqual({ type: "object", properties: { en: { type: "string" }, ko: { type: "string" } }, required: ["en", "ko"], additionalProperties: false });
  });
});

it("저장된 글은 옛 문자열을 두 언어로 복사하고 새 객체도 복사한다", () => {
  expect(readStoredText("옛 한국어")).toEqual({ en: "옛 한국어", ko: "옛 한국어" });
  const text = { en: "Title", ko: "제목", extra: 1 };
  expect(readStoredText(text)).toEqual({ en: "Title", ko: "제목" });
  expect(readStoredText(text)).not.toBe(text);
  for (const invalid of [null, undefined, [], 1, {}, { en: "Title" }, { en: 1, ko: "글" }]) expect(readStoredText(invalid)).toBeNull();
});
