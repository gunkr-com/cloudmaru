import type { PlanResult } from "@/types/analysis";
import type { Catalog } from "@/types/catalog";

// 비용이 없는 보조 리소스. 어느 안에서든 Bicep에 쓸 수 있다.
// 하위 타입도 상위 타입에 딸려 허용되지 않으므로 필요한 것만 전체 이름으로 적는다(피어링처럼 과금되는 하위 타입 제외).
export const COMMON_BICEP_RESOURCE_TYPES: readonly string[] = [
  "Microsoft.ManagedIdentity/userAssignedIdentities",
  "Microsoft.Authorization/roleAssignments",
  "Microsoft.Insights/diagnosticSettings",
  "Microsoft.Network/virtualNetworks",
  "Microsoft.Network/virtualNetworks/subnets",
];

export function allowedResourceTypes(
  plan: Pick<PlanResult, "services">,
  catalog: Catalog,
): string[] {
  const types = new Set<string>(COMMON_BICEP_RESOURCE_TYPES);
  for (const service of plan.services) {
    const component = catalog.components.find(({ id }) => id === service.componentId);
    if (!component) {
      throw new Error(`카탈로그에 구성요소 '${service.componentId}'이(가) 없습니다.`);
    }
    for (const type of component.bicepResourceTypes) types.add(type);
  }
  return [...types].sort();
}

// 목록의 타입과 정확히 같을 때만 허용한다(ARM 타입은 대소문자를 구분하지 않는다).
// 상위 타입이 허용돼도 하위 타입은 목록에 따로 있어야 한다. 과금 하위 리소스가 견적 밖으로 들어가지 않게 한다.
export function isResourceTypeAllowed(type: string, allowed: readonly string[]): boolean {
  const normalizedType = type.toLowerCase();
  return allowed.some((allowedType) => allowedType.toLowerCase() === normalizedType);
}
