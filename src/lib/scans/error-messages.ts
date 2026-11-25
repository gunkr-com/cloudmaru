import type { MessageKey } from "@/i18n/messages/types";
import type { ScanApiErrorCode, ScanErrorCode } from "@/types/scan";

export function scanErrorMessageKey(code: ScanErrorCode): MessageKey {
  return `inventory.errors.scan.${code}`;
}

export function scanApiErrorMessageKey(code: ScanApiErrorCode): MessageKey {
  return `inventory.errors.api.${code}`;
}

const connectionFieldErrors = {
  "tenant-id-invalid": "inventory.connection.form.errors.tenant-id-invalid",
  "client-id-invalid": "inventory.connection.form.errors.client-id-invalid",
  "certificate-path-invalid": "inventory.connection.form.errors.certificate-path-invalid",
  "password-env-invalid": "inventory.connection.form.errors.password-env-invalid",
  "subscriptions-invalid": "inventory.connection.form.errors.subscriptions-invalid",
} as const satisfies Record<string, MessageKey>;

export function connectionFieldErrorKey(code: string): MessageKey {
  return Object.hasOwn(connectionFieldErrors, code)
    ? connectionFieldErrors[code as keyof typeof connectionFieldErrors]
    : "inventory.connection.form.errors.save";
}

export const CONNECTION_ERROR_CODES: readonly ScanErrorCode[] = [
  "connection-missing", "certificate-not-found", "certificate-invalid", "certificate-expired",
  "certificate-password-missing", "auth-failed", "forbidden", "subscription-not-found",
];
