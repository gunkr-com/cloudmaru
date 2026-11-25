import { describe, expect, it } from "vitest";
import { loadCatalog } from "@/lib/catalog/load";
import { createCatalog } from "@/lib/catalog/fixtures.test-data";
import { allowedResourceTypes, COMMON_BICEP_RESOURCE_TYPES, isResourceTypeAllowed } from "./resource-types";

describe("Bicep 허용 리소스 타입", () => {
  it("카탈로그 구성요소와 공통 타입의 합집합을 중복 제거하고 정렬한다", () => {
    const catalog = createCatalog();
    catalog.components[0].bicepResourceTypes = ["Microsoft.Web/sites", "Microsoft.Web/serverfarms"];
    catalog.components[1].bicepResourceTypes = ["Microsoft.Web/sites"];
    expect(allowedResourceTypes({ services: [{ componentId: "test-compute", name: { en: "테스트", ko: "테스트" }, quantity: 1, unitLabel: { en: "대", ko: "대" } }] }, catalog)).toEqual(
      [...new Set([...COMMON_BICEP_RESOURCE_TYPES, "Microsoft.Web/sites", "Microsoft.Web/serverfarms"])].sort(),
    );
  });

  it("목록의 타입과 대소문자만 다른 정확한 일치를 허용한다", () => {
    expect(isResourceTypeAllowed("microsoft.web/SITES", ["Microsoft.Web/sites"])).toBe(true);
    expect(isResourceTypeAllowed("Microsoft.Sql/servers", ["Microsoft.Web/sites"])).toBe(false);
    expect(isResourceTypeAllowed("Microsoft.Web/sitesExtra", ["Microsoft.Web/sites"])).toBe(false);
    expect(isResourceTypeAllowed("Microsoft.Web", ["Microsoft.Web/sites"])).toBe(false);
  });

  it("목록에 적힌 하위 타입은 허용한다", () => {
    const allowed = ["Microsoft.Web/sites", "Microsoft.Web/sites/config"];
    expect(isResourceTypeAllowed("Microsoft.Web/sites/config", allowed)).toBe(true);
    expect(isResourceTypeAllowed("MICROSOFT.WEB/Sites/CONFIG", allowed)).toBe(true);
  });

  it("상위 타입이 허용돼도 목록에 없는 하위 타입은 거부한다", () => {
    expect(isResourceTypeAllowed("Microsoft.Web/sites/config", ["Microsoft.Web/sites"])).toBe(false);
    expect(isResourceTypeAllowed(
      "Microsoft.DBforPostgreSQL/flexibleServers/advancedThreatProtectionSettings",
      ["Microsoft.DBforPostgreSQL/flexibleServers", "Microsoft.DBforPostgreSQL/flexibleServers/databases"],
    )).toBe(false);
    expect(isResourceTypeAllowed("Microsoft.Network/virtualNetworks/virtualNetworkPeerings", COMMON_BICEP_RESOURCE_TYPES)).toBe(false);
  });

  it("공통 타입에 가상 네트워크 서브넷이 있고 공통 하위 타입의 상위 타입도 공통 타입에 있다", () => {
    expect(isResourceTypeAllowed("Microsoft.Network/virtualNetworks/subnets", COMMON_BICEP_RESOURCE_TYPES)).toBe(true);
    const common = COMMON_BICEP_RESOURCE_TYPES.map((type) => type.toLowerCase());
    for (const type of COMMON_BICEP_RESOURCE_TYPES) {
      const segments = type.split("/");
      if (segments.length > 2) expect(common, type).toContain(segments.slice(0, -1).join("/").toLowerCase());
    }
  });

  it("실제 카탈로그 안에서 생성 결과가 쓰는 비용 없는 하위 타입만 허용하고 과금 하위 타입은 거부한다", () => {
    const catalog = loadCatalog();
    const services = ["app-service-linux-p0v3", "postgres-flex-gp-2vcore", "postgres-flex-storage", "blob-hot-lrs", "key-vault-operations"]
      .map((componentId) => {
        const component = catalog.components.find(({ id }) => id === componentId)!;
        return { componentId, name: component.name, quantity: 1, unitLabel: component.unitLabel };
      });
    const allowed = allowedResourceTypes({ services }, catalog);
    for (const type of [
      "Microsoft.Web/sites/config",
      "Microsoft.DBforPostgreSQL/flexibleServers/databases",
      "Microsoft.DBforPostgreSQL/flexibleServers/firewallRules",
      "Microsoft.DBforPostgreSQL/flexibleServers/configurations",
      "Microsoft.Storage/storageAccounts/blobServices",
      "Microsoft.Storage/storageAccounts/blobServices/containers",
      "Microsoft.KeyVault/vaults/secrets",
      "Microsoft.Network/virtualNetworks/subnets",
    ]) expect(isResourceTypeAllowed(type, allowed), type).toBe(true);
    for (const type of [
      "Microsoft.DBforPostgreSQL/flexibleServers/advancedThreatProtectionSettings",
      "Microsoft.Network/virtualNetworks/virtualNetworkPeerings",
      "Microsoft.Web/sites/slots",
      "Microsoft.KeyVault/vaults/keys",
      "Microsoft.Storage/storageAccounts/fileServices",
    ]) expect(isResourceTypeAllowed(type, allowed), type).toBe(false);

    const withoutVault = allowedResourceTypes({ services: services.filter(({ componentId }) => componentId !== "key-vault-operations") }, catalog);
    expect(isResourceTypeAllowed("Microsoft.KeyVault/vaults/secrets", withoutVault)).toBe(false);
  });

  it("카탈로그에 없는 구성요소 ID를 포함한 오류를 던진다", () => {
    expect(() => allowedResourceTypes({ services: [{ componentId: "missing-component", name: { en: "없음", ko: "없음" }, quantity: 1, unitLabel: { en: "개", ko: "개" } }] }, createCatalog()))
      .toThrow(/missing-component/);
  });

  it("모든 참조 아키텍처 단계의 허용 집합에 해당 컴퓨트 구성요소 타입이 포함된다", () => {
    const catalog = loadCatalog();
    for (const architecture of catalog.architectures) {
      for (const tier of Object.values(architecture.tiers)) {
        const allowed = allowedResourceTypes({ services: tier.items.map(({ componentId, quantity }) => ({
          componentId,
          quantity,
          name: catalog.components.find(({ id }) => id === componentId)!.name,
          unitLabel: catalog.components.find(({ id }) => id === componentId)!.unitLabel,
        })) }, catalog);
        const computeItems = tier.items.filter(({ componentId }) =>
          catalog.components.find(({ id }) => id === componentId)?.category === "compute");
        expect(computeItems.length, architecture.id).toBeGreaterThan(0);
        for (const { componentId } of computeItems) {
          const component = catalog.components.find(({ id }) => id === componentId)!;
          for (const type of component.bicepResourceTypes) expect(allowed).toContain(type);
        }
      }
    }
  });
});
