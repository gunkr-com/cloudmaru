// 카탈로그의 모든 미터 과금 항목에 가격 근거가 있는 지역이다. 구독 용량을 보장하지 않는다.
export const DEFAULT_REGION = "canadacentral";
export const SUPPORTED_REGIONS: readonly { id: string; label: string }[] = [
  { id: DEFAULT_REGION, label: "Canada Central" },
  { id: "westus2", label: "West US 2" },
  { id: "centralus", label: "Central US" },
];
export function isSupportedRegion(id: string): boolean {
  return SUPPORTED_REGIONS.some(region => region.id === id);
}

// Static Web Apps는 Canada 지역에 배포할 수 없다. 지원 지역 eastus2는 카탈로그 priceRegion과 같다.
export const STATIC_WEB_APPS_LOCATION = "eastus2";
export function regionLabel(id: string): string {
  return SUPPORTED_REGIONS.find(region => region.id === id)?.label ?? id;
}
