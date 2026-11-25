import "server-only";
import { loadExtensionSupportCatalog, getComponentRegionSupport } from "@/lib/catalog/extension-support";
import { parseExtensionSupportCatalog } from "@/lib/catalog/extension-support-schema";
import { buildModelInventoryContext } from "@/lib/completion/model-context";
import { toCompletionSourceScan } from "@/lib/completion/source-scan";
import { canonicalId, isCanonicalArmResourceId } from "@/lib/inventory/normalize";
import { splitSubnets } from "@/lib/inventory/split-subnets";
import { parsePrefix, prefixContains, prefixesOverlap } from "@/lib/network/cidr";
import type { Catalog } from "@/types/catalog";
import type { CompletionReasonCode } from "@/types/completion";
import type { ReusePolicy } from "@/types/extension-support";
import type { InventoryResource } from "@/types/inventory";
import type { ScanRecord, ScanInventory } from "@/types/scan";
import type {
  ReuseCandidate, ReuseCandidates, ReuseContextOptions, ExtensionModelContext, ExtensionModelContextOptions,
} from "@/types/extend-context";

const VNET = "microsoft.network/virtualnetworks";
const SUBNET = `${VNET}/subnets`;
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value)
  ? value as Record<string, unknown> : {};
const invalid = () => { throw new Error("invalid-data"); };

/** 선언된 타입·범위·부모를 ARM 경로와 대조한다. 이름은 후보/모델 근거로 쓰지 않는다. */
function validIdentity(resource: InventoryResource, subscriptions: readonly string[]): boolean {
  const id = canonicalId(resource.id);
  if (!isCanonicalArmResourceId(id)) return false;
  const parts = id.split("/");
  if (parts[2] !== resource.subscriptionId.toLowerCase() || !subscriptions.includes(parts[2])
    || parts[4] !== resource.resourceGroup.toLowerCase()) return false;
  let provider = 5;
  for (let i = 9; i < parts.length; i += 2) if (parts[i] === "providers") provider = i;
  const type = [parts[provider + 1], ...parts.slice(provider + 2).filter((_, i) => i % 2 === 0)].join("/");
  if (type !== resource.type) return false;
  const names = parts.slice(provider + 2).filter((_, i) => i % 2 === 1);
  if (![names.at(-1), names.join("/")].includes(resource.name.toLowerCase())) return false;
  const nested = parts.length > provider + 4;
  const expectedParent = nested ? parts.slice(0, -2).join("/") : null;
  return expectedParent === resource.parentId;
}

/** splitSubnets의 이름 기반 보완 전에 명시된 child identity를 검사한다. 경로 진단 상한은 적용하지 않는다. */
function expandInventory(resources: readonly InventoryResource[]): InventoryResource[] {
  const normalized = resources.map(r => ({ ...r, id: canonicalId(r.id), type: r.type.trim().toLowerCase(),
    parentId: r.parentId === null ? null : canonicalId(r.parentId) }));
  for (const vnet of normalized) {
    if (vnet.type !== VNET || !Object.hasOwn(vnet.properties, "subnets")) continue;
    if (!Array.isArray(vnet.properties.subnets)) invalid();
    const seen = new Set<string>();
    for (const value of vnet.properties.subnets as unknown[]) {
      const raw = object(value);
      if (typeof raw.name !== "string" || !raw.name.trim() || raw.name.includes("/")) invalid();
      const expected = canonicalId(`${vnet.id}/subnets/${raw.name}`);
      if (!isCanonicalArmResourceId(expected)) invalid();
      if (Object.hasOwn(raw, "id") && (typeof raw.id !== "string" || canonicalId(raw.id) !== expected)) invalid();
      if (seen.has(expected)) invalid();
      seen.add(expected);
    }
  }
  return splitSubnets(normalized);
}

