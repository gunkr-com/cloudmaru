import type { InventoryContainer, InventoryObservedField, InventoryResource } from "@/types/inventory";

export class InventoryParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InventoryParseError";
  }
}

export function canonicalId(id: string): string {
  return id.trim().toLowerCase().replace(/\/+$/, "");
}

const canonicalArmIdPattern = /^\/subscriptions\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/resourcegroups\/[^/\\?#]+\/providers\/[a-z0-9.]+(?:\/[^/\\?#]+\/[^/\\?#]+)+$/;

/** Structural ARM identity check; provider-specific resource names may contain spaces. */
export function isCanonicalArmResourceId(id: string): boolean {
  return id === canonicalId(id) && canonicalArmIdPattern.test(id)
    && !/[\p{Cc}\p{Zl}\p{Zp}]/u.test(id)
    && !id.split("/").some(part => part === "." || part === "..");
}

function objectOrNull(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function requireRow(row: unknown): Record<string, unknown> {
  const object = objectOrNull(row);
  if (!object) throw new InventoryParseError("인벤토리 행은 객체여야 합니다.");
  return object;
}

function requiredString(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new InventoryParseError(`${key} 필드는 비어 있지 않은 문자열이어야 합니다.`);
  }
  return value;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function normalizeTags(value: unknown): Record<string, string> {
  return Object.fromEntries(Object.entries(objectOrNull(value) ?? {})
    .filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}

// 복구 가능한 값은 기존처럼 정규화하지만, 부분 복구한 필드는 관측 완료로 표시하지 않는다.
const nullableString = (value: unknown) => value === null || typeof value === "string";
const observedFieldValidators: Record<InventoryObservedField, (value: unknown) => boolean> = {
  tags: value => value === null || (objectOrNull(value) !== null && Object.values(value as object).every(v => typeof v === "string")),
  zones: value => value === null || (Array.isArray(value) && value.every(v => typeof v === "string")),
  managedBy: nullableString,
  sku: value => value === null || objectOrNull(value) !== null,
  properties: value => objectOrNull(value) !== null,
  location: nullableString,
  kind: nullableString,
};

export function normalizeResourceRow(row: unknown): InventoryResource {
  const object = requireRow(row);
  return {
    id: canonicalId(requiredString(object, "id")),
    name: requiredString(object, "name"),
    type: requiredString(object, "type").trim().toLowerCase(),
    kind: optionalString(object.kind),
    location: optionalString(object.location)?.trim().toLowerCase() ?? null,
    subscriptionId: requiredString(object, "subscriptionId").trim().toLowerCase(),
    resourceGroup: requiredString(object, "resourceGroup").trim().toLowerCase(),
    sku: objectOrNull(object.sku),
    tags: normalizeTags(object.tags),
    zones: Array.isArray(object.zones)
      ? object.zones.filter((zone): zone is string => typeof zone === "string") : [],
    managedBy: typeof object.managedBy === "string" ? canonicalId(object.managedBy) : null,
    properties: objectOrNull(object.properties) ?? {},
    parentId: null,
    observedFields: (Object.keys(observedFieldValidators) as InventoryObservedField[])
      .filter(field => Object.hasOwn(object, field) && observedFieldValidators[field](object[field])),
  };
}

export function normalizeContainerRow(row: unknown): InventoryContainer {
  const object = requireRow(row);
  const type = requiredString(object, "type").trim().toLowerCase();
  let kind: InventoryContainer["kind"];
  if (type === "microsoft.resources/subscriptions") kind = "subscription";
  else if (type === "microsoft.resources/subscriptions/resourcegroups") kind = "resourceGroup";
  else throw new InventoryParseError("지원하지 않는 인벤토리 컨테이너 종류입니다.");

  return {
    id: canonicalId(requiredString(object, "id")),
    kind,
    name: requiredString(object, "name"),
    subscriptionId: requiredString(object, "subscriptionId").trim().toLowerCase(),
    location: optionalString(object.location)?.trim().toLowerCase() ?? null,
    tags: normalizeTags(object.tags),
  };
}
