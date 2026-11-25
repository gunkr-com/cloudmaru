import { z } from "zod";
import { modelOutputSchema } from "@/lib/analysis/model-output-schema";
import { USER_NODE_ID, tierSchema } from "@/lib/catalog/schema";
import type { ModelOutput } from "@/types/analysis";
import type { Catalog } from "@/types/catalog";

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function validateModelOutput(
  raw: unknown,
  catalog: Catalog,
): { ok: true; output: ModelOutput } | { ok: false; errors: string[] } {
  const result = modelOutputSchema.safeParse(raw, { error: z.locales.ko().localeError });
  const errors = result.success ? [] : result.error.issues.map(
    (issue) => `${issue.path.join(".")}: ${issue.message}`,
  );
  const components = new Map(catalog.components.map((component) => [component.id, component]));
  const architectureIds = new Set(catalog.architectures.map((architecture) => architecture.id));

  function checkText(value: unknown, path: string): void {
    const text = asRecord(value);
    for (const locale of ["en", "ko"] as const) {
      if (typeof text[locale] === "string" && /https?:\/\/|www\./i.test(text[locale])) {
        errors.push(`${path}.${locale}: 모델이 작성한 글에는 URL을 포함할 수 없습니다.`);
      }
    }
  }

  // 형식 오류가 있어도 읽을 수 있는 필드의 위반을 모두 수집한다.
  const output = asRecord(raw);
  checkText(output.requestTitle, "requestTitle");
  checkText(output.recommendationReason, "recommendationReason");
  const plans = asArray(output.plans).map(asRecord);
  if (Array.isArray(output.plans)) {
    for (const tier of tierSchema.options) {
      if (plans.filter((plan) => plan.tier === tier).length !== 1) {
        errors.push(`plans: "${tier}" 단계는 정확히 한 번 있어야 합니다.`);
      }
    }
  }

  plans.forEach((plan, index) => {
    const path = `plans.${index}`;
    if (typeof plan.referenceArchitectureId === "string"
      && !architectureIds.has(plan.referenceArchitectureId)) {
      errors.push(`${path}.referenceArchitectureId: 참조 아키텍처 "${plan.referenceArchitectureId}"가 카탈로그에 없습니다.`);
    }
    checkText(plan.title, `${path}.title`);
    asArray(plan.pros).forEach((pro, proIndex) => checkText(pro, `${path}.pros.${proIndex}`));

    const itemIds = new Set<string>();
    let hasCompute = false;
    asArray(plan.items).forEach((value, itemIndex) => {
      const item = asRecord(value);
      if (typeof item.componentId !== "string") return;
      const itemPath = `${path}.items.${itemIndex}.componentId`;
      const component = components.get(item.componentId);
      if (!component) {
        errors.push(`${itemPath}: 구성요소 "${item.componentId}"가 카탈로그에 없습니다.`);
      }
      if (itemIds.has(item.componentId)) {
        errors.push(`${itemPath}: 같은 안의 구성요소 "${item.componentId}"가 중복되었습니다.`);
      }
      itemIds.add(item.componentId);
      if (component?.category === "compute") hasCompute = true;
    });
    if (!hasCompute) {
      errors.push(`${path}.items: 컴퓨트(compute) 구성요소가 하나 이상 필요합니다.`);
    }

    asArray(plan.connections).forEach((value, connectionIndex) => {
      const connection = asRecord(value);
      const connectionPath = `${path}.connections.${connectionIndex}`;
      if (typeof connection.from === "string"
        && connection.from !== USER_NODE_ID && !itemIds.has(connection.from)) {
        errors.push(`${connectionPath}.from: 출발점은 같은 안의 구성요소 또는 "${USER_NODE_ID}"여야 합니다.`);
      }
      if (typeof connection.to === "string" && !itemIds.has(connection.to)) {
        errors.push(`${connectionPath}.to: 도착점은 같은 안의 구성요소여야 합니다.`);
      }
      if (typeof connection.from === "string" && connection.from === connection.to) {
        errors.push(`${connectionPath}: 연결의 from과 to는 같을 수 없습니다.`);
      }
    });
  });

  if (!result.success || errors.length > 0) return { ok: false, errors };

  // 검증된 복사본에만 허용된 정규화를 적용한다. 오류가 있는 출력은 고치지 않는다.
  result.data.plans.sort((left, right) => (
    tierSchema.options.indexOf(left.tier) - tierSchema.options.indexOf(right.tier)
  ));
  for (const plan of result.data.plans) {
    const seen = new Set<string>();
    plan.connections = plan.connections.filter(({ from, to }) => {
      const key = JSON.stringify([from, to]);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  return { ok: true, output: result.data };
}