/** CIDR 문자열을 호스트 주소나 느슨한 네트워크 근사로 복구하지 않는다. */
function exactPrefixes(raw: unknown): string[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const keys = new Set<string>();
  for (const value of raw) {
    if (typeof value !== "string" || !value.includes("/") || value !== value.trim()) return null;
    const prefix = parsePrefix(value);
    const address = parsePrefix(value.split("/")[0]);
    if (!prefix || !address || prefix.network !== address.network) return null;
    const key = `${prefix.version}:${prefix.network}:${prefix.length}`;
    if (keys.has(key)) return null;
    keys.add(key);
  }
  const prefixes = raw as string[];
  if (prefixes.some((a, i) => prefixes.slice(i + 1).some(b => prefixesOverlap(a, b) === true))) return null;
  return prefixes;
}
function subnetPrefixes(resource: InventoryResource): string[] | null {
  const p = resource.properties;
  if (Object.hasOwn(p, "addressPrefixes") && Object.hasOwn(p, "addressPrefix")) return null;
  return exactPrefixes(Object.hasOwn(p, "addressPrefixes") ? p.addressPrefixes
    : Object.hasOwn(p, "addressPrefix") ? [p.addressPrefix] : undefined);
}
function vnetPrefixes(resource: InventoryResource): string[] | null {
  return exactPrefixes(object(resource.properties.addressSpace).addressPrefixes);
}

function conditionFailure(
  resource: InventoryResource, policy: ReusePolicy, componentId: string, index: Map<string, InventoryResource>,
  resources: readonly InventoryResource[],
): CompletionReasonCode | null {
  if (policy.conditions.includes("linux-required")) {
    if (!Object.hasOwn(resource.properties, "reserved")) return "missing-data";
    if (resource.properties.reserved !== true) return "invalid-data";
  }
  if (policy.conditions.includes("sku-match")) {
    if (!resource.sku || !Object.hasOwn(resource.sku, "name")) return "missing-data";
    if (resource.sku.name !== policy.skuByComponent?.[componentId]) return "invalid-data";
  }
  if (resource.type === VNET && !vnetPrefixes(resource)) return "missing-data";
  if (resource.type === SUBNET || policy.conditions.includes("parent-inventory")) {
    const parent = resource.parentId ? index.get(resource.parentId) : undefined;
    if (!parent) return "missing-data";
    if (parent.type !== VNET || resource.type !== SUBNET || resource.id !== `${parent.id}/subnets/${resource.id.split("/").at(-1)}`
      || parent.location !== resource.location) return "invalid-data";
    const outer = vnetPrefixes(parent);
    const inner = subnetPrefixes(resource);
    if (!outer || !inner) return "missing-data";
    if (!inner.every(prefix => outer.some(container => prefixContains(container, prefix) === true))) return "invalid-data";
    // 중복 표현은 splitSubnets가 합친다. 다른 저장 형제와 겹치거나 형제 근거가 없으면 승인하지 않는다.
    for (const sibling of resources) {
      if (sibling.id === resource.id) continue;
      if (!sibling.id.startsWith(`${parent.id}/subnets/`) && !(sibling.type === SUBNET && sibling.parentId === parent.id)) continue;
      if (!index.has(sibling.id)) return "invalid-data";
      const prefixes = subnetPrefixes(sibling);
      if (!prefixes) return "missing-data";
      if (inner.some(a => prefixes.some(b => prefixesOverlap(a, b) === true))) return "invalid-data";
    }
  }
  if (policy.conditions.includes("delegation-verified")) {
    if (!Object.hasOwn(resource.properties, "delegations")) return "missing-data";
    if (!Array.isArray(resource.properties.delegations)) return "invalid-data";
    // 현재 검토된 카탈로그는 일반(미위임) subnet만 식별한다. 서비스별 위임 호환성을 추측하지 않는다.
    if (resource.properties.delegations.length !== 0) return "not-supported";
  }
  return null;
}

