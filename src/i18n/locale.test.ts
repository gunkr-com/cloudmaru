import { describe, expect, it } from "vitest";
import { DEFAULT_LOCALE, LOCALES, LOCALE_COOKIE, parseLocale } from "./locale";
describe("locale", () => {
  it("영어를 기본으로 엄격히 판정한다", () => {
    expect(DEFAULT_LOCALE).toBe("en"); expect(LOCALES).toEqual(["en", "ko"]); expect(LOCALE_COOKIE).toBe("cs_locale");
    for (const value of [undefined, null, {}, "KO", "ko-KR", "", 1]) expect(parseLocale(value)).toBe("en");
    expect(parseLocale("ko")).toBe("ko"); expect(parseLocale("en")).toBe("en");
  });
});
