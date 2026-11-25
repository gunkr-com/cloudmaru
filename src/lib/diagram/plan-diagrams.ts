import { createTranslator, pickText } from "@/i18n/translate";
import type { Locale } from "@/types/i18n";
import { USER_NODE_ID } from "@/lib/catalog/schema";
import { sanitizeLabel } from "@/lib/diagram/build-mermaid";
import type { PlanResult } from "@/types/analysis";
import type { Connection } from "@/types/catalog";

export type DiagramPlan = Pick<PlanResult, "services" | "connections" | "mermaid">;

// 연결 없는 항목 묶음의 한 줄에 놓는 최대 항목 수. 큰 그림이 대화상자 폭을 넘지 않게 한다.
const MAX_EXTRA_COLUMNS = 3;

/**
 * 구성요소 간 연결을 목록에 있는 끝점만, 같은 방향의 중복 없이 순서대로 돌려준다.
 * connections 필드가 생기기 전에 저장된 결과는 buildMermaid가 만든 정의의 화살표에서 노드 순번만 읽는다.
 * n{i}는 i번째 서비스이고 n{서비스 수}는 사용자다. 저장된 라벨은 읽지 않는다.
 */
export function getPlanConnections(plan: DiagramPlan): Connection[] {
  const ids = [...plan.services.map(({ componentId }) => componentId), USER_NODE_ID];
  const candidates = plan.connections ?? plan.mermaid.ko.split(/\r?\n/).flatMap((line) => {
    const edge = /^\s*n(\d+)\s*-->\s*n(\d+)\s*$/.exec(line);
    const from = edge ? ids[Number(edge[1])] : undefined;
    const to = edge ? ids[Number(edge[2])] : undefined;
    return from !== undefined && to !== undefined ? [{ from, to }] : [];
  });
  const known = new Set(ids);
  const seen = new Set<string>();
  const result: Connection[] = [];
  for (const { from, to } of candidates) {
    const key = `${from}\0${to}`;
    if (known.has(from) && known.has(to) && !seen.has(key)) {
      seen.add(key);
      result.push({ from, to });
    }
  }
  return result;
}

/**
 * 저장된 결과에서 카드용 그림과 "크게 보기"용 그림의 Mermaid 정의를 만든다.
 * 라벨은 서비스 목록의 카탈로그 이름과 "사용자"뿐이며 모두 sanitizeLabel을 거친다.
 * 카드에는 연결에 참여하는 노드만 좁은 카드 폭에 맞게 위에서 아래로 그리고,
 * 큰 그림에는 같은 흐름 아래에 연결 없는 과금 항목을 "부가·과금 항목" 묶음으로 붙인다.
 */
export function buildPlanDiagrams(plan: DiagramPlan, locale: Locale): { preview: string; full: string } {
  const t = createTranslator(locale);
  const connections = getPlanConnections(plan);
  const nodes = [
    ...plan.services.map(({ componentId, name }, index) => ({ componentId, nodeId: `n${index}`, name: pickText(name, locale) })),
    { componentId: USER_NODE_ID, nodeId: `n${plan.services.length}`, name: t("analysis.diagramUser") },
  ];
  const nodeLine = (indent: string) => ({ nodeId, name }: (typeof nodes)[number]) => `${indent}${nodeId}["${sanitizeLabel(name)}"]`;

  // 연결이 하나도 없으면 흐름이 없으므로 이전처럼 모든 항목을 그린다.
  // 위에서 아래(TB)로 그리면 연결 없는 항목이 가로 한 줄로 늘어서므로 이전과 같은 LR로 세로로 쌓는다.
  if (connections.length === 0) {
    const code = ["flowchart LR", ...nodes.slice(0, -1).map(nodeLine("  "))].join("\n");
    return { preview: code, full: code };
  }

  const nodeIds = new Map(nodes.map(({ componentId, nodeId }) => [componentId, nodeId]));
  const connected = new Set(connections.flatMap(({ from, to }) => [from, to]));
  const flow = nodes.filter(({ componentId }) => connected.has(componentId));
  const extras = nodes.slice(0, -1).filter(({ componentId }) => !connected.has(componentId));
  const edges = connections.map(({ from, to }) => `  ${nodeIds.get(from)} --> ${nodeIds.get(to)}`);
  const preview = ["flowchart TB", ...flow.map(nodeLine("  ")), ...edges].join("\n");
  if (extras.length === 0) return { preview, full: preview };

  // 흐름의 끝 노드(순환이면 흐름 전체)에서 묶음으로 보이지 않는 연결을 걸어 묶음을 흐름 아래에 둔다.
  const sources = new Set(connections.map(({ from }) => from));
  const sinks = flow.filter(({ componentId }) => !sources.has(componentId));
  // 줄 수를 최소로 하되 마지막 줄만 짧아지지 않게 칸 수를 고르게 나눈다(4개는 2×2).
  const columns = Math.ceil(extras.length / Math.ceil(extras.length / MAX_EXTRA_COLUMNS));
  const full = [
    "flowchart TB",
    ...flow.map(nodeLine("  ")),
    `  subgraph extra["${t("analysis.diagramExtras")}"]`,
    ...extras.map(nodeLine("    ")),
    // 같은 칸의 위아래 항목을 보이지 않게 이어 columns개씩 줄을 바꾼다.
    ...extras.slice(columns).map(({ nodeId }, index) => `    ${extras[index].nodeId} ~~~ ${nodeId}`),
    "  end",
    ...edges,
    ...(sinks.length > 0 ? sinks : flow).map(({ nodeId }) => `  ${nodeId} ~~~ extra`),
  ].join("\n");
  return { preview, full };
}
