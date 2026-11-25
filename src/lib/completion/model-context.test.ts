import { describe, expect, it } from "vitest";
import { buildModelInventoryContext, DEFAULT_MODEL_CONTEXT_LIMIT } from "./model-context";
import { coverageSchema } from "./schema";
import { syntheticResources } from "./fixtures.test-data";
import type { InventoryResource } from "@/types/inventory";

const options = {
  supportedResourceTypes: [...new Set(syntheticResources.map(resource => resource.type))],
  allowedLocations: ["canadacentral", "westus2", "centralus"],
};
const build = (resources: readonly InventoryResource[] = syntheticResources) => buildModelInventoryContext(resources, options);

describe("모델 최소 인벤토리 맥락", () => {
  it("legally spaced resource names remain server aliases without copying names into model data", () => {
    const resource = { ...syntheticResources[0],
      id: syntheticResources[0].id.replace("microsoft.network/virtualnetworks/vnet-synthetic", "microsoft.insights/metricalerts/cpu high alert"),
      type: "microsoft.insights/metricalerts", name: "CPU High Alert" };
    const result = buildModelInventoryContext([resource], { ...options, supportedResourceTypes: [resource.type] });
    expect(result.payload.coverage).toEqual({ total: 1, included: 1, excluded: 0, reasons: [] });
    expect([...result.aliasToResourceId.values()]).toEqual([resource.id]);
    expect(JSON.stringify(result.payload)).not.toContain("cpu high alert");
    expect(JSON.stringify(result.payload)).not.toContain("CPU High Alert");
  });
  it("20개를 넘는 모든 리소스를 명시적으로 집계한다", () => {
    const { payload, aliasToResourceId } = build();
    expect(payload.resources).toHaveLength(32);
    expect(aliasToResourceId.size).toBe(32);
    expect(payload.coverage).toEqual({ total: 32, included: 32, excluded: 0, reasons: [] });
    expect(coverageSchema.parse(payload.coverage)).toEqual(payload.coverage);
    expect(payload.limit).toBe(DEFAULT_MODEL_CONTEXT_LIMIT);
    expect(payload.summary.byType.reduce((sum, row) => sum + row.count, 0)).toBe(32);
    expect(payload.summary.byLocation.reduce((sum, row) => sum + row.count, 0)).toBe(32);
  });

  it("이름·태그·SKU·속성·주소·인증정보를 복사하지 않고 고정 사실만 정규화한다", () => {
    const secret = "AccountKey=secret-sentinel;Password=pw-sentinel;sig=private";
    const resources = syntheticResources.map(resource => ({
      ...resource, name: secret, tags: { owner: secret, connectionString: secret },
      sku: { name: secret, tier: "sk-ant-secret-sentinel", password: secret },
      kind: secret, zones: [secret], managedBy: secret, parentId: secret,
      properties: { ...resource.properties, password: secret, accessToken: secret,
        connectionString: secret, privateIPAddress: "10.99.88.77", nested: { secret },
        siteConfig: { minTlsVersion: "1.2", ftpsState: "Disabled", appSettings: [{ value: secret }] } },
    }));
    const before = JSON.stringify(resources);
    const { payload } = build(resources);
    const json = JSON.stringify(payload);
    for (const text of ["secret-sentinel", "pw-sentinel", "sk-ant-", "10.99.88.77", "/subscriptions/", "rg-synthetic",
      "connectionString", "properties", "tags", "sku", "name", "subscriptionId", "parentId", "managedBy"]) {
      expect(json).not.toContain(text);
    }
    const app = payload.resources.find(resource => resource.type === "microsoft.web/sites");
    expect(app?.facts).toMatchObject({ httpsOnly: true, minimumTlsVersion: "1.2", ftpsState: "disabled" });
    expect(JSON.stringify(resources)).toBe(before);
    expect(payload).not.toHaveProperty("aliasToResourceId");
  });

  it("허용된 속성에도 문자열·객체 비밀값을 넣으면 생략한다", () => {
    const app = syntheticResources.find(resource => resource.type === "microsoft.web/sites")!;
    const { payload } = build([{ ...app, location: "Password=location-secret", properties: {
      httpsOnly: "true", publicNetworkAccess: "SharedAccessKey=secret", siteConfig: {
        minTlsVersion: "1.2;Password=secret", ftpsState: { token: "secret" },
      }, zoneRedundant: { password: "secret" },
    } }]);
    expect(payload.resources[0]).toMatchObject({ location: null, facts: {} });
    expect(payload.summary.byLocation).toEqual([{ location: null, count: 1 }]);
    expect(JSON.stringify(payload)).not.toContain("secret");
  });

  it("누락을 false나 기본 보안 설정으로 추정하지 않고 false는 그대로 보존한다", () => {
    const storage = syntheticResources.find(resource => resource.type === "microsoft.storage/storageaccounts")!;
    const { payload } = build([{ ...storage, properties: { allowBlobPublicAccess: false, minimumTlsVersion: "TLS1_2" } }]);
    expect(payload.resources[0].facts).toEqual({ allowBlobPublicAccess: false, minimumTlsVersion: "1.2" });
  });

  it("타입별 허용 목록 밖 속성은 같은 이름이어도 읽지 않는다", () => {
    expect(build([{ ...syntheticResources[0], properties: { httpsOnly: true, enableSoftDelete: false } }]).payload.resources[0].facts).toEqual({});
  });

  it("입력 순서를 바꿔도 별칭·요약·매핑 순서가 같고 선택/상한에도 별칭을 유지한다", () => {
    const first = build();
    const reversed = build([...syntheticResources].reverse());
    expect(reversed.payload).toEqual(first.payload);
    expect([...reversed.aliasToResourceId]).toEqual([...first.aliasToResourceId]);
    const id = syntheticResources[15].id;
    const selected = buildModelInventoryContext(syntheticResources, { ...options, relevantResourceIds: [id], maxResources: 1 });
    const alias = [...first.aliasToResourceId].find(([, canonicalId]) => canonicalId === id)![0];
    expect(selected.payload.resources[0].alias).toBe(alias);
    expect([...selected.aliasToResourceId]).toEqual([[alias, id]]);
  });

  it("선택·미지원·상한 제외를 중복 집계하지 않고 잘못된/없는 요청 ID는 별도로 센다", () => {
    const selected = syntheticResources.slice(0, 5).map(resource => resource.id);
    const missing = syntheticResources[0].id + "-missing";
    const result = buildModelInventoryContext(syntheticResources, { ...options,
      supportedResourceTypes: options.supportedResourceTypes.filter(type => type !== syntheticResources[0].type),
      relevantResourceIds: [...selected, selected[1].toUpperCase(), "not-an-id", missing], maxResources: 2,
    });
    expect(result.payload.selection).toEqual({ requested: 8, matched: 5, rejected: 1, missing: 1, duplicates: 1 });
    expect(result.payload.coverage).toEqual({ total: 32, included: 2, excluded: 30, reasons: [
      { code: "redacted", count: 27 }, { code: "unsupported-type", count: 1 }, { code: "context-limit", count: 2 },
    ] });
    expect(coverageSchema.safeParse(result.payload.coverage).success).toBe(true);
    expect(JSON.stringify(result.payload)).not.toContain(missing);
    expect(result.aliasToResourceId.size).toBe(2);
  });

  it("중복 저장 ID는 해당 행 전부 제외하고 잘못된 ID도 invalid-data로 센다", () => {
    const duplicate = { ...syntheticResources[0], id: syntheticResources[0].id.toUpperCase(), name: "conflict" };
    const result = build([...syntheticResources, duplicate, { ...syntheticResources[1], id: "invalid-secret" }]);
    expect(result.payload.coverage).toEqual({ total: 34, included: 31, excluded: 3, reasons: [{ code: "invalid-data", count: 3 }] });
    expect([...result.aliasToResourceId.values()]).not.toContain(syntheticResources[0].id);
  });

  it("명시적인 0개 상한·빈 선택·빈 인벤토리를 처리한다", () => {
    expect(buildModelInventoryContext(syntheticResources, { ...options, maxResources: 0 }).payload.coverage)
      .toEqual({ total: 32, included: 0, excluded: 32, reasons: [{ code: "context-limit", count: 32 }] });
    expect(buildModelInventoryContext(syntheticResources, { ...options, relevantResourceIds: [] }).payload.coverage.reasons)
      .toEqual([{ code: "redacted", count: 32 }]);
    expect(build([]).payload.coverage).toEqual({ total: 0, included: 0, excluded: 0, reasons: [] });
  });

  it("기본 상한을 넘으면 제외 수를 명시한다", () => {
    const base = syntheticResources[0];
    const resources = Array.from({ length: DEFAULT_MODEL_CONTEXT_LIMIT + 3 }, (_, index) => ({ ...base, id: `${base.id}-${index}` }));
    const { payload } = build(resources);
    expect(payload.resources).toHaveLength(DEFAULT_MODEL_CONTEXT_LIMIT);
    expect(payload.coverage.reasons).toEqual([{ code: "context-limit", count: 3 }]);
  });

  it.each([-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])("잘못된 상한 %s를 안전한 오류로 거절한다", maxResources => {
    expect(() => buildModelInventoryContext(syntheticResources, { ...options, maxResources })).toThrow("Invalid model context options.");
  });
});
