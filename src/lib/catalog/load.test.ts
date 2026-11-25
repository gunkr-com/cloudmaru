import { afterEach, describe, expect, it, vi } from "vitest";
import { getArchitecture, getComponent, loadCatalog } from "@/lib/catalog/load";
import { createCatalog } from "@/lib/catalog/fixtures.test-data";
import components from "@/catalog/components.json";
import architectures from "@/catalog/reference-architectures.json";
import prices from "@/catalog/prices.json";

afterEach(() => {
  vi.doUnmock("@/catalog/components.json");
  vi.doUnmock("@/catalog/reference-architectures.json");
  vi.doUnmock("@/catalog/prices.json");
  vi.resetModules();
});

describe("loadCatalog", () => {
  it("저장소의 실제 JSON 세 파일을 정적 로드해 검증한다", () => {
    expect(loadCatalog()).toEqual({
      components,
      architectures,
      prices,
    });
  });

  it("세 지역의 모든 미터 과금 항목을 정확한 단위로 제공한다", () => {
    const catalog = loadCatalog();
    const regions = ["canadacentral", "westus2", "centralus"];
    expect(catalog.prices.regions).toEqual(regions);
    const metered = catalog.components.filter(component => component.pricing.kind === "metered");
    expect(metered).toHaveLength(29);
    expect(Object.keys(catalog.prices.prices).sort()).toEqual(metered.map(component => component.id).sort());
    for (const component of metered) {
      expect(Object.keys(catalog.prices.prices[component.id]).sort()).toEqual([...regions].sort());
      for (const region of regions) {
        if (component.pricing.kind !== "metered") throw new Error("미터 과금 항목이 필요합니다.");
        expect(catalog.prices.prices[component.id][region].unitOfMeasure).toBe(component.pricing.unitOfMeasure);
      }
    }
    expect(catalog.prices.prices["app-service-linux-b1"].canadacentral.tiers).toEqual([{ minUnits: 0, unitPrice: 0.08 }]);
    expect(catalog.prices.prices["app-service-linux-b1"].westus2.tiers).toEqual([{ minUnits: 0, unitPrice: 0.1 }]);
    expect(catalog.prices.prices["app-service-linux-b1"].centralus.tiers).toEqual([{ minUnits: 0, unitPrice: 0.12 }]);
    expect(catalog.prices.prices["log-analytics-ingestion"].canadacentral.tiers).toEqual([{ minUnits: 0, unitPrice: 0 }, { minUnits: 2, unitPrice: 2 }, { minUnits: 20, unitPrice: 1.6 }]);
  });

  it("검증 실패 시 오류 목록을 모두 담아 던진다", async () => {
    const catalog = createCatalog();
    catalog.components.push(catalog.components[0]);
    catalog.prices.prices = {};
    vi.doMock("@/catalog/components.json", () => ({ default: catalog.components }));
    vi.doMock("@/catalog/reference-architectures.json", () => ({ default: catalog.architectures }));
    vi.doMock("@/catalog/prices.json", () => ({ default: catalog.prices }));
    vi.resetModules();
    const { loadCatalog: loadInvalidCatalog } = await import("@/lib/catalog/load");
    expect(loadInvalidCatalog).toThrow(/카탈로그 검증.*\n[\s\S]*components.*중복[\s\S]*test-compute.*가격.*없/);
  });
});

describe("카탈로그 조회", () => {
  it("구성요소와 참조 아키텍처를 정확한 ID로 찾는다", () => {
    const catalog = createCatalog();
    expect(getComponent(catalog, "test-compute")).toBe(catalog.components[0]);
    expect(getArchitecture(catalog, "test-web")).toBe(catalog.architectures[0]);
  });

  it("없는 ID와 대소문자가 다른 ID는 undefined를 반환한다", () => {
    const catalog = createCatalog();
    expect(getComponent(catalog, "missing")).toBeUndefined();
    expect(getArchitecture(catalog, "missing")).toBeUndefined();
    expect(getComponent(catalog, "Test-Compute")).toBeUndefined();
    expect(getArchitecture(catalog, "Test-Web")).toBeUndefined();
  });
});

it("ships only synthetic demo prices", () => {
  const { prices } = loadCatalog().prices;
  for (const [component, regions] of Object.entries(prices)) {
    for (const [region, entry] of Object.entries(regions)) {
      expect(entry.meterId).toBe(`synthetic:${component}:${region}:1`);
    }
  }
});
