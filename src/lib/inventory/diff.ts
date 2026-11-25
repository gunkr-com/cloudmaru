import { scanDiffSchema } from "@/lib/completion/schema";
import { toCompletionSourceScan } from "@/lib/completion/source-scan";
import { parseScanInventory } from "@/lib/scans/rows";
import { canonicalId, isCanonicalArmResourceId } from "./normalize";
import type { ScanInventory, ScanRecord } from "@/types/scan";
import type { InventoryObservedField, InventoryResource } from "@/types/inventory";
import type { ScanDiff } from "@/types/assessment";
import type { CompletionReasonCode, JsonValue, Observation, SourceScan } from "@/types/completion";

export type SavedScanSnapshot = { scan: ScanRecord; inventory: ScanInventory };
export type ScanDiffErrorCode = "invalid-snapshot" | "workspace-mismatch" | "same-scan" | "invalid-time";
export class ScanDiffError extends Error {
  constructor(readonly code: ScanDiffErrorCode) { super(code); this.name = "ScanDiffError"; }
}
const fields: InventoryObservedField[] = ["tags", "zones", "managedBy", "sku", "properties", "location", "kind"];
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const order = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const secretKey = (key: string) => /secret|password|token|key|credential|thumbprint|connectionstring|authorization|securevalue|protectedsettings|^pwd$|^sig$/i.test(key.replace(/[^a-z0-9]/gi, ""));
const secretValue = (value: string) => /AccountKey\s*=|SharedAccessKey\s*=|SharedAccessSignature\s*=|(?:Password|Pwd)\s*=|(?:^|[?&])sig=|[a-z][a-z0-9+.-]*:\/\/[^\s/?#]*@|-----BEGIN[^\n]*PRIVATE KEY|\bBearer\s+\S+|\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|\b(?:sk-ant-|sk-proj-|ghp_|github_pat_)[a-z0-9_-]+/i.test(value);
// Published permission enums, not key/secret payloads:
// https://learn.microsoft.com/en-us/azure/templates/microsoft.keyvault/vaults
const permissionOperations: Record<string, readonly string[]> = {
  keys: ["all","backup","create","decrypt","delete","encrypt","get","getrotationpolicy","import","list","purge","recover","release","restore","rotate","setrotationpolicy","sign","unwrapkey","update","verify","wrapkey"],
  secrets: ["all","backup","delete","get","list","purge","recover","restore","set"],
  certificates: ["all","backup","create","delete","deleteissuers","get","getissuers","import","list","listissuers","managecontacts","manageissuers","purge","recover","restore","setissuers","update"],
  storage: ["all","backup","delete","deletesas","get","getsas","list","listsas","purge","recover","regeneratekey","restore","set","setsas","update"],
};
function publicConfigurationValue(resourceType: string, path: string, key: string, value: unknown): JsonValue | undefined {
  if (resourceType === "microsoft.keyvault/vaults" && /^\/properties\/accessPolicies\/\d+\/permissions$/.test(path)
    && Object.hasOwn(permissionOperations, key)) {
    if (!Array.isArray(value) || value.some(item => typeof item !== "string" || !permissionOperations[key].includes(item.toLowerCase()))) return "[redacted]";
    return [...new Set((value as string[]).map(item => item.toLowerCase()))].sort(order);
  }
  // Provider enum, never a key URI/name/value. Microsoft documents case-insensitivity.
  // https://learn.microsoft.com/en-us/azure/templates/microsoft.storage/storageaccounts
  if (resourceType === "microsoft.storage/storageaccounts" && path === "/properties/encryption" && key === "keySource") {
    if (typeof value !== "string") return "[redacted]";
    return value.toLowerCase() === "microsoft.storage" ? "Microsoft.Storage"
      : value.toLowerCase() === "microsoft.keyvault" ? "Microsoft.Keyvault" : "[redacted]";
  }
  return undefined;
}

// JSON 외의 값은 가리기 전에 거절한다. 오류에는 경로·원문을 담지 않는다.
function assertJson(value: unknown, ancestors = new Set<object>()): void {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (typeof value !== "object" || !value || ancestors.has(value)
    || (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    throw new ScanDiffError("invalid-snapshot");
  }
  ancestors.add(value);
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) assertJson(value[i], ancestors);
  } else for (const item of Object.values(value)) assertJson(item, ancestors);
  ancestors.delete(value);
}

