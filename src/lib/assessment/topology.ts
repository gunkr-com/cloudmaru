import { createTranslator } from "@/i18n/translate";
import { canonicalId } from "@/lib/inventory/normalize";
import { classifyResourceType, type ResourceFamily } from "@/lib/inventory/classify";
import { redactInventoryDisplay } from "@/lib/inventory/diff";
import type { Locale } from "@/types/i18n";
import type { AssessmentCatalogData, AssessmentSeverity, CodeFinding, FindingVerdict } from "@/types/assessment";
import type { CompletionReasonCode, Observation } from "@/types/completion";
import type { RelationType } from "@/types/inventory";
import type { ScanInventory } from "@/types/scan";

export type TopologyNode = {
  id: string; name: string; type: string; group: string;
  // 기존 분류기(ADR-020)가 타입만으로 정한 역할. 원래 Azure ID는 세부 정보에만 표시한다.
  family?: ResourceFamily; azureId?: string;
};
export type TopologyEdge = { sourceId: string; targetId: string; type: RelationType };
export type Topology = { nodes: TopologyNode[]; edges: TopologyEdge[] };
export type TopologyIssue = {
  id: string;
  resourceId: string;
  severity: AssessmentSeverity;
  title: string;
  summary?: string;
  description: string;
  remediation: string;
};
/** 저장된 코드 판정 하나. 판정·근거 경로는 저장 결과 그대로이고 문구만 카탈로그·사전에서 붙인다. */
export type TopologyCheck = TopologyIssue & {
  verdict: FindingVerdict;
  ruleId: string;
  nextCheck?: string;
  reasonCode: CompletionReasonCode | null;
  evidence: { propertyPath: string; state: Observation["state"] }[];
};

export const topologySeverityOrder: Record<AssessmentSeverity, number> = {
  critical: 0, high: 1, medium: 2, low: 3, informational: 4,
};

export function assessmentTopology(inventory: ScanInventory): Topology {
  const display = (text: string) => String(redactInventoryDisplay(text).value);
  const nodes = new Map(inventory.resources.map(resource => {
    const id = canonicalId(resource.id);
    return [id, {
      id, name: display(resource.name), type: display(resource.type.toLowerCase()), group: display(resource.resourceGroup),
      family: classifyResourceType(resource.type).family, azureId: display(resource.id),
    }];
  }));
  const edges = new Map<string, TopologyEdge>();
  for (const relation of inventory.relations) {
    const sourceId = canonicalId(relation.sourceId);
    const targetId = canonicalId(relation.targetId);
    if (sourceId !== targetId && nodes.has(sourceId) && nodes.has(targetId)) {
      edges.set(JSON.stringify([sourceId, targetId, relation.type]), { sourceId, targetId, type: relation.type });
    }
  }
  return {
    nodes: [...nodes.values()].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)),
    edges: [...edges.values()],
  };
}

export function topologyNeighborhood(topology: Topology, rootId: string, limit: number) {
  const adjacent = new Map(topology.nodes.map(node => [node.id, new Set<string>()]));
  for (const { sourceId, targetId } of topology.edges) {
    adjacent.get(sourceId)?.add(targetId);
    adjacent.get(targetId)?.add(sourceId);
  }
  const layers: string[][] = [];
  if (!adjacent.has(rootId) || limit < 1) return { layers, hidden: 0 };
  const visited = new Set([rootId]);
  let remaining = limit;
  let frontier = [rootId];
  while (frontier.length) {
    if (remaining > 0) {
      const shown = frontier.slice(0, remaining);
      layers.push(shown);
      remaining -= shown.length;
    }
    const next: string[] = [];
    for (const id of frontier) {
      for (const neighbor of adjacent.get(id) ?? []) {
        if (visited.has(neighbor)) continue;
        visited.add(neighbor);
        next.push(neighbor);
      }
    }
    frontier = next;
  }
  return { layers, hidden: visited.size - Math.min(visited.size, limit) };
}

export function topologyIssues(
  findings: readonly CodeFinding[],
  catalog: AssessmentCatalogData,
  locale: Locale,
): TopologyIssue[] {
  const t = createTranslator(locale);
  const rules = new Map<string, AssessmentCatalogData["rules"]["rules"][number]>(
    catalog.rules.rules.map(rule => [rule.id, rule]),
  );
  return findings.flatMap(finding => {
    if (finding.verdict !== "violation") return [];
    const rule = rules.get(finding.ruleId);
    return rule ? [{
      id: finding.id, resourceId: canonicalId(finding.resourceId), severity: finding.severity,
      title: rule.title[locale], summary: t(`assessment.topology.ruleSummaries.${rule.id}`), description: rule.description[locale], remediation: rule.remediation[locale],
    }] : [];
  });
}

export function topologyChecks(
  findings: readonly CodeFinding[],
  catalog: AssessmentCatalogData,
  locale: Locale,
): TopologyCheck[] {
  const t = createTranslator(locale);
  const rules = new Map<string, AssessmentCatalogData["rules"]["rules"][number]>(
    catalog.rules.rules.map(rule => [rule.id, rule]),
  );
  return findings.flatMap(finding => {
    const rule = rules.get(finding.ruleId);
    if (!rule) return [];
    const violation = finding.verdict === "violation";
    return [{
      id: finding.id, resourceId: canonicalId(finding.resourceId), severity: finding.severity, verdict: finding.verdict, ruleId: rule.id,
      title: rule.title[locale], description: rule.description[locale], remediation: rule.remediation[locale],
      ...(violation ? {
        summary: t(`assessment.topology.ruleSummaries.${rule.id}`),
        nextCheck: t(`assessment.topology.nextChecks.${rule.id}`),
      } : {}),
      reasonCode: finding.reasonCode,
      evidence: finding.evidence.map(item => ({ propertyPath: item.propertyPath, state: item.observation.state })),
    }];
  });
}

export function topologyRoles(topology: Topology): { family: ResourceFamily; count: number }[] {
  const counts = new Map<ResourceFamily, number>();
  for (const node of topology.nodes) {
    const family = node.family ?? "other";
    counts.set(family, (counts.get(family) ?? 0) + 1);
  }
  return [...counts].map(([family, count]) => ({ family, count }))
    .sort((a, b) => b.count - a.count || a.family.localeCompare(b.family));
}

/** 연결이 기록되지 않은 리소스도 이름·역할·타입·그룹으로 찾는다. */
export function searchTopology(
  topology: Topology,
  query: string,
  family: ResourceFamily | null,
  roleLabel: (family: ResourceFamily) => string,
): TopologyNode[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return topology.nodes.filter(node => {
    const role = node.family ?? "other";
    if (family && role !== family) return false;
    const haystack = [node.name, node.type, node.group, roleLabel(role)].join(" ").toLowerCase();
    return terms.every(term => haystack.includes(term));
  });
}
