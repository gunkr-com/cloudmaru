import { describe, expect, it } from "vitest";
import { redactForModel } from "./redact";

describe("모델 전송 비밀 값 가리기", () => {
  it.each(["clientSecret", "PASSWORD", "access_token", "api-key", "credential", "thumb_print", "connection-string", "private_key"])("%s 키를 가린다", (key) => {
    expect(redactForModel({ [key]: { nested: "sensitive" } })).toEqual({ [key]: "[redacted]" });
  });
  it.each([
    "AccountKey=abc", "x;SharedAccessSignature=abc", "Password=abc", "password=abc", "a".repeat(501) + "AccountKey=abc",
    // Service Bus·Event Hubs·IoT Hub 연결 문자열과 SAS URL의 서명
    "Endpoint=sb://ns.servicebus.windows.net/;SharedAccessKeyName=root;SharedAccessKey=abc",
    "https://acct.blob.core.windows.net/c/b?sv=2024-01-01&se=2026-12-01&sig=abc%3D",
    "https://acct.blob.core.windows.net/c?SIG=abc",
  ])("연결 문자열을 키와 무관하게 가린다", (value) => {
    expect(redactForModel({ harmless: [value] })).toEqual({ harmless: ["[redacted]"] });
  });
  it("깊이 6부터 자르고 비밀 키를 먼저 처리한다", () => {
    expect(redactForModel({ a: { b: { c: { d: { e: { f: "hidden", token: "secret" } } } } } }))
      .toEqual({ a: { b: { c: { d: { e: { f: "[truncated]", token: "[redacted]" } } } } } });
    expect(redactForModel("value", "", 6)).toBe("[truncated]");
    expect(redactForModel("value", "secret", 6)).toBe("[redacted]");
  });
  it("배열은 20개, 문자열은 원본의 500자 한도를 따른다", () => {
    expect(redactForModel(Array.from({ length: 21 }, (_, i) => i))).toEqual(Array.from({ length: 20 }, (_, i) => i));
    expect(redactForModel("a".repeat(500))).toBe("a".repeat(500));
    expect(redactForModel("a".repeat(501))).toBe("a".repeat(500) + "…[truncated]");
  });
  it.each(["https://acct.blob.core.windows.net/c?signature-version=2", "design=signature", "sigma"])("서명처럼 보이기만 하는 값은 유지한다: %s", (value) => {
    expect(redactForModel({ harmless: value })).toEqual({ harmless: value });
  });
  it("일반 값은 유지하고 입력을 변경하지 않는다", () => {
    const input = Object.freeze({ name: "test", count: 1, enabled: true, nil: null, nested: [{ password: "secret" }] });
    const before = structuredClone(input);
    expect(redactForModel(input)).toEqual({ ...input, nested: [{ password: "[redacted]" }] });
    expect(input).toEqual(before);
    expect(redactForModel(undefined)).toBeUndefined();
  });
});
