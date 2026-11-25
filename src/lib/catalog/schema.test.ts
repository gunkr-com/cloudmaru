import { describe, expect, it } from "vitest";
import {
  ALLOWED_SOURCE_HOSTS,
  USER_NODE_ID,
  componentSchema,
  priceSnapshotSchema,
  referenceArchitectureSchema,
} from "@/lib/catalog/schema";
import {
  createArchitecture,
  createCatalog,
  createMeteredComponent,
} from "@/lib/catalog/fixtures.test-data";

describe("componentSchema", () => {
  it("미터 과금과 무료 구성요소를 허용한다", () => {
    for (const component of createCatalog().components) {
      expect(componentSchema.parse(component)).toEqual(component);
    }
  });

  it("지역 무관 가격 조회 지역과 사용량 가정을 허용한다", () => {
    const component = createMeteredComponent();
    const parsed = componentSchema.parse({
      ...component,
      pricing: { ...component.pricing, priceRegion: "eastus2" },
      usage: { defaultQuantity: 0.5, assumptionLabel: { en: "{quantity} GB transfer per month", ko: "월 {quantity}GB 전송" } },
    });
    expect(parsed.pricing).toMatchObject({ priceRegion: "eastus2" });
    expect(parsed.usage?.defaultQuantity).toBe(0.5);
  });

  it.each([
    "Microsoft.Web/sites",
    "Microsoft.Web/sites/config",
    "Microsoft.DBforPostgreSQL/flexibleServers/databases",
    "Microsoft.Storage/storageAccounts/blobServices/containers",
  ])("ARM 리소스 타입 %s를 하위 타입까지 허용한다", (type) => {
    expect(componentSchema.safeParse({ ...createMeteredComponent(), bicepResourceTypes: [type] }).success).toBe(true);
  });

  it.each([
    "Web/sites",
    "Contoso.Web/sites",
    "",
    "Microsoft.Web",
    "Microsoft.Web/",
    "Microsoft.Web/sites/",
    "Microsoft.Web//sites",
    "Microsoft.Web/*",
    "Microsoft.Web/sites/*",
    "Microsoft.Web/sites@2023-12-01",
    "Microsoft.Web/sites/config@2023-12-01",
    " Microsoft.Web/sites",
    "Microsoft.Web/sites/config ",
  ])("잘못된 ARM 리소스 타입 %j를 거부한다", (type) => {
    expect(componentSchema.safeParse({ ...createMeteredComponent(), bicepResourceTypes: [type] }).success).toBe(false);
  });

  it("대소문자만 다른 중복 타입과 필드 누락을 거부한다", () => {
    const component = createMeteredComponent();
    expect(componentSchema.safeParse({ ...component, bicepResourceTypes: ["Microsoft.Web/sites", "Microsoft.Web/sites"] }).success).toBe(false);
    expect(componentSchema.safeParse({ ...component, bicepResourceTypes: ["Microsoft.Web/sites/config", "Microsoft.Web/sites/Config"] }).success).toBe(false);
    expect(componentSchema.safeParse({ ...component, bicepResourceTypes: undefined }).success).toBe(false);
  });

  it.each(["id", "name", "category", "description", "unitLabel", "pricing"])(
    "필수 필드 %s 누락을 거부한다",
    (field) => {
      expect(
        componentSchema.safeParse({ ...createMeteredComponent(), [field]: undefined }).success,
      ).toBe(false);
    },
  );

  it.each(["productName", "skuName", "meterName", "unitOfMeasure", "meterUnitsPerQuantity"])(
    "미터 과금 필드 %s 누락을 거부한다",
    (field) => {
      const component = createMeteredComponent();
      expect(componentSchema.safeParse({
        ...component,
        pricing: { ...component.pricing, [field]: undefined },
      }).success).toBe(false);
    },
  );

  it.each(["user", "", "Bad-id", "bad_id", "bad--id", "-bad", "bad-", "한글", "123"])(
    "예약어 또는 잘못된 식별자 %s를 거부한다",
    (id) => {
      expect(componentSchema.safeParse({ ...createMeteredComponent(), id }).success).toBe(false);
    },
  );

  it.each(["compute", "database", "storage", "cache", "network", "monitoring", "security"])(
    "구성요소 분류 %s를 허용한다",
    (category) => {
      expect(componentSchema.safeParse({ ...createMeteredComponent(), category }).success).toBe(true);
    },
  );

  it("정의되지 않은 분류와 과금 종류를 거부한다", () => {
    expect(componentSchema.safeParse({ ...createMeteredComponent(), category: "other" }).success).toBe(false);
    expect(componentSchema.safeParse({ ...createMeteredComponent(), pricing: { kind: "other" } }).success).toBe(false);
  });

  it("미터 단위가 수량보다 큰 경우를 위해 소수 미터 환산량을 허용한다", () => {
    const component = createMeteredComponent();
    expect(componentSchema.safeParse({
      ...component,
      pricing: { ...component.pricing, meterUnitsPerQuantity: 0.1 },
    }).success).toBe(true);
  });

  it.each([0, -1, Infinity, -Infinity, NaN, "1"])(
    "미터 환산량과 기본 수량 %s를 거부한다",
    (quantity) => {
      const component = createMeteredComponent();
      expect(componentSchema.safeParse({
        ...component,
        pricing: { ...component.pricing, meterUnitsPerQuantity: quantity },
      }).success).toBe(false);
      expect(componentSchema.safeParse({
        ...component,
        usage: { defaultQuantity: quantity, assumptionLabel: "월 {quantity}GB" },
      }).success).toBe(false);
    },
  );
});

