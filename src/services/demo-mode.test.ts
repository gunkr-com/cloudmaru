// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { isDemoMode } from "./demo-mode";

afterEach(() => vi.unstubAllEnvs());
it("reports demo mode only for the launcher's exact flag", () => {
  for (const value of ["", "0", "true", "yes"]) { vi.stubEnv("CLOUDSIGHT_DEMO", value); expect(isDemoMode()).toBe(false); }
  vi.stubEnv("CLOUDSIGHT_DEMO", "1");
  expect(isDemoMode()).toBe(true);
});
