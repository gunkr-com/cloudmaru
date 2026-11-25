import { describe, expect, it } from "vitest";
import { createTranslator, isMessageKey, pickText, pluralKey } from "./translate";
it("두 언어와 매개변수, 누락된 자리를 처리한다", () => {
  expect(createTranslator("en")("shell.nav.newAnalysis")).toBe("New analysis");
  expect(createTranslator("ko")("shell.cost.uncounted", { count: 2 })).toBe("단가를 알 수 없는 호출 2건 제외");
  expect(createTranslator("en")("shell.cost.uncounted")).toContain("{count}");
  expect(pickText({ en: "Hello", ko: "안녕" }, "ko")).toBe("안녕");
});
describe("isMessageKey", () => {
  it.each(["shell.nav.newAnalysis", "common.languages.en"])("잎 경로 %s", key => expect(isMessageKey(key)).toBe(true));
  it.each([null, {}, "shell", "shell.nav", "shell.missing", "toString", "__proto__", "shell.nav.toString"])("잘못된 키 %s", key => expect(isMessageKey(key)).toBe(false));
});
// 객체 경로는 번역 키가 될 수 없다.
if (false) {
  // @ts-expect-error 문자열 잎만 허용
  createTranslator("en")("shell.nav");
}
describe("pluralKey", () => {
  it("picks the singular message only for exactly one", () => {
    expect(pluralKey(1, "inventory.table.tagCountOne", "inventory.table.tagCount")).toBe("inventory.table.tagCountOne");
    for (const count of [0, 2, 1.5]) expect(pluralKey(count, "inventory.table.tagCountOne", "inventory.table.tagCount")).toBe("inventory.table.tagCount");
  });
});

it.each(["en", "ko"] as const)("provides local pricing instructions in %s", locale => {
  expect(createTranslator(locale)("pricing.unavailable")).toContain("npm run prices:sync");
  expect(createTranslator(locale)("pricing.syntheticDemo")).toBeTruthy();
});
