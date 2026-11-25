import type { ScanErrorCode } from "@/types/scan";

// 서버 전용 I/O 모듈을 가져오지 않고 오류 이름과 허용된 kind만 읽는다.
export function toScanErrorCode(error: unknown): ScanErrorCode {
  if (!(error instanceof Error) || !("kind" in error)) return "internal";
  if (error.name === "AzureCredentialError") {
    switch (error.kind) {
      case "certificate-not-found":
      case "certificate-invalid":
      case "certificate-expired":
      case "certificate-password-missing":
      case "auth-failed": return error.kind;
    }
  }
  if (error.name === "AzureRequestError") {
    switch (error.kind) {
      case "forbidden":
      case "throttled":
      case "timeout":
      case "too-many-rows": return error.kind;
      case "not-found": return "subscription-not-found";
      case "http":
      case "invalid-response": return "invalid-response";
    }
  }
  return "internal";
}
