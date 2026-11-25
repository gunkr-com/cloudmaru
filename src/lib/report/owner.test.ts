import { expect, it } from "vitest";
import { reportFixture } from "@/lib/assessment/report/fixtures.test-data";
import { buildAssessmentReport } from "@/lib/assessment/report/document";
import { reportMarkdown } from "@/lib/assessment/report/markdown";
import type { Workspace } from "@/types/workspace";
import { ownerBlocks, reportOwner, withOwnerIdentity } from "./owner";

const workspace = (id: string, overrides: Partial<Workspace> = {}): Workspace => ({
  id, name: "Synthetic offline demo", companyName: "Synthetic examples only · 합성 예제 전용", defaultRegion: "canadacentral",
  currency: "CAD", createdAt: "2026-11-01T00:00:00.000Z", updatedAt: "2026-11-01T00:00:00.000Z", ...overrides,
});

it("binds stored labels only to the saved owner and fails closed for a missing or different workspace", () => {
  const id = "00000000-0000-4000-8000-0000000000aa";
  expect(reportOwner(id, workspace(id))).toEqual({ workspaceId: id, name: "Synthetic offline demo", companyName: "Synthetic examples only · 합성 예제 전용" });
  expect(reportOwner(id, workspace(id, { companyName: null }))).toEqual({ workspaceId: id, name: "Synthetic offline demo", companyName: null });
  expect(() => reportOwner(id, null)).toThrow("report-unavailable");
  // A current/selected workspace with different labels is never substituted for the saved owner.
  expect(() => reportOwner(id, workspace("00000000-0000-4000-8000-0000000000bb", { name: "Current cookie workspace" }))).toThrow("report-unavailable");
});

it.each([["en", "Workspace name", "Company", "Not set"], ["ko", "워크스페이스 이름", "회사", "설정 안 됨"]] as const)("localizes %s owner blocks with stored labels and an explicit unset company", (locale, name, company, unset) => {
  const owner = { workspaceId: "w", name: "Synthetic offline demo", companyName: null };
  const blocks = ownerBlocks(owner, locale);
  expect(blocks).toContainEqual({ kind: "text", text: name });
  expect(blocks).toContainEqual({ kind: "code", text: "Synthetic offline demo" });
  expect(blocks).toContainEqual({ kind: "text", text: company });
  expect(blocks).toContainEqual({ kind: "text", text: unset });
  expect(JSON.stringify(blocks)).not.toContain('"w"');
});

it("adds owner labels after the saved workspace ID without changing other saved evidence or the input", () => {
  const f = reportFixture(), evidence = buildAssessmentReport(f.record, f.catalogData, "en"), before = structuredClone(evidence);
  const owner = reportOwner(f.record.workspaceId, workspace(f.record.workspaceId));
  const next = withOwnerIdentity(evidence, owner);
  expect(evidence).toEqual(before);
  const identity = next.sections.find(s => s.id === "identity")!, original = before.sections.find(s => s.id === "identity")!;
  const at = identity.blocks.findIndex(b => b.kind === "code" && b.text === f.record.workspaceId);
  expect(identity.blocks.slice(0, at + 1)).toEqual(original.blocks.slice(0, at + 1));
  expect(identity.blocks.slice(at + 1, at + 1 + ownerBlocks(owner, "en").length)).toEqual(ownerBlocks(owner, "en"));
  expect(identity.blocks.slice(at + 1 + ownerBlocks(owner, "en").length)).toEqual(original.blocks.slice(at + 1));
  expect(next.sections.filter(s => s.id !== "identity")).toEqual(before.sections.filter(s => s.id !== "identity"));
  const md = reportMarkdown(next);
  expect(md).toContain("Synthetic offline demo");
  expect(md).toContain("Synthetic examples only · 합성 예제 전용");
});

it("keeps hostile stored labels inert in Markdown and refuses an owner that does not match the saved document", () => {
  const f = reportFixture(), evidence = buildAssessmentReport(f.record, f.catalogData, "ko");
  const owner = { workspaceId: f.record.workspaceId, name: "```\n<img src=x onerror=alert(1)>", companyName: "[go](javascript:alert(1))" };
  const md = reportMarkdown(withOwnerIdentity(evidence, owner));
  expect(md).toContain("````text\n```\n<img src=x onerror=alert(1)>\n````");
  expect(md).toContain("```text\n[go](javascript:alert(1))\n```");
  expect(() => withOwnerIdentity(evidence, { ...owner, workspaceId: "00000000-0000-4000-8000-0000000000bb" })).toThrow("report-unavailable");
});
