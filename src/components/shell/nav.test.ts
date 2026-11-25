import { describe, expect, it } from "vitest";
import { getActiveNavKey } from "./nav";

describe("getActiveNavKey", () => {
  it.each([
    ["/analyses/new", "new"],
    ["/analyses/new/extra", "new"],
    ["/analyses", "history"],
    ["/analyses/0f8c", "history"],
    ["/inventory", "inventory"],
    ["/inventory/scans/abc", "inventory"],
    ["/inventory-other", null],
    ["/assessments", "assessments"], ["/assessments/new", "assessments"],
    ["/assessments/id/report", "assessments"], ["/assessments-other", null],
    ["/network", "network"], ["/network/id", "network"], ["/network-other", null],
    ["/extensions", "extensions"], ["/extensions/new", "extensions"],
    ["/extensions/id", "extensions"], ["/extensions-other", null],
    ["/overview", "overview"], ["/overview/extra", "overview"], ["/overview-other", null],
    ["/pricing", null],
    ["/workspaces", "workspaces"],
    ["/workspaces/edit", "workspaces"],
    ["/workspaces-other", null],
  ] as const)("%s -> %s", (path, key) => expect(getActiveNavKey(path)).toBe(key));
});
