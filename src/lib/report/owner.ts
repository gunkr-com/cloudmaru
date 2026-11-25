import { createTranslator } from "@/i18n/translate";
import { redactInventoryDisplay } from "@/lib/inventory/diff";
import type { AssessmentReport, ReportBlock } from "@/lib/assessment/report/document";
import type { Locale } from "@/types/i18n";
import type { ReportOwner } from "@/types/report";
import type { Workspace } from "@/types/workspace";

const safe = (value: string) => String(redactInventoryDisplay(value).value);

/**
 * Report labels come from the workspace row whose ID the saved record stores. The caller looks it up
 * by that saved ID (never the current-workspace cookie). A missing or different row fails closed.
 * Labels are the row's current stored values, not a snapshot taken when the record was saved.
 */
export function reportOwner(savedWorkspaceId: string, workspace: Workspace | null): ReportOwner {
  if (!workspace || workspace.id !== savedWorkspaceId) throw Error("report-unavailable");
  return { workspaceId: savedWorkspaceId, name: workspace.name, companyName: workspace.companyName };
}

/** Owner label blocks for provenance. The immutable workspace ID stays in its own existing block. */
export function ownerBlocks(owner: ReportOwner, locale: Locale): ReportBlock[] {
  const t = createTranslator(locale);
  return [
    { kind: "text", text: t("reports.workspaceName") }, { kind: "code", text: safe(owner.name) },
    { kind: "text", text: t("reports.company") },
    owner.companyName === null ? { kind: "text", text: t("reports.companyUnset") } : { kind: "code", text: safe(owner.companyName) },
    { kind: "text", text: t("reports.ownerLabels") },
  ];
}

/** Returns a copy of the verified Assess evidence document with owner labels after the saved workspace ID. */
export function withOwnerIdentity(report: AssessmentReport, owner: ReportOwner): AssessmentReport {
  const index = report.sections.findIndex(s => s.id === "identity");
  const identity = report.sections[index];
  const at = identity ? identity.blocks.findIndex(b => b.kind === "code" && b.text === owner.workspaceId) : -1;
  if (at < 0) throw Error("report-unavailable");
  const blocks = [...identity.blocks.slice(0, at + 1), ...ownerBlocks(owner, report.locale), ...identity.blocks.slice(at + 1)];
  return { ...report, sections: report.sections.map((s, i) => i === index ? { ...s, blocks } : s) };
}
