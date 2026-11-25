import { describe, expect, it } from "vitest";
import { AzureCredentialError } from "@/services/azure/credential";
import { AzureRequestError } from "@/services/azure/request";
import { toScanErrorCode } from "./map-error";

describe("스캔 오류 코드", () => {
  it.each(["certificate-not-found", "certificate-invalid", "certificate-expired", "certificate-password-missing", "auth-failed"] as const)("인증 오류 %s를 보존한다", kind => {
    expect(toScanErrorCode(new AzureCredentialError(kind))).toBe(kind);
  });
  it.each([
    ["forbidden", "forbidden"], ["not-found", "subscription-not-found"], ["throttled", "throttled"],
    ["timeout", "timeout"], ["too-many-rows", "too-many-rows"], ["http", "invalid-response"],
    ["invalid-response", "invalid-response"], ["disallowed", "internal"],
  ] as const)("요청 오류 %s를 %s로 바꾼다", (kind, code) => {
    expect(toScanErrorCode(new AzureRequestError(kind))).toBe(code);
  });
  it.each([null, undefined, "timeout", new Error("secret"), { kind: "timeout" }, { name: "Other", kind: "forbidden" }, { name: "AzureRequestError", kind: "unknown" }])("다른 오류는 internal이다: %j", error => {
    expect(toScanErrorCode(error)).toBe("internal");
  });
});