/** 저장 스캔 전체에서 후보를 판정한다. 모델 facts/현재 쿠키/최신 스캔은 증거가 아니다. */
export function computeReuseCandidates(
  scan: ScanRecord, inventory: ScanInventory, catalog: Catalog, options: ReuseContextOptions,
): ReuseCandidates {
  const sourceScan = toCompletionSourceScan(scan, inventory);
  const support = parseExtensionSupportCatalog(options.support ?? loadExtensionSupportCatalog(), catalog);
  if (support.reusePolicies.some(p => p.additionalUsage !== "metered" && p.componentIds.some(id => {
    const c = catalog.components.find(c => c.id === id)!;
    return c.pricing.kind === "metered" && c.usage !== undefined;
  }))) invalid();
  const resources = expandInventory(inventory.resources);
  const frequencies = new Map<string, number>();
  for (const r of resources) frequencies.set(r.id, (frequencies.get(r.id) ?? 0) + 1);
  const valid = (r: InventoryResource) => frequencies.get(r.id) === 1 && validIdentity(r, sourceScan.subscriptionIds);
  const index = new Map(resources.filter(valid).map(r => [r.id, r]));
  const candidates: ReuseCandidate[] = [];
  for (const resource of [...resources].sort((a, b) => compare(a.id, b.id))) {
    const policies = support.reusePolicies.filter(p => p.resourceTypes.includes(resource.type));
    if (!valid(resource) || policies.length === 0) {
      candidates.push({ resourceId: resource.id, componentId: null, policyId: null,
        eligibility: valid(resource) ? "unsupported" : "unknown", reasonCodes: [valid(resource) ? "unsupported-type" : "invalid-data"],
        capacity: "unverified", additionalUsage: null, notes: null });
      continue;
    }
    for (const policy of policies) for (const componentId of policy.componentIds) {
      const component = catalog.components.find(c => c.id === componentId)!;
      if (!component.bicepResourceTypes.some(t => t.toLowerCase() === resource.type)) continue;
      const candidate: ReuseCandidate = { resourceId: resource.id, componentId, policyId: policy.id,
        eligibility: "unknown", reasonCodes: [], capacity: "unverified", additionalUsage: policy.additionalUsage, notes: policy.notes };
      const regional = getComponentRegionSupport(support, componentId, options.region);
      if (!regional || regional.status !== "supported") candidate.reasonCodes = ["unsupported-region"];
      else if (!resource.location || !/^[a-z][a-z0-9]+$/.test(resource.location)) candidate.reasonCodes = ["missing-data"];
      else if (resource.location !== options.region) {
        candidate.eligibility = "unsupported"; candidate.reasonCodes = ["unsupported-region"];
      } else {
        const failure = conditionFailure(resource, policy, componentId, index, resources);
        if (failure) candidate.reasonCodes = [failure];
        else { candidate.eligibility = "supported"; candidate.reasonCodes = ["capacity-unverified"]; }
      }
      candidates.push(candidate);
    }
  }
  return { sourceScan, resources, candidates };
}

/** 반환 payload만 모델로 보낸다. 식별자 mapping은 서버 전용·비열거 속성으로 보존한다. */
export function buildExtensionModelContext(
  scan: ScanRecord, inventory: ScanInventory, catalog: Catalog, options: ExtensionModelContextOptions,
): ExtensionModelContext {
  const support = options.support ?? loadExtensionSupportCatalog();
  const result = computeReuseCandidates(scan, inventory, catalog, { ...options, support });
  const invalidIds = new Set(result.candidates.filter(c => c.reasonCodes.includes("invalid-data") && c.policyId === null).map(c => c.resourceId));
  const context = buildModelInventoryContext(result.resources.map(r => invalidIds.has(r.id) ? { ...r, id: "" } : r), {
    supportedResourceTypes: [...new Set(support.reusePolicies.flatMap(p => p.resourceTypes))],
    allowedLocations: support.regions.map(r => r.id),
    relevantResourceIds: options.relevantResourceIds, maxResources: options.maxResources,
  });
  const byId = new Map([...context.aliasToResourceId].map(([alias, id]) => [id, alias]));
  const payload: ExtensionModelContext["payload"] = { schemaVersion: 1, inventory: context.payload,
    candidates: result.candidates.flatMap(candidate => {
      const alias = byId.get(candidate.resourceId);
      return alias ? [{ alias, componentId: candidate.componentId, policyId: candidate.policyId,
        eligibility: candidate.eligibility, reasonCodes: candidate.reasonCodes,
        capacity: candidate.capacity, additionalUsage: candidate.additionalUsage }] : [];
    }) };
  return Object.defineProperty({ payload }, "aliasToResourceId", { value: context.aliasToResourceId, enumerable: false }) as ExtensionModelContext;
}
