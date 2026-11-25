import { createTranslator, pickText } from "@/i18n/translate";
import type { Locale } from "@/types/i18n";
import { USER_NODE_ID } from "@/lib/catalog/schema";
import { getPlanConnections } from "@/lib/diagram/plan-diagrams";
import type { PlanResult } from "@/types/analysis";

export type DiagramEdge = { from: string; to: string };

export function getDiagramEdges(plan: PlanResult, locale: Locale): DiagramEdge[] {
  const names = new Map(plan.services.map(({ componentId, name }) => [componentId, pickText(name, locale)]));
  names.set(USER_NODE_ID, createTranslator(locale)("analysis.diagramUser"));
  const result: DiagramEdge[] = [];
  const seen = new Set<string>();
  for (const connection of getPlanConnections(plan)) {
    const from = names.get(connection.from)!;
    const to = names.get(connection.to)!;
    const key = `${from}\0${to}`;
    if (!seen.has(key)) { seen.add(key); result.push({ from, to }); }
  }
  return result;
}
