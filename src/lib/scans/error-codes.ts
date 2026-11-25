import type { ScanErrorCode } from "@/types/scan";

export const SCAN_ERROR_CODES = [
  "connection-missing", "certificate-not-found", "certificate-invalid", "certificate-expired",
  "certificate-password-missing", "auth-failed", "forbidden", "subscription-not-found",
  "throttled", "timeout", "too-many-rows", "invalid-response", "interrupted", "internal",
] as const satisfies readonly ScanErrorCode[];

export function parseScanErrorCode(value: unknown): ScanErrorCode {
  return typeof value === "string" && (SCAN_ERROR_CODES as readonly string[]).includes(value)
    ? value as ScanErrorCode : "internal";
}