describe("referenceArchitectureSchema", () => {
  it("세 단계의 참조 아키텍처와 사용자 연결을 허용한다", () => {
    expect(USER_NODE_ID).toBe("user");
    expect(referenceArchitectureSchema.parse(createArchitecture())).toEqual(createArchitecture());
    expect(ALLOWED_SOURCE_HOSTS).toEqual(["learn.microsoft.com", "azure.github.io", "github.com"]);
  });

  it.each([
    "https://learn.microsoft.com/ko-kr/azure/architecture/",
    "https://azure.github.io/example/",
    "https://github.com/Azure/example",
  ])("허용된 출처 %s를 통과시킨다", (url) => {
    const architecture = createArchitecture();
    architecture.sources[0].url = url;
    expect(referenceArchitectureSchema.safeParse(architecture).success).toBe(true);
  });

  it.each([
    "http://learn.microsoft.com/azure/",
    "https://example.com/",
    "https://learn.microsoft.com.evil.example/",
    "https://evil.example/learn.microsoft.com/",
    "https://learn.microsoft.com@evil.example/",
    "https://sub.azure.github.io/",
    "https://github.com/Other/example",
    "https://github.com/AzureOther/example",
    "https://github.com/azure/example",
    "https://github.com/Azure",
    "https://github.com/Azure/../Other/example",
    "not-a-url",
  ])("잘못된 출처 %s를 거부한다", (url) => {
    const architecture = createArchitecture();
    architecture.sources[0].url = url;
    expect(referenceArchitectureSchema.safeParse(architecture).success).toBe(false);
  });

  it.each(["id", "name", "suitableFor", "sources", "tiers"])(
    "필수 필드 %s 누락을 거부한다",
    (field) => {
      expect(referenceArchitectureSchema.safeParse({ ...createArchitecture(), [field]: undefined }).success).toBe(false);
    },
  );

  it.each(["low", "balanced", "ha"])("%s 단계 누락을 거부한다", (tier) => {
    const architecture = createArchitecture();
    expect(referenceArchitectureSchema.safeParse({
      ...architecture,
      tiers: { ...architecture.tiers, [tier]: undefined },
    }).success).toBe(false);
  });

  it("빈 출처 목록과 잘못된 아키텍처 식별자를 거부한다", () => {
    expect(referenceArchitectureSchema.safeParse({ ...createArchitecture(), sources: [] }).success).toBe(false);
    expect(referenceArchitectureSchema.safeParse({ ...createArchitecture(), id: "bad_id" }).success).toBe(false);
  });

  it.each([0, -1, Infinity, -Infinity, NaN, "1"])("잘못된 수량 %s를 거부한다", (quantity) => {
    const architecture = createArchitecture();
    expect(referenceArchitectureSchema.safeParse({
      ...architecture,
      tiers: {
        ...architecture.tiers,
        low: { ...architecture.tiers.low, items: [{ componentId: "test-compute", quantity }] },
      },
    }).success).toBe(false);
  });

  it("양의 소수 수량을 허용한다", () => {
    const architecture = createArchitecture();
    architecture.tiers.low.items[0].quantity = 0.5;
    expect(referenceArchitectureSchema.safeParse(architecture).success).toBe(true);
  });
});

