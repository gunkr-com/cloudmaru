import supportData from "@/catalog/extension-support.json";
import { loadCatalog } from "./load";
import { ExtensionSupportError, parseExtensionSupportCatalog } from "./extension-support-schema";
import type { ExtensionSupportCatalog, ReusePolicy } from "@/types/extension-support";

/** 정적 파일만 읽는다. 실제 스캔의 재사용 조건·용량 판정은 호출자의 책임이다. */
export function loadExtensionSupportCatalog(catalog = loadCatalog()): ExtensionSupportCatalog {
  const support = parseExtensionSupportCatalog(supportData, catalog);
  // 기존 정액 플랜 참조와 달리, 사용량 구성요소의 증가분을 재사용으로 면제하지 않는다.
  const usageComponents = new Set(catalog.components
    .filter(component => component.pricing.kind === "metered" && component.usage !== undefined)
    .map(component => component.id));
  if (support.reusePolicies.some(policy => policy.additionalUsage !== "metered"
    && policy.componentIds.some(id => usageComponents.has(id)))) {
    throw new ExtensionSupportError();
  }
  return support;
}

export function getExtensionRegion(support: ExtensionSupportCatalog, regionId: string) {
  return support.regions.find(region => region.id === regionId);
}

/** unknown은 그대로 반환하고, 없는 쌍을 다른 지역이나 단가로 대체하지 않는다. */
export function getComponentRegionSupport(
  support: ExtensionSupportCatalog,
  componentId: string,
  regionId: string,
) {
  return support.components.find(component => component.componentId === componentId)
    ?.regions.find(region => region.regionId === regionId);
}

/** 정확한 타입·구성요소의 후보 정책만 찾는다. 정책 존재가 재사용 승인은 아니다. */
export function getReusePolicies(
  support: ExtensionSupportCatalog,
  resourceType: string,
  componentId: string,
): ReusePolicy[] {
  return support.reusePolicies.filter(policy => policy.resourceTypes.includes(resourceType)
    && policy.componentIds.includes(componentId));
}
