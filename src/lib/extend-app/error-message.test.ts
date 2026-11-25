import { expect, it } from "vitest";
import { extensionFailureMessage } from "./error-message";
it("shares key recovery copy without exposing arbitrary failure codes", () => {
  for (const code of ["auth-failed", "forbidden", "not-configured"]) expect(extensionFailureMessage(code)).toEqual({ key: "extension.errors.key-unavailable", keyUnavailable: true });
  for (const code of ["timeout", "interrupted", "validation-failed"]) expect(extensionFailureMessage(code)).toEqual({ key: `extension.errors.${code}`, keyUnavailable: false });
  for (const code of [null, "SECRET", "constructor", "__proto__"]) expect(extensionFailureMessage(code)).toEqual({ key: "extension.errors.internal", keyUnavailable: false });
});
