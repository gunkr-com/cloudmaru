import { formatCostNote } from "@/lib/cost/format";
import { describe, expect, it } from "vitest";
import { loadCatalog } from "@/lib/catalog/load";
import { tierSchema, USER_NODE_ID } from "@/lib/catalog/schema";
import { calculatePlanCost } from "@/lib/cost/calculate";
import { COMMON_BICEP_RESOURCE_TYPES } from "@/lib/artifacts/resource-types";

describe("실제 구성요소 카탈로그", () => {
  it("실제 카탈로그와 가격 스냅샷의 스키마 및 참조 검증을 통과한다", () => {
    expect(() => loadCatalog()).not.toThrow();
  });

  it("웹앱·API와 데이터베이스 구성요소를 20개 이상 제공한다", () => {
    expect(loadCatalog().components.length).toBeGreaterThanOrEqual(20);
  });

  it.each(["compute", "database", "storage", "network"] as const)(
    "%s 분류에 구성요소가 하나 이상 있다",
    (category) => {
      expect(loadCatalog().components.some((component) => component.category === category)).toBe(true);
    },
  );

  it("모든 미터 과금 구성요소에 0보다 큰 단가 구간이 있다", () => {
    const { components, prices } = loadCatalog();
    const metered = components.filter((component) => component.pricing.kind === "metered");
    expect(metered.length).toBeGreaterThan(0);
    for (const component of metered) {
      expect(
        prices.prices[component.id].canadacentral.tiers.some((tier) => tier.unitPrice > 0),
        component.id,
      ).toBe(true);
    }
  });

  it("모든 구성요소에 Bicep 리소스 타입이 있고 인터넷 송신만 빈 목록이다", () => {
    const components = loadCatalog().components;
    for (const component of components) expect(Array.isArray(component.bicepResourceTypes), component.id).toBe(true);
    expect(components.filter((component) => component.bicepResourceTypes.length === 0).map(({ id }) => id))
      .toEqual(["internet-egress"]);
  });

  it("하위 리소스 타입은 같은 구성요소나 공통 타입에 바로 위 상위 타입이 있을 때만 등록한다", () => {
    const common = new Set(COMMON_BICEP_RESOURCE_TYPES.map((type) => type.toLowerCase()));
    let childCount = 0;
    for (const component of loadCatalog().components) {
      const own = new Set(component.bicepResourceTypes.map((type) => type.toLowerCase()));
      for (const type of component.bicepResourceTypes) {
        const segments = type.split("/");
        if (segments.length <= 2) continue;
        childCount += 1;
        const parent = segments.slice(0, -1).join("/").toLowerCase();
        expect(own.has(parent) || common.has(parent), `${component.id}: ${type}`).toBe(true);
      }
    }
    expect(childCount).toBeGreaterThan(0);
  });

  it.each([
    ["app-service-linux-p0v3", ["Microsoft.Web/serverfarms", "Microsoft.Web/sites", "Microsoft.Web/sites/config"]],
    ["functions-consumption-executions", ["Microsoft.Web/serverfarms", "Microsoft.Web/sites", "Microsoft.Web/sites/config", "Microsoft.Storage/storageAccounts"]],
    ["container-apps-vcpu", ["Microsoft.App/managedEnvironments", "Microsoft.App/containerApps"]],
    ["static-web-apps-standard", ["Microsoft.Web/staticSites", "Microsoft.Web/staticSites/linkedBackends"]],
    ["static-web-apps-free", ["Microsoft.Web/staticSites"]],
    ["postgres-flex-b1ms", [
      "Microsoft.DBforPostgreSQL/flexibleServers",
      "Microsoft.DBforPostgreSQL/flexibleServers/databases",
      "Microsoft.DBforPostgreSQL/flexibleServers/firewallRules",
      "Microsoft.DBforPostgreSQL/flexibleServers/configurations",
    ]],
    ["cosmos-db-serverless-ru", [
      "Microsoft.DocumentDB/databaseAccounts",
      "Microsoft.DocumentDB/databaseAccounts/sqlDatabases",
      "Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers",
    ]],
    ["blob-hot-lrs", [
      "Microsoft.Storage/storageAccounts",
      "Microsoft.Storage/storageAccounts/blobServices",
      "Microsoft.Storage/storageAccounts/blobServices/containers",
    ]],
    ["managed-redis-b0", ["Microsoft.Cache/redisEnterprise", "Microsoft.Cache/redisEnterprise/databases"]],
    ["managed-redis-b1", ["Microsoft.Cache/redisEnterprise", "Microsoft.Cache/redisEnterprise/databases"]],
    ["front-door-standard-base", [
      "Microsoft.Cdn/profiles",
      "Microsoft.Cdn/profiles/afdEndpoints",
      "Microsoft.Cdn/profiles/afdEndpoints/routes",
      "Microsoft.Cdn/profiles/originGroups",
      "Microsoft.Cdn/profiles/originGroups/origins",
    ]],
    ["application-gateway-v2-fixed", ["Microsoft.Network/applicationGateways"]],
    ["public-ipv4-standard", ["Microsoft.Network/publicIPAddresses"]],
    ["log-analytics-ingestion", ["Microsoft.OperationalInsights/workspaces", "Microsoft.Insights/components"]],
    ["key-vault-operations", ["Microsoft.KeyVault/vaults", "Microsoft.KeyVault/vaults/secrets"]],
  ])("%s는 비용 없는 하위 타입까지 Bicep 리소스 타입을 명시한다", (id, expected) => {
    expect(loadCatalog().components.find((component) => component.id === id)?.bicepResourceTypes).toEqual(expected);
  });

  it("별도 과금이 생기는 하위 리소스 타입은 어느 구성요소에도 등록하지 않는다", () => {
    const listed = [...COMMON_BICEP_RESOURCE_TYPES, ...loadCatalog().components.flatMap(({ bicepResourceTypes }) => bicepResourceTypes)]
      .map((type) => type.toLowerCase());
    for (const type of [
      "Microsoft.DBforPostgreSQL/flexibleServers/advancedThreatProtectionSettings",
      "Microsoft.Network/virtualNetworks/virtualNetworkPeerings",
      "Microsoft.Web/sites/slots",
      "Microsoft.Cdn/profiles/securityPolicies",
      "Microsoft.KeyVault/vaults/keys",
    ]) expect(listed, type).not.toContain(type.toLowerCase());
  });

  it.each([
    ["app-service-linux-b1", "app-service-linux-b2", "app-service-linux-p0v3", "app-service-linux-p1v3", "app-service-linux-p2v3"],
    ["functions-consumption-executions", "functions-consumption-duration", "functions-dedicated-p1v3"],
    ["container-apps-vcpu", "container-apps-memory", "container-apps-requests"],
    ["postgres-flex-b1ms", "postgres-flex-b2s", "postgres-flex-gp-2vcore", "postgres-flex-gp-4vcore", "postgres-flex-storage"],
    ["blob-hot-lrs", "blob-hot-zrs"],
    ["application-gateway-v2-fixed", "application-gateway-v2-capacity"],
  ])("같은 리소스를 산정하는 구성요소의 타입이 같다: %s", (...ids) => {
    const components = loadCatalog().components;
    const expected = components.find(({ id }) => id === ids[0])!.bicepResourceTypes;
    for (const id of ids) expect(components.find((item) => item.id === id)!.bicepResourceTypes).toEqual(expected);
  });

  it("시간 단위 미터는 월 730시간으로 환산한다", () => {
    const hourly = loadCatalog().components.filter(
      (component) => component.pricing.kind === "metered"
        && ["1 Hour", "1/Hour"].includes(component.pricing.unitOfMeasure),
    );
    expect(hourly.length).toBeGreaterThan(0);
    for (const component of hourly) {
      if (component.pricing.kind !== "metered") continue;
      expect(component.pricing.meterUnitsPerQuantity, component.id).toBe(730);
    }
  });

  it("Container Apps의 상시 실행 수량은 월 730시간을 초로 환산한다", () => {
    const components = loadCatalog().components.filter(
      (component) => component.category === "compute"
        && component.pricing.kind === "metered" && component.pricing.productName === "Azure Container Apps",
    );
    expect(components.length).toBeGreaterThan(0);
    for (const component of components) {
      if (component.pricing.kind !== "metered") continue;
      expect(component.pricing.unitOfMeasure, component.id).toMatch(/^1 (GiB )?Second$/);
      expect(component.pricing.meterUnitsPerQuantity, component.id).toBe(730 * 3600);
    }
  });

  it("Container Apps의 요청 미터는 실행 시간이 아닌 백만 건 단위로 산정한다", () => {
    const component = loadCatalog().components.find(({ id }) => id === "container-apps-requests");
    expect(component?.pricing).toMatchObject({
      kind: "metered", productName: "Azure Container Apps", meterName: "Standard Requests",
      unitOfMeasure: "1M", meterUnitsPerQuantity: 1,
    });
    expect(component?.usage?.assumptionLabel.ko).toContain("무료량 차감 후");
  });

  it("Functions 실행 횟수는 10회 묶음 미터를 1회 단위로 산정한다", () => {
    const component = loadCatalog().components.find(({ id }) => id === "functions-consumption-executions");
    expect(component).toMatchObject({
      unitLabel: { en: "execution(s)", ko: "회" },
      pricing: { kind: "metered", unitOfMeasure: "10", meterUnitsPerQuantity: 0.1 },
      usage: { defaultQuantity: 1000000, assumptionLabel: { en: "{quantity} executions per month", ko: "월 {quantity}회 실행" } },
    });
  });

  it.each([
    [1000000, 100000],
    [5000000, 500000],
    [12345670, 1234567],
  ])("Functions 실행 %s회는 예전 10회 묶음 %s개와 같은 비용이다", (executions, bundles) => {
    const catalog = loadCatalog();
    // 예전 정의: 단위 "10회", 수량 1이 미터 1단위(10회)였다.
    const legacy = structuredClone(catalog);
    const component = legacy.components.find(({ id }) => id === "functions-consumption-executions")!;
    if (component.pricing.kind !== "metered") throw new Error("테스트 구성 오류");
    component.unitLabel = { en: "10 executions", ko: "10회" };
    component.pricing.meterUnitsPerQuantity = 1;
    component.usage = { defaultQuantity: 100000, assumptionLabel: { en: "{quantity} bundles per month (10 executions per bundle)", ko: "월 {quantity}묶음 실행 (묶음당 10회)" } };

    const current = calculatePlanCost([{ componentId: "functions-consumption-executions", quantity: executions }], catalog, { region: "canadacentral" });
    const before = calculatePlanCost([{ componentId: "functions-consumption-executions", quantity: bundles }], legacy, { region: "canadacentral" });
    expect(current.total).toBe(before.total);
    expect(formatCostNote(current.lines[0], "ko")).toBe(`가정: 월 ${executions.toLocaleString("ko-KR")}회 실행`);
  });

  it("Functions 합성 가격의 무료 실행량을 넘은 사용량만 과금한다", () => {
    const catalog = loadCatalog();
    const price = catalog.prices.prices["functions-consumption-executions"].canadacentral;
    // 미터 단위는 10회이므로 무료 구간 경계(minUnits)의 10배가 무료 실행 횟수다.
    expect(price.tiers[0]).toEqual({ minUnits: 0, unitPrice: 0 });
    const freeExecutions = price.tiers[1].minUnits * 10;
    expect(freeExecutions).toBe(150000);
    const cost = (quantity: number) =>
      calculatePlanCost([{ componentId: "functions-consumption-executions", quantity }], catalog, { region: "canadacentral" }).total;
    expect(cost(freeExecutions)).toBe(0);
    expect(cost(freeExecutions + 4000000)).toBe(Math.round(400000 * price.tiers[1].unitPrice * 100) / 100);
  });

  it("인터넷 송신은 Microsoft 기본 라우팅 미터를 사용한다", () => {
    const component = loadCatalog().components.find(({ id }) => id === "internet-egress");
    expect(component?.pricing).toMatchObject({
      kind: "metered",
      productName: "Rtn Preference: MGN",
      meterName: "Standard Data Transfer Out",
      unitOfMeasure: "1 GB",
      meterUnitsPerQuantity: 1,
    });
  });

  it("사용량 가정은 수량을 치환할 수 있는 한국어 문구를 제공한다", () => {
    const usageBased = loadCatalog().components.filter((component) => component.usage);
    expect(usageBased.length).toBeGreaterThan(0);
    for (const component of usageBased) {
      expect(component.usage!.assumptionLabel.ko, component.id).toContain("{quantity}");
      expect(component.usage!.assumptionLabel.ko, component.id).toMatch(/[가-힣]/);
    }
  });

  it("Spot·Low Priority·개발 테스트 미터를 사용하지 않는다", () => {
    for (const { id, pricing } of loadCatalog().components) {
      if (pricing.kind !== "metered") continue;
      expect(`${pricing.productName} ${pricing.skuName} ${pricing.meterName}`, id)
        .not.toMatch(/spot|low priority|devtest|dev\/test/i);
    }
  });
});

