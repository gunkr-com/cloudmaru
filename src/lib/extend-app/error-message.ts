import type { MessageKey } from "@/i18n/messages/types";
/** Only fixed product copy is shown; provider error text never becomes a label. */
export function extensionFailureMessage(code: string | null | undefined): { key: MessageKey; keyUnavailable: boolean } {
  if (code === "auth-failed" || code === "forbidden" || code === "not-configured") return { key: "extension.errors.key-unavailable", keyUnavailable: true };
  const key = code === "timeout" ? "extension.errors.timeout" : code === "interrupted" ? "extension.errors.interrupted"
    : code === "validation-failed" ? "extension.errors.validation-failed" : "extension.errors.internal";
  return { key, keyUnavailable: false };
}
