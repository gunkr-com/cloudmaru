import type { CodeFinding } from "@/types/assessment";
import type { InventoryResource } from "@/types/inventory";
import type { NetworkDiagnostic } from "@/types/network-diagnostics";
import type { ExplorerRow } from "./explorer";
export function inventoryRows(resources: InventoryResource[]): ExplorerRow[] {
  return resources.map(resource => ({ id: resource.id, values: { name: resource.name, resource: resource.id, type: resource.type, group: resource.resourceGroup, region: resource.location, subscription: resource.subscriptionId, tags: Object.keys(resource.tags).length } }));
}
export function assessmentRows(findings: CodeFinding[], resourceLabels: Record<string, string>, ruleLabels: Record<string, string>): ExplorerRow[] {
  return findings.map(finding => {
    const parts = finding.resourceId.split("/"); const provider = parts.findIndex(part => part.toLowerCase() === "providers");
    const type = provider < 0 ? null : parts.slice(provider + 1).filter((_, index) => index === 0 || index % 2 === 1).join("/");
    const groupIndex = parts.findIndex(part => part.toLowerCase() === "resourcegroups");
    return { id: finding.id, values: { rule: ruleLabels[finding.ruleId] ?? finding.ruleId, resource: finding.resourceId, verdict: finding.verdict, severity: finding.severity, pillar: finding.pillar, type, group: groupIndex < 0 ? null : parts[groupIndex + 1] }, labels: { resource: resourceLabels[finding.resourceId] ?? finding.resourceId }, order: { verdict: ["violation", "unknown", "pass"].indexOf(finding.verdict) * 10 + ["critical", "high", "medium", "low", "informational"].indexOf(finding.severity) } };
  });
}
export function networkRows(paths: NetworkDiagnostic["engine"]["paths"]): ExplorerRow[] {
  return paths.flatMap((path, pathIndex) => path.hops.map((hop, hopIndex) => ({ id: `${pathIndex}:${hopIndex}`, values: { path: pathIndex + 1, hop: hopIndex + 1, type: hop.hopType, verdict: hop.verdict, resource: hop.resourceId } })));
}
