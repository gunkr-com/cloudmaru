import { describe, expect, it } from "vitest";
import { isMessageKey } from "@/i18n/translate";
import type { ScanApiErrorCode } from "@/types/scan";
import { SCAN_ERROR_CODES } from "./error-codes";
import { azureSettingsInputSchema } from "./connection-schema";
import { CONNECTION_ERROR_CODES, connectionFieldErrorKey, scanApiErrorMessageKey, scanErrorMessageKey } from "./error-messages";

const apiCodes = {
  "invalid-body": true, "workspace-changed": true, "connection-missing": true,
  "import-invalid": true, "import-too-many-rows": true, "import-empty": true,
  "import-too-large": true, "not-found": true, internal: true,
} satisfies Record<ScanApiErrorCode, true>;

describe("스캔 오류 사전 키", () => {
  it.each(SCAN_ERROR_CODES)("스캔 %s", code => {
    expect(scanErrorMessageKey(code)).toBe(`inventory.errors.scan.${code}`);
    expect(isMessageKey(scanErrorMessageKey(code))).toBe(true);
  });
  it.each(Object.keys(apiCodes) as ScanApiErrorCode[])("API %s", code => {
    expect(scanApiErrorMessageKey(code)).toBe(`inventory.errors.api.${code}`);
    expect(isMessageKey(scanApiErrorMessageKey(code))).toBe(true);
  });
  it("연결 스키마의 모든 필드 오류를 변환하고 모르는 코드는 저장 오류로 처리한다", () => {
    const result = azureSettingsInputSchema.safeParse({ tenantId: "bad", clientId: "bad", certificatePath: "bad", certificatePasswordEnv: "bad", subscriptionIds: [] });
    expect(result.success).toBe(false);
    const codes = result.error!.issues.map(issue => issue.message);
    expect(codes).toHaveLength(5);
    for (const code of codes) {
      expect(connectionFieldErrorKey(code)).toBe(`inventory.connection.form.errors.${code}`);
      expect(isMessageKey(connectionFieldErrorKey(code))).toBe(true);
    }
    for (const code of ["save", "unknown", "__proto__", "toString", ""]) {
      expect(connectionFieldErrorKey(code)).toBe("inventory.connection.form.errors.save");
    }
  });
  it("연결을 고칠 오류만 분류한다", () => {
    expect(CONNECTION_ERROR_CODES).toEqual([
      "connection-missing", "certificate-not-found", "certificate-invalid", "certificate-expired",
      "certificate-password-missing", "auth-failed", "forbidden", "subscription-not-found",
    ]);
  });
});
