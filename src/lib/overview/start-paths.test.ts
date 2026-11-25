import { expect, it } from "vitest";
import type { WorkspaceOverview } from "@/types/overview";
import { overviewStartPaths } from "./start-paths";

const empty: WorkspaceOverview = {
  inventory: { latest: null, pendingScanId: null, latestAttemptFailure: null },
  assessment: { latestAttempt: null, latest: null }, build: null, extend: null, network: null, actions: [], gaps: [],
};
const scanned: WorkspaceOverview = { ...empty,
  inventory: { ...empty.inventory, latest: { id: "scan/1", source: "import", collectedAt: "2026-11-11T12:00:00Z", resourceCount: 3, subscriptionCount: 1 } } };
const saved: WorkspaceOverview = { ...scanned,
  assessment: { latestAttempt: null, latest: { id: "assessment-1", createdAt: "2026-11-11T12:00:00Z", sourceScanId: "scan/1", onLatestScan: true,
    violations: { critical: 0, high: 1, medium: 0, low: 0, informational: 0 }, violationTotal: 1, unknownCount: 0, passCount: 0,
    coverage: { total: 3, included: 2, excluded: 1 } } },
  build: { id: "analysis-1", status: "succeeded", createdAt: "2026-11-11T12:00:00Z", title: null },
  extend: { id: "extension-1", status: "succeeded", createdAt: "2026-11-11T12:00:00Z", title: null } };

it("maps the three start paths to Assess, Build and Extend entry points for a fresh install", () => {
  expect(overviewStartPaths(empty, "w 1")).toEqual([
    { key: "browse", feature: "assess", needsData: true, links: [{ key: "connect", href: "/workspaces/w%201/connection" }] },
    { key: "health", feature: "assess", needsData: true, links: [] },
    { key: "design", feature: "build", needsData: false, links: [{ key: "startBuild", href: "/analyses/new" }] },
  ]);
});

it("offers the next step from a saved scan before any assessment", () => {
  expect(overviewStartPaths(scanned, "w1")).toEqual([
    { key: "browse", feature: "assess", needsData: false, links: [{ key: "openInventory", href: "/inventory/scans/scan%2F1" }] },
    { key: "health", feature: "assess", needsData: false, links: [{ key: "assessScan", href: "/assessments/new?sourceScanId=scan%2F1" }] },
    { key: "design", feature: "build", needsData: false, links: [{ key: "startBuild", href: "/analyses/new" }, { key: "startExtend", href: "/extensions/new" }] },
  ]);
});

it("opens saved results directly when they exist", () => {
  expect(overviewStartPaths(saved, "w1")).toEqual([
    { key: "browse", feature: "assess", needsData: false, links: [
      { key: "openTopology", href: "/assessments/assessment-1#topology" }, { key: "openAssessedScan", href: "/inventory/scans/scan%2F1" }] },
    { key: "health", feature: "assess", needsData: false, links: [{ key: "openAssessment", href: "/assessments/assessment-1" }] },
    { key: "design", feature: "build", needsData: false, links: [{ key: "openBuild", href: "/analyses/analysis-1" }, { key: "openExtend", href: "/extensions/extension-1" }] },
  ]);
});

it("keeps the assessed scan first and labels a newer, different scan separately", () => {
  const newer: WorkspaceOverview = { ...saved, inventory: { ...saved.inventory, latest: { ...saved.inventory.latest!, id: "network-example" } },
    assessment: { ...saved.assessment, latest: { ...saved.assessment.latest!, onLatestScan: false } } };
  expect(overviewStartPaths(newer, "w1")[0].links).toEqual([
    { key: "openTopology", href: "/assessments/assessment-1#topology" },
    { key: "openAssessedScan", href: "/inventory/scans/scan%2F1" },
    { key: "openLatestScan", href: "/inventory/scans/network-example" },
  ]);
});
