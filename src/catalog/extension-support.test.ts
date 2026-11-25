// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadCatalog } from "@/lib/catalog/load";
import { parseExtensionSupportCatalog } from "@/lib/catalog/extension-support-schema";
import { COMMON_BICEP_RESOURCE_TYPES } from "@/lib/artifacts/resource-types";
import { calculatePlanCost } from "@/lib/cost/calculate";
import { SUPPORTED_REGIONS } from "@/lib/workspace/regions";
import type { ExtensionSupportCatalog } from "@/types/extension-support";

// 실제 정적 산출물을 파서로 검증한다. 합성 ID를 제품 카탈로그에 넣지 않는다.
function support(): ExtensionSupportCatalog {
  return parseExtensionSupportCatalog(
    JSON.parse(readFileSync(new URL("./extension-support.json", import.meta.url), "utf8")),
    loadCatalog(),
  );
}

describe("실제 지역·재사용 지원 데이터", () => {
  it("전체 구성요소와 세 지역을 각각 정확히 한 번 포함한다", () => {
    const data = support();
    const catalog = loadCatalog();
    expect(data.schemaVersion).toBe(1);
    expect(data.version).toBe("2026-11-12-v1");
    expect(Number.isFinite(Date.parse(data.verifiedAt))).toBe(true);
    expect(data.regions.map(r => r.id)).toEqual(SUPPORTED_REGIONS.map(r => r.id));
    expect(data.components.map(c => c.componentId).sort()).toEqual(catalog.components.map(c => c.id).sort());
    expect(data.components).toHaveLength(32);
    for (const component of data.components) {
      expect(component.regions.map(r => r.regionId)).toEqual(data.regions.map(r => r.id));
    }
  });

  it("지원 과금 항목은 해당 SKU·지역의 저장 단위·미터 근거를 사용한다", () => {
    const data = support();
    const catalog = loadCatalog();
    for (const entry of data.components) {
      const component = catalog.components.find(c => c.id === entry.componentId)!;
      for (const regional of entry.regions) {
        if (component.pricing.kind === "free") {
          expect(regional).not.toHaveProperty("priceRegion");
        } else {
          expect(regional.priceRegion).toBe(component.pricing.priceRegion ?? regional.regionId);
          if (regional.status === "supported") {
            const price = catalog.prices.prices[component.id][regional.regionId];
            expect(price.meterId.length).toBeGreaterThan(0);
            expect(price.unitOfMeasure).toBe(component.pricing.unitOfMeasure);
          }
        }
      }
    }
    // eastus2 요금은 선택 지역의 배포 지원 근거가 아니다.
    for (const id of ["static-web-apps-standard", "static-web-apps-free"]) {
      const entry = data.components.find(c => c.componentId === id)!;
      expect(entry.regions.every(r => r.status === "unknown")).toBe(true);
      if (id.endsWith("standard")) expect(entry.regions.every(r => r.priceRegion === "eastus2")).toBe(true);
    }
    expect(data.components.find(c => c.componentId === "front-door-standard-base")!.regions
      .every(r => r.status === "supported" && r.priceRegion === "Zone 1")).toBe(true);
    expect(data.components.flatMap(c => c.regions).filter(r => r.status === "supported")).toHaveLength(90);
  });

  it("무료 네트워크는 VNet·서브넷만 추가하고 전송 과금과 분리한다", () => {
    const catalog = loadCatalog();
    const network = catalog.components.filter(c => c.pricing.kind === "free" && c.category === "network");
    expect(network.map(c => c.id)).toEqual(["virtual-network", "virtual-network-subnet"]);
    for (const [index, type] of ["Microsoft.Network/virtualNetworks", "Microsoft.Network/virtualNetworks/subnets"].entries()) {
      expect(network[index].bicepResourceTypes).toEqual([type]);
      expect(COMMON_BICEP_RESOURCE_TYPES).toContain(type);
      expect(catalog.prices.prices).not.toHaveProperty(network[index].id);
      expect(network[index].description.en).toMatch(/transfer|egress/i);
      expect(network[index].description.ko).toMatch(/전송|송신/);
      const entry = support().components.find(c => c.componentId === network[index].id)!;
      expect(entry.regions.every(r => r.sources.some(s => s.url.includes("virtual-networks-overview")))).toBe(true);
    }
    const items = [{ componentId: "internet-egress", quantity: 200 }];
    for (const { id } of SUPPORTED_REGIONS) {
      const original = calculatePlanCost(items, catalog, { region: id });
      const withNetwork = calculatePlanCost([...items, ...network.map(c => ({ componentId: c.id, quantity: 1 }))], catalog, { region: id });
      expect(withNetwork.total).toBe(original.total);
      expect(withNetwork.lines.filter(i => network.some(c => c.id === i.componentId)).every(i => i.amount === 0)).toBe(true);
    }
  });

  it("5개 승인 계열만 재사용하며 Linux 플랜은 정확한 ARM SKU와 조건을 명시한다", () => {
    const policies = support().reusePolicies;
    expect(policies).toHaveLength(5);
    expect(policies.flatMap(p => p.resourceTypes).sort()).toEqual([
      "microsoft.network/virtualnetworks", "microsoft.network/virtualnetworks/subnets",
      "microsoft.web/serverfarms", "microsoft.keyvault/vaults", "microsoft.operationalinsights/workspaces",
    ].sort());
    const plan = policies.find(p => p.id === "reuse-linux-app-service-plan")!;
    expect(plan.conditions).toEqual(["same-region", "sku-match", "linux-required"]);
    expect(plan.skuByComponent).toEqual({
      "app-service-linux-b1": "B1", "app-service-linux-b2": "B2", "app-service-linux-p0v3": "P0v3",
      "app-service-linux-p1v3": "P1v3", "app-service-linux-p2v3": "P2v3",
    });
    expect(plan.componentIds.sort()).toEqual(Object.keys(plan.skuByComponent!).sort());
    expect(plan.additionalUsage).toBe("none");
    expect(plan.notes.en).toMatch(/reserved.*true/);
    const subnet = policies.find(p => p.id === "reuse-subnet")!;
    expect(subnet.conditions).toEqual(["same-region", "parent-inventory", "delegation-verified"]);
    for (const policy of policies) {
      expect(policy.conditions).toContain("same-region");
      expect(policy.capacity).toBe("unverified");
      expect(policy.notes.en.length).toBeGreaterThan(30);
      expect(policy.notes.ko).toMatch(/[가-힣]/);
    }
    for (const id of ["key-vault-operations", "log-analytics-ingestion"]) {
      expect(policies.find(p => p.componentIds.includes(id))?.additionalUsage).toBe("metered");
    }
    for (const id of ["postgres-flex-b1ms", "cosmos-db-serverless-ru", "blob-hot-lrs", "functions-dedicated-p1v3"]) {
      expect(policies.some(p => p.componentIds.includes(id))).toBe(false);
    }
  });

  it("검토한 Microsoft Learn HTTPS 출처와 두 언어 설명을 보존한다", () => {
    const data = support();
    for (const region of data.regions) {
      expect(region.label.en.length).toBeGreaterThan(0);
      expect(region.label.ko).toMatch(/[가-힣]/);
    }
    const sources = [...data.components.flatMap(c => c.regions.flatMap(r => r.sources)), ...data.reusePolicies.flatMap(p => p.sources)];
    for (const source of sources) {
      const url = new URL(source.url);
      expect(url.protocol).toBe("https:");
      expect(url.hostname).toBe("learn.microsoft.com");
      expect(url.username + url.password + url.hash).toBe("");
      expect(source.title.length).toBeGreaterThan(0);
    }
  });

  it("실제 정책의 ID·타입·SKU 매핑·조건·용량·증분 과금 오류를 파서가 거부한다", () => {
    const data = support();
    const catalog = loadCatalog();
    const plan = data.reusePolicies.find(p => p.id === "reuse-linux-app-service-plan")!;
    const subnet = data.reusePolicies.find(p => p.id === "reuse-subnet")!;
    for (const bad of [
      { ...plan, componentIds: ["unknown-linux-plan"] },
      { ...plan, resourceTypes: ["microsoft.compute/virtualmachines"] },
      { ...plan, skuByComponent: { "app-service-linux-b1": "B1" } },
      { ...plan, skuByComponent: { ...plan.skuByComponent, "postgres-flex-b1ms": "B1ms" } },
      { ...plan, conditions: ["linux-required", "sku-match"] },
      { ...subnet, conditions: [...subnet.conditions, "parent-inventory"] },
      { ...subnet, additionalUsage: "metered" },
      { ...plan, capacity: "sufficient" },
    ]) expect(() => parseExtensionSupportCatalog({ ...data, reusePolicies: [bad] }, catalog)).toThrow();
  });

  it("무료 네트워크·기존 리소스 참조가 추가 로그·Key Vault 작업 비용을 제거하지 않는다", () => {
    const catalog = loadCatalog();
    const policies = support().reusePolicies;
    const items = [
      { componentId: "log-analytics-ingestion", quantity: 20 },
      { componentId: "key-vault-operations", quantity: 10 },
      { componentId: "virtual-network", quantity: 1 },
      { componentId: "virtual-network-subnet", quantity: 1 },
    ];
    for (const { id } of SUPPORTED_REGIONS) {
      const cost = calculatePlanCost(items, catalog, { region: id });
      expect(cost.total).toBeGreaterThan(0);
      for (const componentId of ["log-analytics-ingestion", "key-vault-operations"]) {
        expect(policies.find(p => p.componentIds.includes(componentId))?.additionalUsage).toBe("metered");
        expect(cost.lines.find(l => l.componentId === componentId)!.amount).toBeGreaterThan(0);
      }
    }
  });

  it("구성요소·지역 누락/중복과 대체 지역 가격을 거부한다", () => {
    const data = support();
    const catalog = loadCatalog();
    for (const mutate of [
      (d: ExtensionSupportCatalog) => { d.components.pop(); },
      (d: ExtensionSupportCatalog) => { d.components.push(d.components[0]); },
      (d: ExtensionSupportCatalog) => { d.components[0].regions.pop(); },
      (d: ExtensionSupportCatalog) => { d.components[0].regions[1] = d.components[0].regions[0]; },
      (d: ExtensionSupportCatalog) => { d.components[0].regions[1].priceRegion = "canadacentral"; },
    ]) {
      const changed = structuredClone(data); mutate(changed);
      expect(() => parseExtensionSupportCatalog(changed, catalog)).toThrow();
    }
    const unpriced = structuredClone(catalog);
    delete unpriced.prices.prices["app-service-linux-b1"].westus2;
    expect(() => parseExtensionSupportCatalog(data, unpriced)).toThrow();
    const unknown = structuredClone(data);
    unknown.components.find(c => c.componentId === "app-service-linux-b1")!.regions.find(r => r.regionId === "westus2")!.status = "unknown";
    expect(parseExtensionSupportCatalog(unknown, unpriced).components[0].regions[1].status).toBe("unknown");
    expect(unpriced.prices.prices["app-service-linux-b1"]).not.toHaveProperty("westus2");
  });
});
