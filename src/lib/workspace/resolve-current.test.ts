import { expect, it } from "vitest";
import type { Workspace } from "@/types/workspace";
import { DEFAULT_WORKSPACE_NAME, resolveCurrentWorkspace } from "./resolve-current";
const first: Workspace = { id: "first", name: "First", companyName: null, defaultRegion: "canadacentral", currency: "CAD", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
const second = { ...first, id: "second" };
it("selects the cookie match or oldest workspace without changing the list", () => {
  const list = Object.freeze([first, second]);
  expect(resolveCurrentWorkspace("second", list)).toBe(second);
  for (const cookie of [undefined, "", "missing"]) expect(resolveCurrentWorkspace(cookie, list)).toBe(first);
  expect(resolveCurrentWorkspace("second", [])).toBeNull();
  expect(DEFAULT_WORKSPACE_NAME).toBe("Default workspace");
});