// 비밀 키는 경로에도 노출하지 않는다. 배열은 자르지 않고 순서를 보존한다.
function safeValue(value: unknown, path = "", resourceType = ""): JsonValue {
  const field = path.split("/").at(-1);
  if (typeof value === "string") {
    if (secretValue(value)) return "[redacted]";
    const id = canonicalId(value);
    if (isCanonicalArmResourceId(id)) return id;
    return value;
  }
  if (Array.isArray(value)) {
    const items = value.map((item, index) => safeValue(item, `${path}/${index}`, resourceType));
    // 의미상 집합임이 확실한 필드만 정규화한다. 나머지는 순서가 의미 있다.
    if ((path === "/zones" || (resourceType.startsWith("microsoft.network/") && path.startsWith("/properties/") && ["addressPrefixes", "sourceAddressPrefixes", "destinationAddressPrefixes", "sourcePortRanges", "destinationPortRanges"].includes(field ?? "")))
      && items.every(item => typeof item === "string")) return [...new Set(items)].sort((a, b) => order(String(a), String(b)));
    if (resourceType === "microsoft.network/networksecuritygroups" && ["/properties/securityRules", "/properties/defaultSecurityRules"].includes(path)
      && items.every(item => object(item) && typeof item.name === "string")) {
      return items.sort((a, b) => order(JSON.stringify(a), JSON.stringify(b)));
    }
    return items;
  }
  if (object(value)) {
    // Azure env/app-setting rows store the sensitive name separately from value.
    // Decide on the original object before filtering a secret-named key field.
    const sensitiveValue = Object.entries(value).some(([key, label]) => typeof label === "string"
      && (/^(?:name|key)$/i.test(key) && secretKey(label)
        || /^type$/i.test(key) && /^(?:securestring|secureobject)$/i.test(label)));
    return Object.fromEntries(Object.keys(value).sort(order).flatMap(key => {
      const configuration = publicConfigurationValue(resourceType, path, key, value[key]);
      if (configuration !== undefined) return [[key, configuration]];
      // Boolean switches contain no credential value; retain security configuration flags.
      if (secretKey(key) && typeof value[key] !== "boolean" || secretValue(key)) return [];
      return [[key, sensitiveValue && /^(?:value|defaultvalue)$/i.test(key) ? "[redacted]"
        : safeValue(value[key], `${path}/${key.replace(/~/g,"~0").replace(/\//g,"~1")}`, resourceType)]];
    }));
  }
  return value as JsonValue;
}

/** Display projection only: reuse diff redaction without replaying a historical comparison.
 * Pass the original JSON Pointer/type, and render BOTH returned fields instead of the raw path.
 * Full setting rows retain public values; isolated value/defaultValue leaves lack their name/type
 * context and are conservatively masked. No input is mutated or array silently truncated.
 */
export function redactInventoryDisplay(value: unknown, path = "", resourceType = ""): { path: string; value: JsonValue } {
  try {
    assertJson(value);
    if (typeof path !== "string" || (path !== "" && !path.startsWith("/")) || /~(?![01])/u.test(path)
      || typeof resourceType !== "string") throw new ScanDiffError("invalid-snapshot");
    const encoded = path === "" ? [] : path.slice(1).split("/");
    const parts = encoded.map(part => part.replace(/~1/g, "/").replace(/~0/g, "~"));
    const type = resourceType.toLowerCase();
    const last = parts.at(-1);
    const configuration = last === undefined ? undefined
      : publicConfigurationValue(type, path.slice(0, path.lastIndexOf("/")), last, value);
    const sensitive = parts.findIndex((part, index) => secretValue(part)
      || (secretKey(part) && !(index === parts.length - 1 && (configuration !== undefined || typeof value === "boolean"))));
    if (sensitive >= 0) return { path: `/${[...encoded.slice(0, sensitive), "[redacted]"].join("/")}`, value: "[redacted]" };
    if (last !== undefined && /^(?:value|defaultvalue)$/i.test(last)) return { path, value: "[redacted]" };
    return { path, value: configuration ?? safeValue(value, path, type) };
  } catch { throw new ScanDiffError("invalid-snapshot"); }
}

function load(snapshot: SavedScanSnapshot): { source: SourceScan; resources: Map<string, InventoryResource> } {
  try {
    assertJson(snapshot.inventory);
    const inventory = parseScanInventory(snapshot.inventory);
    const source = toCompletionSourceScan(snapshot.scan, inventory);
    if (source.completeness.reasons.some(reason => reason === "invalid-data")) throw new ScanDiffError("invalid-snapshot");
    if (inventory.resources.some(resource => secretValue(resource.id))) throw new ScanDiffError("invalid-snapshot");
    const resources = new Map(inventory.resources.map(resource => [canonicalId(resource.id), resource]));
    if (resources.size !== inventory.resources.length) throw new ScanDiffError("invalid-snapshot");
    return { source, resources };
  } catch { throw new ScanDiffError("invalid-snapshot"); }
}

