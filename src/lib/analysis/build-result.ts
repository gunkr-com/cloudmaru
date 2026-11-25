import { validateModelOutput } from "@/lib/analysis/validate-model-output";
import { calculatePlanCost } from "@/lib/cost/calculate";
import { buildMermaid } from "@/lib/diagram/build-mermaid";
import type { AnalysisInput, AnalysisResult } from "@/types/analysis";
import type { Catalog } from "@/types/catalog";

export function buildAnalysisResult(
  raw: unknown,
  input: AnalysisInput,
  catalog: Catalog,
): { ok: true; result: AnalysisResult } | { ok: false; errors: string[] } {
  const validated = validateModelOutput(raw, catalog);
  if (!validated.ok) return validated;

  const { output } = validated;
  const architectures = new Map(catalog.architectures.map((architecture) => [architecture.id, architecture]));
  const components = new Map(catalog.components.map((component) => [component.id, component]));

  return {
    ok: true,
    result: {
      region: input.region,
      currency: "CAD",
      requestTitle: output.requestTitle,
      input: { ...input },
      outOfScope: output.outOfScope,
      recommendedTier: output.recommendedTier,
      recommendationReason: output.recommendationReason,
      priceAsOf: catalog.prices.asOf,
      // 검증기가 ID의 존재를 확인하고 low, balanced, ha 순서로 정렬한 복사본이다.
      plans: output.plans.map((plan) => {
        const architecture = architectures.get(plan.referenceArchitectureId)!;
        return {
          tier: plan.tier,
          title: plan.title,
          recommended: plan.tier === output.recommendedTier,
          referenceArchitecture: {
            id: architecture.id,
            name: architecture.name,
            sources: architecture.sources.map((source) => ({ ...source })),
          },
          services: plan.items.map(({ componentId, quantity }) => {
            const component = components.get(componentId)!;
            return { componentId, name: component.name, quantity, unitLabel: component.unitLabel };
          }),
          pros: plan.pros,
          cost: calculatePlanCost(plan.items, catalog, { region: input.region, monthlyBudget: input.monthlyBudget }),
          mermaid: buildMermaid(plan, catalog),
          connections: plan.connections.map((connection) => ({ ...connection })),
        };
      }),
    },
  };
}
