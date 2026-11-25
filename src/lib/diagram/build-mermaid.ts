import { createTranslator, pickText } from "@/i18n/translate";
import type { Locale, LocalizedText } from "@/types/i18n";
import { USER_NODE_ID } from "@/lib/catalog/schema";
import type { Catalog, Connection, PlanItem } from "@/types/catalog";

export function sanitizeLabel(name: string): string {
  return name
    // 엔티티로 인코딩한 따옴표·태그와 이스케이프 문자도 일반 텍스트로 유지한다.
    .replace(/&/g, "＆")
    .replace(/#/g, "＃")
    .replace(/\\/g, "＼")
    .replace(/["`]/g, "'")
    .replace(/</g, "(")
    .replace(/>/g, ")")
    .replace(/\r\n|[\r\n\u2028\u2029]/g, " ");
}

export function buildMermaid(
  plan: { items: PlanItem[]; connections: Connection[] },
  catalog: Catalog,
): LocalizedText {
  return { en: buildLocalizedMermaid(plan, catalog, "en"), ko: buildLocalizedMermaid(plan, catalog, "ko") };
}

function buildLocalizedMermaid(plan: { items: PlanItem[]; connections: Connection[] }, catalog: Catalog, locale: Locale): string {
  const components = new Map(catalog.components.map((component) => [component.id, component]));
  const nodeIds = new Map<string, string>();
  const lines = ["flowchart LR"];

  plan.items.forEach(({ componentId }, index) => {
    const component = components.get(componentId);
    if (!component) {
      throw new Error(`구성요소 "${componentId}"가 카탈로그에 없습니다.`);
    }
    const nodeId = `n${index}`;
    nodeIds.set(componentId, nodeId);
    lines.push(`  ${nodeId}["${sanitizeLabel(pickText(component.name, locale))}"]`);
  });

  // 구성요소의 순번은 사용자 연결의 유무와 관계없이 items 순서로 고정한다.
  if (plan.connections.some(({ from, to }) => from === USER_NODE_ID || to === USER_NODE_ID)) {
    const nodeId = `n${plan.items.length}`;
    nodeIds.set(USER_NODE_ID, nodeId);
    lines.push(`  ${nodeId}["${createTranslator(locale)("analysis.diagramUser")}"]`);
  }

  const seen = new Set<string>();
  for (const { from, to } of plan.connections) {
    const fromNode = nodeIds.get(from);
    const toNode = nodeIds.get(to);
    if (fromNode === undefined || toNode === undefined) {
      const missingId = fromNode === undefined ? from : to;
      throw new Error(`연결의 구성요소 "${missingId}"가 구성 목록에 없습니다.`);
    }
    const edge = `  ${fromNode} --> ${toNode}`;
    if (!seen.has(edge)) {
      seen.add(edge);
      lines.push(edge);
    }
  }

  return lines.join("\n");
}
