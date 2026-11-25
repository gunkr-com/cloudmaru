// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import rawSupport from "@/catalog/extension-support.json";
import { loadCatalog } from "./load";
import {
  getComponentRegionSupport,
  getExtensionRegion,
  getReusePolicies,
  loadExtensionSupportCatalog,
} from "./extension-support";
import { calculatePlanCost } from "@/lib/cost/calculate";
import { SUPPORTED_REGIONS } from "@/lib/workspace/regions";
import type { ExtensionSupportCatalog } from "@/types/extension-support";

// Reset before the first test too: dynamic imports must observe each test's mocks.
beforeEach(() => vi.resetModules());
afterEach(() => {
  vi.doUnmock("@/catalog/extension-support.json");
  vi.doUnmock("./load");
  vi.unstubAllGlobals();
});

async function loadChangedSupport(change: (data: ExtensionSupportCatalog) => void) {
  const data = loadExtensionSupportCatalog();
  change(data);
  vi.doMock("@/catalog/extension-support.json", () => ({ default: data }));
  const supportModule = await import("./extension-support");
  return supportModule.loadExtensionSupportCatalog;
}

describe("loadExtensionSupportCatalog", () => {
  it("정적 JSON을 실제 카탈로그와 검증하고 버전·지역·모든 쌍을 보존한다", () => {
    const fetch = vi.fn(() => { throw new Error("네트워크 호출 금지"); });
    vi.stubGlobal("fetch", fetch);
    const support = loadExtensionSupportCatalog();
    const catalog = loadCatalog();
    expect(support).toEqual(rawSupport);
    expect(support.schemaVersion).toBe(1);
    expect(support.version).toBe("2026-11-12-v1");
    expect(support.verifiedAt).toBe("2026-11-12T07:08:27Z");
    expect(catalog.prices.asOf).toBe("2026-01-15");
    expect(support.regions.map(r => ({ id: r.id, label: r.label.en }))).toEqual(SUPPORTED_REGIONS);
    expect(support.components.map(c => c.componentId).sort()).toEqual(catalog.components.map(c => c.id).sort());
    expect(support.components).toHaveLength(32);
    expect(support.components.flatMap(c => c.regions)).toHaveLength(96);
    expect(support.components.flatMap(c => c.regions).filter(r => r.status === "supported")).toHaveLength(90);
    expect(support.reusePolicies).toHaveLength(5);
    for (const component of support.components) {
      for (const { id } of support.regions) {
        expect(component.regions.filter(r => r.regionId === id)).toHaveLength(1);
      }
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    ["구성요소 누락", (s: ExtensionSupportCatalog) => { s.components.pop(); }],
    ["구성요소 중복", (s: ExtensionSupportCatalog) => { s.components.push(s.components[0]); }],
    ["지역 쌍 누락", (s: ExtensionSupportCatalog) => { s.components[0].regions.pop(); }],
    ["지역 쌍 중복", (s: ExtensionSupportCatalog) => { s.components[0].regions[1] = s.components[0].regions[0]; }],
    ["미등록 구성요소", (s: ExtensionSupportCatalog) => { s.components[0].componentId = "not-in-catalog"; }],
    ["다른 지역 단가", (s: ExtensionSupportCatalog) => { s.components[0].regions[1].priceRegion = "canadacentral"; }],
    ["출처 누락", (s: ExtensionSupportCatalog) => { s.components[0].regions[0].sources = []; }],
    ["미승인 출처", (s: ExtensionSupportCatalog) => { s.reusePolicies[0].sources[0].url = "https://private.invalid/"; }],
    ["SKU 매핑 누락", (s: ExtensionSupportCatalog) => { s.reusePolicies.find(p => p.id === "reuse-linux-app-service-plan")!.skuByComponent = {}; }],
  ])("잘못된 실제 지원 데이터는 거절한다: %s", async (_label, change) => {
    expect(await loadChangedSupport(change)).toThrow("Invalid extension support catalog.");
  });

  it("용량 보장 필드를 거절한다", async () => {
    const load = await loadChangedSupport(s => {
      Object.assign(s.reusePolicies[0], { capacity: "sufficient" });
    });
    expect(load).toThrow("Invalid extension support catalog.");
  });

  it.each(["key-vault-operations", "log-analytics-ingestion"])(
    "사용량 과금 재사용을 무료로 선언할 수 없다: %s", async componentId => {
      const load = await loadChangedSupport(s => {
        s.reusePolicies.find(p => p.componentIds.includes(componentId))!.additionalUsage = "none";
      });
      expect(load).toThrow("Invalid extension support catalog.");
    },
  );

  it("정확한 지역 가격이나 단위가 없으면 다른 지역 가격을 사용하지 않는다", async () => {
    const catalog = loadCatalog();
    delete catalog.prices.prices["app-service-linux-b1"].westus2;
    vi.doMock("./load", () => ({ loadCatalog: () => catalog }));
    const { loadExtensionSupportCatalog: load } = await import("./extension-support");
    expect(load).toThrow("Invalid extension support catalog.");
    catalog.prices.prices["app-service-linux-b1"].westus2 = {
      ...catalog.prices.prices["app-service-linux-b1"].canadacentral, unitOfMeasure: "1 GB",
    };
    expect(load).toThrow("Invalid extension support catalog.");
  });

  it("가격 없는 unknown 조합을 그대로 조회하며 단가·지원 상태를 대체하지 않는다", async () => {
    const support = loadExtensionSupportCatalog();
    const catalog = loadCatalog();
    delete catalog.prices.prices["app-service-linux-b1"].westus2;
    support.components[0].regions.find(r => r.regionId === "westus2")!.status = "unknown";
    vi.doMock("./load", () => ({ loadCatalog: () => catalog }));
    vi.doMock("@/catalog/extension-support.json", () => ({ default: support }));
    const { loadExtensionSupportCatalog: load } = await import("./extension-support");
    const pair = getComponentRegionSupport(load(), "app-service-linux-b1", "westus2");
    expect(pair).toEqual(expect.objectContaining({ status: "unknown", priceRegion: "westus2" }));
    expect(pair).not.toHaveProperty("price");
    expect(() => calculatePlanCost([{ componentId: "app-service-linux-b1", quantity: 1 }], catalog, { region: "westus2" })).toThrow(/가격 스냅샷/);
  });

  it("잘못된 기본 카탈로그도 숨기거나 대체하지 않는다", async () => {
    const error = new Error("Invalid base catalog");
    vi.doMock("./load", () => ({ loadCatalog: () => { throw error; } }));
    const { loadExtensionSupportCatalog: load } = await import("./extension-support");
    expect(load).toThrow(error);
  });

  it("호출 결과를 고쳐도 다음 정적 로드에 영향을 주지 않는다", () => {
    const support = loadExtensionSupportCatalog();
    support.components.pop();
    support.reusePolicies[0].notes.en = "Changed";
    expect(loadExtensionSupportCatalog()).toEqual(rawSupport);
  });
});

describe("지원·재사용 조회", () => {
  it("정확한 지역과 구성요소의 근거를 반환하고 누락/다른 표기는 추측하지 않는다", () => {
    const support = loadExtensionSupportCatalog();
    expect(getExtensionRegion(support, "westus2")).toBe(support.regions[1]);
    expect(getComponentRegionSupport(support, "app-service-linux-b1", "westus2")).toBe(support.components[0].regions[1]);
    for (const region of ["global", "canadaeast", "WESTUS2", " westus2", ""]) {
      expect(getExtensionRegion(support, region)).toBeUndefined();
      expect(getComponentRegionSupport(support, "app-service-linux-b1", region)).toBeUndefined();
    }
    for (const id of ["missing", "APP-SERVICE-LINUX-B1", " app-service-linux-b1"]) {
      expect(getComponentRegionSupport(support, id, "westus2")).toBeUndefined();
    }
    for (const { id } of support.regions) {
      for (const idComponent of ["static-web-apps-free", "static-web-apps-standard"]) {
        expect(getComponentRegionSupport(support, idComponent, id)?.status).toBe("unknown");
      }
      expect(getComponentRegionSupport(support, "front-door-standard-base", id)?.priceRegion).toBe("Zone 1");
    }
  });

  it("타입과 구성요소가 모두 일치하는 정책만 반환하며 용량 판정은 하지 않는다", () => {
    const support = loadExtensionSupportCatalog();
    const [plan] = getReusePolicies(support, "microsoft.web/serverfarms", "app-service-linux-p1v3");
    expect(plan.id).toBe("reuse-linux-app-service-plan");
    expect(plan.skuByComponent?.["app-service-linux-p1v3"]).toBe("P1v3");
    expect(plan.conditions).toEqual(["same-region", "sku-match", "linux-required"]);
    expect(plan.capacity).toBe("unverified");
    for (const [type, id] of [
      ["microsoft.web/sites", "app-service-linux-p1v3"],
      ["Microsoft.Web/serverfarms", "app-service-linux-p1v3"],
      ["microsoft.web/serverfarms", "functions-dedicated-p1v3"],
      ["microsoft.web/serverfarms", "missing"],
      ["microsoft.compute/virtualmachines", "app-service-linux-b1"],
    ]) expect(getReusePolicies(support, type, id)).toEqual([]);
  });

  it("무료 네트워크 참조의 실제 Bicep 타입과 증가 사용량 과금을 유지한다", () => {
    const support = loadExtensionSupportCatalog();
    const catalog = loadCatalog();
    for (const [id, type] of [
      ["virtual-network", "microsoft.network/virtualnetworks"],
      ["virtual-network-subnet", "microsoft.network/virtualnetworks/subnets"],
    ]) {
      const [policy] = getReusePolicies(support, type, id);
      expect(policy.capacity).toBe("unverified");
      expect(catalog.components.find(c => c.id === id)?.bicepResourceTypes.map(t => t.toLowerCase())).toEqual([type]);
    }
    for (const [id, type] of [
      ["key-vault-operations", "microsoft.keyvault/vaults"],
      ["log-analytics-ingestion", "microsoft.operationalinsights/workspaces"],
    ]) {
      expect(getReusePolicies(support, type, id)[0].additionalUsage).toBe("metered");
      for (const { id: region } of support.regions) {
        expect(calculatePlanCost([{ componentId: id, quantity: 20 }], catalog, { region }).total).toBeGreaterThan(0);
      }
    }
  });
});
