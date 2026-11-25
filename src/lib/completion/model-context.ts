import "server-only";
import { canonicalId, isCanonicalArmResourceId } from "@/lib/inventory/normalize";
import type { InventoryResource } from "@/types/inventory";
import type {
  CompletionReasonCode, ModelContextOptions, ModelContextResource, ModelInventoryContext, ModelResourceFacts,
} from "@/types/completion";

export const DEFAULT_MODEL_CONTEXT_LIMIT = 200;
const typePattern = /^microsoft\.[a-z0-9.]+(?:\/[a-z0-9]+)+$/;
const locationPattern = /^[a-z][a-z0-9]{1,39}$/;
const compare = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;

function validId(raw: string): string | null {
  const id = canonicalId(raw);
  return isCanonicalArmResourceId(id) ? id : null;
}
function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** 고정 타입·값만 투영한다. SKU·이름·주소·임의 문자열은 다루지 않는다. */
function safeFacts(resource: InventoryResource, type: string): ModelResourceFacts {
  const facts: ModelResourceFacts = {};
  const properties = object(resource.properties);
  const boolean = (key: keyof ModelResourceFacts, value: unknown) => {
    if (typeof value === "boolean") Object.assign(facts, { [key]: value });
  };
  const tls = (value: unknown) => {
    const versions: Record<string, ModelResourceFacts["minimumTlsVersion"]> = {
      "1.0": "1.0", "1.1": "1.1", "1.2": "1.2", "1.3": "1.3",
      TLS1_0: "1.0", TLS1_1: "1.1", TLS1_2: "1.2", TLS1_3: "1.3",
    };
    if (typeof value === "string" && Object.hasOwn(versions, value)) facts.minimumTlsVersion = versions[value];
  };
  switch (type) {
    case "microsoft.web/sites": {
      boolean("httpsOnly", properties.httpsOnly);
      const siteConfig = object(properties.siteConfig);
      tls(siteConfig.minTlsVersion);
      const ftps = { Disabled: "disabled", FtpsOnly: "ftps-only", AllAllowed: "all-allowed" } as const;
      if (typeof siteConfig.ftpsState === "string" && Object.hasOwn(ftps, siteConfig.ftpsState)) {
        facts.ftpsState = ftps[siteConfig.ftpsState as keyof typeof ftps];
      }
      break;
    }
    case "microsoft.web/serverfarms":
      boolean("reserved", properties.reserved);
      boolean("zoneRedundant", properties.zoneRedundant);
      break;
    case "microsoft.storage/storageaccounts":
      boolean("supportsHttpsTrafficOnly", properties.supportsHttpsTrafficOnly);
      boolean("allowBlobPublicAccess", properties.allowBlobPublicAccess);
      tls(properties.minimumTlsVersion);
      break;
    case "microsoft.sql/servers": tls(properties.minimalTlsVersion); break;
    case "microsoft.keyvault/vaults":
      boolean("enableSoftDelete", properties.enableSoftDelete);
      boolean("enablePurgeProtection", properties.enablePurgeProtection);
      boolean("enableRbacAuthorization", properties.enableRbacAuthorization);
      break;
  }
  if (["microsoft.web/sites", "microsoft.storage/storageaccounts", "microsoft.sql/servers",
    "microsoft.keyvault/vaults", "microsoft.documentdb/databaseaccounts", "microsoft.synapse/workspaces"].includes(type)) {
    const access = { Enabled: "enabled", Disabled: "disabled", SecuredByPerimeter: "secured-by-perimeter" } as const;
    if (typeof properties.publicNetworkAccess === "string" && Object.hasOwn(access, properties.publicNetworkAccess)) {
      facts.publicNetworkAccess = access[properties.publicNetworkAccess as keyof typeof access];
    }
  }
  return facts;
}