describe("실제 참조 아키텍처 카탈로그", () => {
  it("모든 참조 아키텍처의 월 비용은 low ≤ balanced ≤ ha 순서다", () => {
    const catalog = loadCatalog();
    for (const { id, tiers } of catalog.architectures) {
      const low = calculatePlanCost(tiers.low.items, catalog, { region: "canadacentral" }).total;
      const balanced = calculatePlanCost(tiers.balanced.items, catalog, { region: "canadacentral" }).total;
      const ha = calculatePlanCost(tiers.ha.items, catalog, { region: "canadacentral" }).total;
      expect(low, `${id}: low ≤ balanced`).toBeLessThanOrEqual(balanced);
      expect(balanced, `${id}: balanced ≤ ha`).toBeLessThanOrEqual(ha);
    }
  });

  it("웹앱·API와 데이터베이스 참조 아키텍처를 4개 이상 제공한다", () => {
    expect(loadCatalog().architectures.length).toBeGreaterThanOrEqual(4);
  });

  it("모든 참조 아키텍처에 출처가 하나 이상 있다", () => {
    for (const architecture of loadCatalog().architectures) {
      expect(architecture.sources.length, architecture.id).toBeGreaterThanOrEqual(1);
    }
  });

  it.each(tierSchema.options)("모든 %s 단계에 컴퓨트를 포함한 구성요소가 두 개 이상 있다", (tier) => {
    const { architectures, components } = loadCatalog();
    const computeIds = new Set(components.filter(({ category }) => category === "compute").map(({ id }) => id));
    for (const architecture of architectures) {
      const { items } = architecture.tiers[tier];
      expect(items.length, architecture.id).toBeGreaterThanOrEqual(2);
      expect(items.some(({ componentId }) => computeIds.has(componentId)), architecture.id).toBe(true);
    }
  });

  it.each(tierSchema.options)("모든 %s 단계에 한국어 장단점을 각각 1~3개 제공한다", (tier) => {
    for (const architecture of loadCatalog().architectures) {
      for (const entries of [architecture.tiers[tier].pros, architecture.tiers[tier].cons]) {
        expect(entries.length, architecture.id).toBeGreaterThanOrEqual(1);
        expect(entries.length, architecture.id).toBeLessThanOrEqual(3);
        for (const entry of entries) expect(entry.ko, architecture.id).toMatch(/[가-힣]/);
      }
    }
  });

  it.each(tierSchema.options)("모든 %s 단계에 사용자에서 시작하는 요청 흐름이 있다", (tier) => {
    for (const architecture of loadCatalog().architectures) {
      expect(architecture.tiers[tier].connections.some(({ from }) => from === USER_NODE_ID), architecture.id).toBe(true);
    }
  });

  it.each(tierSchema.options)("모든 %s 단계에 기본 사용량의 인터넷 송신을 포함한다", (tier) => {
    const { architectures, components } = loadCatalog();
    const egress = components.find(({ id }) => id === "internet-egress")!;
    for (const architecture of architectures) {
      expect(architecture.tiers[tier].items, architecture.id).toContainEqual({
        componentId: egress.id, quantity: egress.usage!.defaultQuantity,
      });
    }
  });

  it("loadCatalog가 참조 아키텍처의 구성요소·연결·가격 상호 참조를 검증한다", () => {
    expect(() => loadCatalog()).not.toThrow();
  });

  it("고가용성 단계의 PostgreSQL은 범용 주·대기 서버와 두 서버의 저장소를 산정한다", () => {
    const { architectures, components } = loadCatalog();
    const storage = components.find(({ id }) => id === "postgres-flex-storage")!;
    for (const architecture of architectures) {
      const { items } = architecture.tiers.ha;
      expect(items.some(({ componentId }) => componentId.startsWith("postgres-flex-b")), architecture.id).toBe(false);
      expect(items.filter(({ componentId }) => componentId.startsWith("postgres-flex-gp-")), architecture.id)
        .toEqual([expect.objectContaining({ quantity: 2 })]);
      expect(items, architecture.id).toContainEqual({ componentId: storage.id, quantity: storage.usage!.defaultQuantity * 2 });
      expect(items, architecture.id).toContainEqual({ componentId: "blob-hot-zrs", quantity: 50 });
    }
  });

  it("Container Apps의 복제본 수에 맞춰 CPU·메모리를 함께 산정하고 요청 미터도 포함한다", () => {
    const { architectures, components } = loadCatalog();
    const architecture = architectures.find(({ id }) => id === "container-apps-web-api");
    expect(architecture).toBeDefined();
    const cpu = components.find(({ id }) => id === "container-apps-vcpu")!;
    const memory = components.find(({ id }) => id === "container-apps-memory")!;
    for (const [tier, replicas] of [["low", 1], ["balanced", 2], ["ha", 3]] as const) {
      const items = architecture!.tiers[tier].items;
      expect(items).toContainEqual({ componentId: cpu.id, quantity: cpu.usage!.defaultQuantity * replicas });
      expect(items).toContainEqual({ componentId: memory.id, quantity: memory.usage!.defaultQuantity * replicas });
      expect(items.some(({ componentId }) => componentId === "container-apps-requests")).toBe(true);
    }
  });

  it("게이트웨이를 사용하는 단계는 공인 IP와 최소 인스턴스 수에 맞는 용량 요금을 포함한다", () => {
    const architecture = loadCatalog().architectures.find(({ id }) => id === "app-service-zone-redundant");
    expect(architecture).toBeDefined();
    for (const [tier, instances] of [["low", 1], ["balanced", 2], ["ha", 3]] as const) {
      const items = architecture!.tiers[tier].items;
      expect(items).toContainEqual({ componentId: "application-gateway-v2-fixed", quantity: 1 });
      expect(items).toContainEqual({ componentId: "application-gateway-v2-capacity", quantity: instances * 10 });
      expect(items).toContainEqual({ componentId: "public-ipv4-standard", quantity: 1 });
    }
  });

  it("서버리스 구성은 Standard 정적 앱에 지역을 지정한 Functions API를 연결한다", () => {
    const { architectures, components } = loadCatalog();
    const architecture = architectures.find(({ id }) => id === "serverless-static-web-app");
    expect(architecture).toBeDefined();
    for (const tier of tierSchema.options) {
      const plan = architecture!.tiers[tier];
      expect(plan.items).toContainEqual({ componentId: "static-web-apps-standard", quantity: 1 });
      const apiId = tier === "ha" ? "functions-dedicated-p1v3" : "functions-consumption-executions";
      expect(plan.connections).toContainEqual({ from: "static-web-apps-standard", to: apiId });
      if (tier !== "ha") {
        for (const id of ["functions-consumption-executions", "functions-consumption-duration"]) {
          const component = components.find((entry) => entry.id === id)!;
          expect(plan.items).toContainEqual({ componentId: id, quantity: component.usage!.defaultQuantity });
        }
      }
    }
  });

  it("서버리스 고가용성은 영역 중복 전용 계획 2대와 ZRS를 사용하며 소비형 요금을 중복 산정하지 않는다", () => {
    const { architectures, components } = loadCatalog();
    const architecture = architectures.find(({ id }) => id === "serverless-static-web-app");
    expect(architecture).toBeDefined();
    const { items, cons } = architecture!.tiers.ha;
    expect(items).toContainEqual({ componentId: "functions-dedicated-p1v3", quantity: 2 });
    expect(items).toContainEqual({ componentId: "blob-hot-zrs", quantity: 50 });
    expect(items.some(({ componentId }) => componentId.startsWith("functions-consumption-"))).toBe(false);
    expect(items.some(({ componentId }) => componentId.startsWith("app-service-linux-"))).toBe(false);
    expect(cons.map(text => text.ko).join(" ")).toContain("상시 요금");
    expect(components.find(({ id }) => id === "functions-dedicated-p1v3")?.pricing)
      .toEqual(components.find(({ id }) => id === "app-service-linux-p1v3")?.pricing);
  });
});