const present = (value: JsonValue): Observation => ({ state: "present", value });
const missing: Observation = { state: "missing" };
type PropertyChange = Extract<ScanDiff["changes"][number], { kind: "changed" }>["properties"][number];
function changesBetween(before: JsonValue, after: JsonValue, path: string, result: PropertyChange[]): void {
  if (JSON.stringify(before) === JSON.stringify(after)) return;
  // 집합 컬렉션은 전체 필드 근거로 남긴다. 정렬한 인덱스를 원본 경로로 오인하지 않는다.
  if (["securityRules", "defaultSecurityRules", "zones", "addressPrefixes", "sourceAddressPrefixes", "destinationAddressPrefixes", "sourcePortRanges", "destinationPortRanges"].includes(path.split("/").at(-1)!)
    || /^\/properties\/accessPolicies\/\d+\/permissions\/(?:keys|secrets|certificates|storage)$/.test(path)) {
    result.push({ path, before: present(before), after: present(after) }); return;
  }
  if ((object(before) && object(after)) || (Array.isArray(before) && Array.isArray(after))) {
    const left = before as Record<string, JsonValue>; const right = after as Record<string, JsonValue>;
    const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort(order);
    for (const key of keys) {
      const pointer = `${path}/${key.replace(/~/g, "~0").replace(/\//g, "~1")}`;
      if (!Object.hasOwn(left, key) || !Object.hasOwn(right, key)) result.push({ path: pointer,
        before: Object.hasOwn(left, key) ? present(left[key]) : missing,
        after: Object.hasOwn(right, key) ? present(right[key]) : missing });
      else changesBetween(left[key], right[key], pointer, result);
    }
  } else result.push({ path, before: present(before), after: present(after) });
}

function absenceReasons(source: SourceScan, resourceId: string): CompletionReasonCode[] {
  const reasons = [...source.completeness.reasons];
  if (!source.subscriptionIds.includes(resourceId.split("/")[2]) && !reasons.includes("scope-not-collected")) reasons.push("scope-not-collected");
  return reasons;
}

/** 명시한 저장 스캔만 비교한다. 시계·DB·모델·Azure에 의존하지 않는다. */
export function compareScans(baseline: SavedScanSnapshot, comparison: SavedScanSnapshot, comparedAt: string): ScanDiff {
  const a = load(baseline); const b = load(comparison);
  if (a.source.workspaceId !== b.source.workspaceId) throw new ScanDiffError("workspace-mismatch");
  if (a.source.id === b.source.id) throw new ScanDiffError("same-scan");
  if (!Number.isFinite(Date.parse(comparedAt)) || Date.parse(a.source.collectedAt) > Date.parse(b.source.collectedAt)
    || Date.parse(comparedAt) < Date.parse(b.source.collectedAt)) throw new ScanDiffError("invalid-time");
  const ids = [...new Set([...a.resources.keys(), ...b.resources.keys()])].sort(order);
  const changes: ScanDiff["changes"] = [];
  for (const resourceId of ids) {
    const before = a.resources.get(resourceId); const after = b.resources.get(resourceId);
    if (!before || !after) {
      const reasons = absenceReasons(!before ? a.source : b.source, resourceId);
      changes.push(reasons.length ? { kind: "unknown", resourceId, reasons }
        : { kind: !before ? "added" : "removed", resourceId });
      continue;
    }
    // Subnet children lack the tags/SKU/zones/kind/managedBy metadata surface
    // of top-level resources. Their properties and inherited location are observed.
    const comparedFields: InventoryObservedField[] = before.type === "microsoft.network/virtualnetworks/subnets"
      ? ["properties", "location"] : fields;
    const unavailable = comparedFields.some(field => !before.observedFields?.includes(field) || !after.observedFields?.includes(field));
    if (unavailable) {
      changes.push({ kind: "unknown", resourceId, reasons: [before.observedFields === undefined || after.observedFields === undefined
        ? "legacy-completeness-unknown" : "missing-data"] });
      continue;
    }
    const properties: PropertyChange[] = [];
    for (const field of comparedFields) changesBetween(safeValue(before[field], `/${field}`, before.type.toLowerCase()), safeValue(after[field], `/${field}`, after.type.toLowerCase()), `/${field}`, properties);
    // 이름은 ARM ID와 같은 대소문자 변경을 무시한다. 분류·부모 ID는 정규화된다.
    for (const field of ["name", "type", "resourceGroup", "subscriptionId", "parentId"] as const) {
      const normalize = (value: string | null) => value === null ? null : value.trim().toLowerCase();
      changesBetween(safeValue(normalize(before[field])), safeValue(normalize(after[field])), `/${field}`, properties);
    }
    if (properties.length) changes.push({ kind: "changed", resourceId, properties });
  }
  const counts = { added: 0, removed: 0, changed: 0, unknown: 0 };
  for (const change of changes) counts[change.kind]++;
  const excluded = new Map<CompletionReasonCode, number>();
  for (const change of changes) if (change.kind === "unknown") {
    const code = change.reasons[0]; excluded.set(code, (excluded.get(code) ?? 0) + 1);
  }
  const result = scanDiffSchema.safeParse({ schemaVersion: 1, workspaceId: a.source.workspaceId,
    baselineScan: a.source, comparisonScan: b.source, comparedAt,
    coverage: { total: ids.length, included: ids.length - counts.unknown, excluded: counts.unknown,
      reasons: [...excluded].sort(([x], [y]) => order(x, y)).map(([code, count]) => ({ code, count })) }, counts, changes });
  if (!result.success) throw new ScanDiffError("invalid-time");
  return result.data;
}