/** I/O 없이 저장 스캔의 필요한 맥락만 만든다. 모델에는 반환값의 payload만 보낸다. */
export function buildModelInventoryContext(
  resources: readonly InventoryResource[], options: ModelContextOptions,
): ModelInventoryContext {
  const limit = options.maxResources ?? DEFAULT_MODEL_CONTEXT_LIMIT;
  const types = options.supportedResourceTypes.map(type => type.trim().toLowerCase());
  const locations = options.allowedLocations.map(location => location.trim().toLowerCase());
  if (!Number.isSafeInteger(limit) || limit < 0 || types.some(type => !typePattern.test(type))
    || locations.some(location => !locationPattern.test(location))) throw new Error("Invalid model context options.");
  const allowedTypes = new Set(types);
  const allowedLocations = new Set(locations);
  const ids = resources.map(resource => validId(resource.id));
  const frequencies = new Map<string, number>();
  for (const id of ids) if (id) frequencies.set(id, (frequencies.get(id) ?? 0) + 1);
  // 전체 스캔의 정렬 순위로 별칭을 만들어 선택/상한 때문에 다른 리소스로 바뀌지 않게 한다.
  const aliases = new Map([...frequencies.keys()].sort(compare).map((id, index) => [id, `r${String(index + 1).padStart(6, "0")}`]));
  let selection: ModelInventoryContext["payload"]["selection"] = null;
  let selected: Set<string> | null = null;
  if (options.relevantResourceIds !== undefined) {
    selected = new Set();
    const seen = new Set<string>();
    selection = { requested: options.relevantResourceIds.length, matched: 0, rejected: 0, missing: 0, duplicates: 0 };
    for (const raw of options.relevantResourceIds) {
      const id = validId(raw);
      if (!id) { selection.rejected++; continue; }
      if (seen.has(id)) { selection.duplicates++; continue; }
      seen.add(id);
      if (!frequencies.has(id)) { selection.missing++; continue; }
      selected.add(id);
      selection.matched++;
    }
  }
  const reasons = new Map<CompletionReasonCode, number>();
  const exclude = (code: CompletionReasonCode) => reasons.set(code, (reasons.get(code) ?? 0) + 1);
  const included: ModelContextResource[] = [];
  const aliasToResourceId = new Map<string, string>();
  const candidates = resources.map((resource, index) => ({ resource, id: ids[index] }))
    .sort((left, right) => compare(left.id ?? "", right.id ?? ""));
  for (const { resource, id } of candidates) {
    if (id === null || frequencies.get(id) !== 1) { exclude("invalid-data"); continue; }
    if (selected !== null && !selected.has(id)) { exclude("redacted"); continue; }
    const type = resource.type.trim().toLowerCase();
    if (!allowedTypes.has(type)) { exclude("unsupported-type"); continue; }
    if (included.length >= limit) { exclude("context-limit"); continue; }
    const location = resource.location?.trim().toLowerCase();
    const alias = aliases.get(id)!;
    included.push({ alias, type, location: location && allowedLocations.has(location) ? location : null, facts: safeFacts(resource, type) });
    aliasToResourceId.set(alias, id);
  }
  const byType = new Map<string, number>();
  const byLocation = new Map<string | null, number>();
  for (const resource of included) {
    byType.set(resource.type, (byType.get(resource.type) ?? 0) + 1);
    byLocation.set(resource.location, (byLocation.get(resource.location) ?? 0) + 1);
  }
  // 우선순위와 표시 순서는 고정이다. 대상 밖 요청 ID는 인벤토리 분모에 섞지 않는다.
  const order: CompletionReasonCode[] = ["invalid-data", "redacted", "unsupported-type", "context-limit"];
  return {
    payload: {
      schemaVersion: 1, limit, resources: included, selection,
      coverage: { total: resources.length, included: included.length, excluded: resources.length - included.length,
        reasons: order.filter(code => reasons.has(code)).map(code => ({ code, count: reasons.get(code)! })) },
      summary: {
        byType: [...byType].sort(([left], [right]) => compare(left, right)).map(([type, count]) => ({ type, count })),
        byLocation: [...byLocation].sort(([left], [right]) => compare(left ?? "", right ?? "")).map(([location, count]) => ({ location, count })),
      },
    },
    aliasToResourceId,
  };
}