it("snapshot regions match supported regions and demo prices are independent of USD conversions", async () => {
  const { SUPPORTED_REGIONS } = await import("@/lib/workspace/regions");
  const { prices } = loadCatalog();
  expect(prices.regions).toEqual(SUPPORTED_REGIONS.map(region => region.id));
  const converted = Object.entries(prices.prices).filter(([, regions]) => Object.values(regions).some(price => price.tiers.some(tier => tier.convertedFromUsd))).map(([id]) => id).sort();
  expect(converted).toEqual([]);
});

it("all catalog descriptions contain English and Korean, except explicit names and units", () => {
  const properNames = new Set([
    "app-service-linux-b1", "app-service-linux-b2", "app-service-linux-p0v3", "app-service-linux-p1v3", "app-service-linux-p2v3",
    "static-web-apps-standard", "static-web-apps-free", "postgres-flex-b1ms", "postgres-flex-b2s", "managed-redis-b0", "managed-redis-b1",
  ]);
  const latinUnits = new Set(["postgres-flex-storage", "blob-hot-lrs", "blob-hot-zrs", "internet-egress", "log-analytics-ingestion"]);
  const check = (text: { en: string; ko: string }, exception = false) => {
    expect(text.en.trim()).not.toBe("");
    expect(text.en).not.toMatch(/[가-힣ㄱ-ㅎㅏ-ㅣ]/);
    expect(text.ko.trim()).not.toBe("");
    if (!exception) expect(text.ko).toMatch(/[가-힣]/);
  };
  const catalog = loadCatalog();
  for (const component of catalog.components) {
    check(component.name, properNames.has(component.id));
    check(component.description);
    check(component.unitLabel, latinUnits.has(component.id));
    if (properNames.has(component.id)) expect(component.name.en).toBe(component.name.ko);
    if (component.usage) {
      check(component.usage.assumptionLabel);
      for (const locale of ["en", "ko"] as const) expect(component.usage.assumptionLabel[locale]).toContain("{quantity}");
    }
  }
  for (const architecture of catalog.architectures) {
    check(architecture.name);
    check(architecture.suitableFor);
    for (const tier of Object.values(architecture.tiers)) {
      check(tier.title);
      for (const text of [...tier.pros, ...tier.cons]) check(text);
    }
  }
});

it("catalog copy is region neutral", () => {
  const { components, architectures } = loadCatalog();
  expect(JSON.stringify({ components, architectures })).not.toMatch(/Korea|한국|koreacentral/i);
});