describe("priceSnapshotSchema", () => {
  it("정상 스냅샷, 빈 스냅샷, 무료 구간을 허용한다", () => {
    const snapshot = createCatalog().prices;
    snapshot.prices["test-compute"].canadacentral.tiers[0].unitPrice = 0;
    expect(priceSnapshotSchema.parse(snapshot)).toEqual(snapshot);
    expect(priceSnapshotSchema.safeParse({ ...snapshot, prices: {} }).success).toBe(true);
  });

  it.each(["asOf", "currency", "regions", "usdToCad", "prices"])("필수 필드 %s 누락을 거부한다", (field) => {
    expect(priceSnapshotSchema.safeParse({ ...createCatalog().prices, [field]: undefined }).success).toBe(false);
  });

  it.each(["2026-02-30", "2026-13-01", "2026-1-01", "2026-10-08T00:00:00Z", "invalid"])(
    "잘못된 기준일 %s를 거부한다",
    (asOf) => {
      expect(priceSnapshotSchema.safeParse({ ...createCatalog().prices, asOf }).success).toBe(false);
    },
  );

  it("CAD 외 통화를 거부한다", () => {
    expect(priceSnapshotSchema.safeParse({ ...createCatalog().prices, currency: "USD" }).success).toBe(false);
  });

  it.each(["meterId", "unitOfMeasure", "tiers"])("가격 필드 %s 누락을 거부한다", (field) => {
    const snapshot = createCatalog().prices;
    expect(priceSnapshotSchema.safeParse({
      ...snapshot,
      prices: { "test-compute": { canadacentral: { ...snapshot.prices["test-compute"].canadacentral, [field]: undefined } } },
    }).success).toBe(false);
  });

  it.each([-1, Infinity, -Infinity, NaN, "1"])("잘못된 단가·구간 시작값 %s를 거부한다", (value) => {
    const snapshot = createCatalog().prices;
    const price = snapshot.prices["test-compute"].canadacentral;
    for (const field of ["minUnits", "unitPrice"]) {
      expect(priceSnapshotSchema.safeParse({
        ...snapshot,
        prices: { "test-compute": { canadacentral: { ...price, tiers: [{ minUnits: 0, unitPrice: 1, [field]: value }] } } },
      }).success).toBe(false);
    }
  });

  it.each([
    { tiers: [] },
    { tiers: [{ minUnits: 1, unitPrice: 1 }] },
    { tiers: [{ minUnits: 0, unitPrice: 1 }, { minUnits: 100, unitPrice: 1 }, { minUnits: 50, unitPrice: 1 }] },
    { tiers: [{ minUnits: 0, unitPrice: 1 }, { minUnits: 0, unitPrice: 1 }] },
  ])("잘못된 가격 구간 $tiers를 거부한다", ({ tiers }) => {
    const snapshot = createCatalog().prices;
    snapshot.prices["test-compute"].canadacentral.tiers = tiers;
    expect(priceSnapshotSchema.safeParse(snapshot).success).toBe(false);
  });
});

it("rejects empty or duplicate snapshot regions and invalid FX evidence", () => {
  const snapshot = createCatalog().prices;
  for (const regions of [[], ["canadacentral", "canadacentral"]]) expect(priceSnapshotSchema.safeParse({ ...snapshot, regions }).success).toBe(false);
  for (const usdToCad of [{ rate: 0, pairs: 5 }, { rate: 1.4, pairs: 4 }, { rate: Infinity, pairs: 5 }]) expect(priceSnapshotSchema.safeParse({ ...snapshot, usdToCad }).success).toBe(false);
});

it("requires strict bilingual descriptions and quantity placeholders in both assumptions", () => {
  const component = createMeteredComponent();
  expect(componentSchema.safeParse({ ...component, name: { en: "", ko: "이름" } }).success).toBe(false);
  expect(componentSchema.safeParse({ ...component, name: { en: "Name", ko: "이름", fr: "Nom" } }).success).toBe(false);
  for (const assumptionLabel of [{ en: "Usage", ko: "{quantity}개" }, { en: "{quantity} units", ko: "수량" }]) {
    expect(componentSchema.safeParse({ ...component, usage: { defaultQuantity: 1, assumptionLabel } }).success).toBe(false);
  }
  expect(componentSchema.safeParse({ ...component, name: { en: "Name", ko: "이름" } }).success).toBe(true);
});
