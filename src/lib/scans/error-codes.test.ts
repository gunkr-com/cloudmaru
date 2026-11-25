import { expect, expectTypeOf, it } from "vitest";
import type { ScanErrorCode } from "@/types/scan";
import { SCAN_ERROR_CODES, parseScanErrorCode } from "./error-codes";

it("covers exactly the error-code type and maps unknown values to internal", () => {
  expectTypeOf<(typeof SCAN_ERROR_CODES)[number]>().toEqualTypeOf<ScanErrorCode>();
  expect(new Set(SCAN_ERROR_CODES).size).toBe(14);
  for (const code of SCAN_ERROR_CODES) expect(parseScanErrorCode(code)).toBe(code);
  for (const value of [null, undefined, 1, {}, "future-error"]) expect(parseScanErrorCode(value)).toBe("internal");
});
