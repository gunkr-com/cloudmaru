import { z } from "zod";
import { USER_NODE_ID, catalogSchema, tierSchema } from "@/lib/catalog/schema";
import type { Catalog } from "@/types/catalog";

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function validateCatalog(raw: {
  components: unknown;
  architectures: unknown;
  prices: unknown;
}): { ok: true; catalog: Catalog } | { ok: false; errors: string[] } {
  const result = catalogSchema.safeParse(raw, { error: z.locales.ko().localeError });
  const errors = result.success ? [] : result.error.issues.map(
    (issue) => `${issue.path.join(".")}: ${issue.message}`,
  );

  // 형식 오류가 있어도 읽을 수 있는 참조 필드는 별도로 검사한다.
  // 예: 수량 오류 하나 때문에 다른 단계의 잘못된 연결을 숨기지 않는다.
  const components = new Map<string, Record<string, unknown>>();
  asArray(raw.components).forEach((value, index) => {
    const component = asRecord(value);
    if (typeof component.id !== "string") return;
    if (components.has(component.id)) {
      errors.push(`components.${index}.id: 구성요소 식별자 "${component.id}"가 중복되었습니다.`);
    } else {
      components.set(component.id, component);
    }
  });

  const architectureIds = new Set<string>();
  asArray(raw.architectures).forEach((value, index) => {
    const architecture = asRecord(value);
    if (typeof architecture.id === "string") {
      if (architectureIds.has(architecture.id)) {
        errors.push(`architectures.${index}.id: 참조 아키텍처 식별자 "${architecture.id}"가 중복되었습니다.`);
      }
      architectureIds.add(architecture.id);
    }

    const tiers = asRecord(architecture.tiers);
    for (const tier of tierSchema.options) {
      const plan = asRecord(tiers[tier]);
      const path = `architectures.${index}.tiers.${tier}`;
      const itemIds = new Set<string>();
      asArray(plan.items).forEach((itemValue, itemIndex) => {
        const item = asRecord(itemValue);
        if (typeof item.componentId !== "string") return;
        const itemPath = `${path}.items.${itemIndex}.componentId`;
        if (!components.has(item.componentId)) {
          errors.push(`${itemPath}: 구성요소 "${item.componentId}"가 카탈로그에 없습니다.`);
        }
        if (itemIds.has(item.componentId)) {
          errors.push(`${itemPath}: 같은 단계의 구성요소 "${item.componentId}"가 중복되었습니다.`);
        }
        itemIds.add(item.componentId);
      });

      asArray(plan.connections).forEach((connectionValue, connectionIndex) => {
        const connection = asRecord(connectionValue);
        const connectionPath = `${path}.connections.${connectionIndex}`;
        if (typeof connection.from === "string"
          && connection.from !== USER_NODE_ID && !itemIds.has(connection.from)) {
          errors.push(`${connectionPath}.from: "${connection.from}"는 같은 단계의 구성요소 또는 "${USER_NODE_ID}"여야 합니다.`);
        }
        if (typeof connection.to === "string" && !itemIds.has(connection.to)) {
          errors.push(`${connectionPath}.to: "${connection.to}"는 같은 단계의 구성요소여야 합니다.`);
        }
        if (typeof connection.from === "string" && connection.from === connection.to) {
          errors.push(`${connectionPath}: 연결의 from과 to는 같을 수 없습니다.`);
        }
      });
    }
  });

  const prices = asRecord(asRecord(raw.prices).prices);
  for (const [id, component] of components) {
    const pricing = asRecord(component.pricing);
    const hasPrice = Object.hasOwn(prices, id);
    const path = `prices.prices.${id}`;
    if (pricing.kind === "free" && hasPrice) {
      errors.push(`${path}: 무료 구성요소 "${id}"에는 가격 항목을 둘 수 없습니다.`);
    }
    if (pricing.kind !== "metered") continue;
    if (!hasPrice) {
      errors.push(`${path}: 미터 과금 구성요소 "${id}"의 가격 항목이 없습니다.`);
      continue;
    }
    const regionalPrices = asRecord(prices[id]);
    const regions = asArray(asRecord(raw.prices).regions);
    for (const region of regions) {
      if (typeof region !== "string") continue;
      const price = asRecord(regionalPrices[region]);
      if (!Object.hasOwn(regionalPrices, region)) {
        errors.push(`${path}.${region}: 지역 가격이 없습니다.`);
      } else if (typeof price.unitOfMeasure === "string" && price.unitOfMeasure !== pricing.unitOfMeasure) {
        errors.push(`${path}.${region}.unitOfMeasure: 구성요소의 unitOfMeasure와 가격 스냅샷이 일치하지 않습니다.`);
      }
    }
    for (const region of Object.keys(regionalPrices)) {
      if (!regions.includes(region)) errors.push(`${path}.${region}: 스냅샷 지역 목록에 없습니다.`);
    }
  }

  for (const id of Object.keys(prices)) {
    if (!components.has(id)) {
      errors.push(`prices.prices.${id}: 구성요소 "${id}"가 카탈로그에 없습니다.`);
    }
  }

  if (result.success) for (const [ai, architecture] of result.data.architectures.entries()) for (const tier of tierSchema.options) {
    const selected = architecture.tiers[tier], intent = selected.deploymentIntent;
    if (!intent) continue; // Historical snapshots retain absent metadata exactly.
    const path = `architectures.${ai}.tiers.${tier}.deploymentIntent`;
    const member = (id: string) => selected.items.some(i => i.componentId === id);
    const mapping = (id: string) => result.data.components.find(c => c.id === id)?.extensionDeployment;
    for (const [bi, binding] of intent.bindings.entries()) {
      const from = mapping(binding.fromComponentId), to = mapping(binding.toComponentId);
      const edge = selected.connections.some(c => c.from === binding.fromComponentId && c.to === binding.toComponentId
        || binding.role === "gateway-public-ip" && c.to === binding.fromComponentId && c.from === binding.toComponentId);
      const roles = binding.role === "gateway-public-ip" ? from?.kind === "application-gateway" && from.role === "fixed" && to?.kind === "public-ip"
        : binding.role === "gateway-backend" ? from?.kind === "application-gateway" && from.role === "fixed" && to?.kind === "app-service-plan"
        : binding.role === "function-storage" ? from?.kind === "functions" && from.role !== "duration" && to?.kind === "blob-storage"
        : from?.kind === "static-web-app" && from.linkedBackendAllowed && to?.kind === "functions" && to.role !== "duration";
      if (!member(binding.fromComponentId) || !member(binding.toComponentId) || !edge || !roles)
        errors.push(`${path}.bindings.${bi}: invalid-reference-deployment-binding`);
    }
    for (const [ni, network] of intent.networkRequirements.entries()) {
      const from = mapping(network.componentId);
      const valid = network.role === "gateway-subnet" ? from?.kind === "application-gateway" && from.role === "fixed"
        && network.delegation === "none" && network.maximumPrefixLength === 24
        : from?.kind === "container-apps" && from.role === "cpu" && intent.containerApps?.subnetRequired
          && network.delegation === "Microsoft.App/environments" && network.maximumPrefixLength === 27;
      if (!member(network.componentId) || !valid) errors.push(`${path}.networkRequirements.${ni}: invalid-reference-network-role`);
    }
    if (intent.containerApps?.subnetRequired && !intent.networkRequirements.some(n => n.role === "container-environment-subnet"))
      errors.push(`${path}.networkRequirements: missing-container-subnet-requirement`);
  }

  if (!result.success || errors.length > 0) return { ok: false, errors };
  return { ok: true, catalog: result.data };
}
