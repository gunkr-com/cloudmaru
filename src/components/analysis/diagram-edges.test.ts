import { describe, expect, it } from "vitest";
import { buildAnalysisResult } from "@/lib/analysis/build-result";
import { loadCatalog } from "@/lib/catalog/load";
import sampleInput from "@/lib/analysis/fixtures/sample-input.json";
import sampleOutput from "@/lib/analysis/fixtures/sample-model-output.json";
import { analysisInputSchema } from "@/lib/analysis/input-schema";
import { buildMermaid } from "@/lib/diagram/build-mermaid";
import { getDiagramEdges } from "@/components/analysis/diagram-edges";
import type { PlanResult } from "@/types/analysis";

const outcome = buildAnalysisResult(sampleOutput, analysisInputSchema.parse(sampleInput), loadCatalog());
if (!outcome.ok) throw new Error(outcome.errors.join("\n"));
const plan = outcome.result.plans[1];

describe("getDiagramEdges", () => {
  it("connections의 카탈로그 서비스 이름과 사용자 이름을 사용한다", () => {
    const first = plan.connections![0];
    const source = first.from === "user" ? "사용자" : plan.services.find((service) => service.componentId === first.from)!.name.ko;
    const target = first.to === "user" ? "사용자" : plan.services.find((service) => service.componentId === first.to)!.name.ko;
    expect(getDiagramEdges(plan, "ko")).toContainEqual({ from: source, to: target });
  });

  it("이전 결과는 buildMermaid가 만든 정의와 화살표에서 복원한다", () => {
    const catalog = loadCatalog();
    const connections = plan.connections!;
    const legacy: PlanResult = { ...plan, connections: undefined, mermaid: buildMermaid({ items: plan.services.map(({ componentId, quantity }) => ({ componentId, quantity })), connections }, catalog) };
    expect(getDiagramEdges(legacy, "ko")).toHaveLength(new Set(connections.map(({ from, to }) => `${from}\0${to}`)).size);
    expect(getDiagramEdges(legacy, "ko")).toEqual(getDiagramEdges(plan, "ko"));
  });

  it("중복 연결과 알 수 없는 ID를 건너뛴다", () => {
    const connections = plan.connections!;
    const edge = connections[0];
    expect(getDiagramEdges({ ...plan, connections: [edge, edge, { from: "unknown", to: edge.to }] }, "ko")).toHaveLength(1);
  });
});
