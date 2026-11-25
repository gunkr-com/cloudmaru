import type { Catalog, ReferenceArchitecture } from "@/types/catalog";

export function createMeteredComponent() {
  return {
    id: "test-compute",
    name: { en: "테스트 컴퓨팅", ko: "테스트 컴퓨팅" },
    category: "compute" as const,
    description: { en: "테스트 웹 서비스를 실행할 때 선택합니다.", ko: "테스트 웹 서비스를 실행할 때 선택합니다." },
    unitLabel: { en: "대", ko: "대" },
    bicepResourceTypes: ["Microsoft.Web/sites"],
    pricing: {
      kind: "metered" as const,
      productName: "Test Product",
      skuName: "Test SKU",
      meterName: "Test Meter",
      unitOfMeasure: "1 Hour",
      meterUnitsPerQuantity: 730,
    },
  };
}

export function createArchitecture(): ReferenceArchitecture {
  const createTier = () => ({
    title: { en: "Test single setup", ko: "테스트 단일 구성" },
    items: [{ componentId: "test-compute", quantity: 1 }],
    connections: [{ from: "user", to: "test-compute" }],
    pros: [{ en: "Simple setup.", ko: "구성이 단순합니다." }],
    cons: [{ en: "Single point of failure.", ko: "단일 장애 지점이 있습니다." }],
  });

  return {
    id: "test-web",
    name: { en: "테스트 웹 서비스", ko: "테스트 웹 서비스" },
    suitableFor: { en: "Catalog tests", ko: "웹 서비스 카탈로그 검증용" },
    sources: [
      {
        title: "참조 문서",
        url: "https://learn.microsoft.com/azure/architecture/",
      },
    ],
    tiers: {
      low: createTier(),
      balanced: createTier(),
      ha: createTier(),
    },
  };
}

export function createCatalog(): Catalog {
  return {
    components: [
      createMeteredComponent(),
      {
        id: "test-static",
        name: { en: "테스트 무료 구성요소", ko: "테스트 무료 구성요소" },
        category: "storage",
        description: { en: "무료 구성 검증용입니다.", ko: "무료 구성 검증용입니다." },
        unitLabel: { en: "개", ko: "개" },
        bicepResourceTypes: [],
        pricing: { kind: "free" },
      },
    ],
    architectures: [createArchitecture()],
    prices: {
      asOf: "2026-10-08",
      currency: "CAD",
      regions: ["canadacentral"],
      usdToCad: { rate: 1.4, pairs: 5 },
      prices: {
        "test-compute": { canadacentral: {
          meterId: "test-meter",
          unitOfMeasure: "1 Hour",
          tiers: [
            { minUnits: 0, unitPrice: 2 },
            { minUnits: 100, unitPrice: 1 },
          ],
        } },
      },
    },
  };
}
