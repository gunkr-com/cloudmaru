import "server-only";
import { deterministicCheckSchema, extensionProposalSchema, networkQuerySchema } from "@/lib/completion/schema";
import { toCompletionSourceScan } from "@/lib/completion/source-scan";
import { getComponentRegionSupport } from "@/lib/catalog/extension-support";
import { diagnosePath } from "@/lib/network";
import { parsePrefix, prefixContains, prefixesOverlap } from "@/lib/network/cidr";
import { validateNetworkMembers, validateNetworkEngine } from "@/lib/network-diagnostics/validation";
import { computeReuseCandidates } from "./reuse-context";
import type { ExtensionRequestContext } from "./validate-proposal";
import type { CompletionReasonCode, Evidence } from "@/types/completion";
import type { DeterministicCheck, ExtensionProposal } from "@/types/extension";
import type { InventoryResource } from "@/types/inventory";
import type { NetworkEngineResult, NetworkQuery } from "@/types/network-diagnostics";
import type { ScanInventory, ScanRecord } from "@/types/scan";

const VNET = "microsoft.network/virtualnetworks";
const SUBNET = `${VNET}/subnets`;
function invalid(): never { throw new Error("validation-failed"); }
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value)
  ? value as Record<string, unknown> : {};
const overlap = (a: string[], b: string[]) => a.some(left => b.some(right => prefixesOverlap(left, right) === true));
const contained = (inner: string[], outer: string[]) => inner.every(prefix => outer.some(parent => prefixContains(parent, prefix) === true));

/** 네트워크 경계·semantic duplicate를 검사한다. 호스트 비트를 지워 유효한 입력으로 복구하지 않는다. */
function exactPrefixes(raw: unknown): string[] | null {
  if (!Array.isArray(raw) || !raw.length) return null;
  const keys = new Set<string>();
  for (const value of raw) {
    if (typeof value !== "string" || value !== value.trim() || !value.includes("/")) return null;
    const prefix = parsePrefix(value), address = parsePrefix(value.split("/")[0]);
    if (!prefix || !address || prefix.network !== address.network) return null;
    const key = `${prefix.version}:${prefix.network}:${prefix.length}`;
    if (keys.has(key)) return null;
    keys.add(key);
  }
  const values = raw as string[];
  return values.some((value, i) => overlap([value], values.slice(i + 1))) ? null : values;
}

type State = { verdict: DeterministicCheck["verdict"]; reasons: Set<CompletionReasonCode>; evidence: Evidence[] };
const state = (): State => ({ verdict: "pass", reasons: new Set(), evidence: [] });
function unknown(s: State, reason: CompletionReasonCode) {
  if (s.verdict === "pass") s.verdict = "unknown";
  s.reasons.add(reason);
}
function present(s: State, resourceId: string, propertyPath: string, value: string | string[]) {
  s.evidence.push({ resourceId, propertyPath, observation: { state: "present", value } });
}
function savedPrefixes(s: State, resource: InventoryResource, path: string, raw: unknown, scalar = false): string[] | null {
  const prefixes = exactPrefixes(scalar && raw !== undefined ? [raw] : raw);
  if (prefixes) present(s, resource.id, path, scalar ? raw as string : prefixes);
  else {
    const missing = raw === undefined;
    unknown(s, missing ? "missing-data" : "invalid-data");
    s.evidence.push({ resourceId: resource.id, propertyPath: path,
      observation: missing ? { state: "missing" } : { state: "invalid", reason: "invalid-data" } });
  }
  return prefixes;
}
function subnetPrefixes(s: State, resource: InventoryResource): string[] | null {
  const p = resource.properties;
  if (Object.hasOwn(p, "addressPrefix") && Object.hasOwn(p, "addressPrefixes")) {
    unknown(s, "invalid-data"); return null;
  }
  return Object.hasOwn(p, "addressPrefix")
    ? savedPrefixes(s, resource, "/properties/addressPrefix", p.addressPrefix, true)
    : savedPrefixes(s, resource, "/properties/addressPrefixes", p.addressPrefixes);
}

/**
 * 명시적인 기존 통신만 진단한다. 요구 문장에서 끝점/포트를 추측하거나 주소/가상 NIC를 받지 않는다.
 * 반환값은 기존 경로의 근거이며 미구축 토폴로지의 승인이 아니다.
 */
export function diagnoseExistingExtensionPath(scan: ScanRecord, inventory: ScanInventory, rawQuery: NetworkQuery): NetworkEngineResult {
  try {
    const query = networkQuerySchema.parse(rawQuery);
    const sourceScan = toCompletionSourceScan(scan, inventory);
    if (query.sourceScanId !== sourceScan.id) invalid();
    const resources = validateNetworkMembers(inventory.resources, query);
    return validateNetworkEngine(resources, query, diagnosePath(resources, query, sourceScan));
  } catch { return invalid(); }
}

/** Step2의 검증된 저장 ID 제안과 같은 서버 맥락을 쓴다. 모델 판정·현재 cookie·최신 scan은 입력에 없다. */
export function calculateExtensionChecks(
  rawPlan: ExtensionProposal["plans"][number], context: ExtensionRequestContext,
): DeterministicCheck[] {
  try {
    const plan = extensionProposalSchema.shape.plans.element.parse(rawPlan);
    const { input, scan, inventory, catalog, support } = context;
    const sourceScan = toCompletionSourceScan(scan, inventory);
    if (input.workspaceId !== sourceScan.workspaceId || input.sourceScanId !== sourceScan.id) invalid();
    const { resources, candidates } = computeReuseCandidates(scan, inventory, catalog, { region: input.region, support });
    const index = new Map(resources.map(r => [r.id, r]));
    const resourceIds = plan.reusedResources.map(r => r.resourceId).sort();
    const componentIds = [...new Set([...plan.reusedResources, ...plan.newItems, ...plan.usageIncreases].map(i => i.componentId))].sort();
    const components = new Map(catalog.components.map(c => [c.id, c]));
    for (const id of componentIds) if (!components.has(id) || !support.components.some(c => c.componentId === id)) invalid();
    for (const item of plan.reusedResources) {
      const row = index.get(item.resourceId);
      if (!row || !components.get(item.componentId)!.bicepResourceTypes.some(t => t.toLowerCase() === row.type)
        || candidates.some(c => c.resourceId === row.id && c.policyId === null && c.reasonCodes.includes("invalid-data"))) invalid();
    }
    const finish = (kind: DeterministicCheck["kind"], s: State): DeterministicCheck => {
      // W0 Evidence는 실재 리소스만 가리킨다. 신규안만의 모순에 가상 ID/근거를 붙이지 않는다.
      if (s.verdict === "violation" && !s.evidence.some(e => e.observation.state === "present")) invalid();
      if (s.verdict === "pass" && !s.evidence.some(e => e.observation.state === "present")) unknown(s, "missing-data");
      const evidence = [...new Map(s.evidence.map(e => [JSON.stringify(e), e])).values()];
      return deterministicCheckSchema.parse({ kind, verdict: s.verdict,
        reasonCodes: s.verdict === "unknown" ? [...s.reasons].sort() : [], resourceIds, componentIds, evidence });
    };

    const region = state();
    for (const id of componentIds) if (getComponentRegionSupport(support, id, input.region)?.status !== "supported") unknown(region, "unsupported-region");
    const checkLocation = (row: InventoryResource) => {
      if (!row.location || !/^[a-z][a-z0-9]+$/.test(row.location)) { unknown(region, "missing-data"); return; }
      present(region, row.id, "/location", row.location);
      if (row.location !== input.region) region.verdict = "violation";
    };
    for (const id of resourceIds) checkLocation(index.get(id)!);
    for (const subnet of plan.subnetProposals) {
      if (subnet.region !== input.region) region.verdict = "violation";
      if (subnet.parent.kind === "existing") checkLocation(index.get(subnet.parent.resourceId) ?? invalid());
    }

    const cidr = state();
    const networks = new Map<string, InventoryResource>();
    for (const id of resourceIds) {
      const row = index.get(id)!;
      if (row.type === VNET) networks.set(row.id, row);
      if (row.type === SUBNET) {
        const parent = row.parentId ? index.get(row.parentId) : undefined;
        if (!parent || parent.type !== VNET) unknown(cidr, "missing-data");
        else { networks.set(parent.id, parent); checkLocation(parent); }
      }
    }
    const spaces = new Map<string, string[]>();
    for (const row of networks.values()) {
      const ranges = savedPrefixes(cidr, row, "/properties/addressSpace/addressPrefixes", object(row.properties.addressSpace).addressPrefixes);
      if (ranges) spaces.set(row.id, ranges);
    }
    const newParents = new Map<string, { ranges: string[]; componentId: string }>();
    const children = new Map<string, string[][]>();
    for (const subnet of plan.subnetProposals) {
      const ranges = exactPrefixes(subnet.addressPrefixes) ?? invalid();
      if (!components.get(subnet.componentId)!.bicepResourceTypes.some(t => t.toLowerCase() === SUBNET)) invalid();
      const parent = subnet.parent;
      const key = parent.kind === "existing" ? parent.resourceId : parent.id;
      let outer: string[] | undefined;
      if (parent.kind === "existing") {
        if (!networks.has(parent.resourceId) || index.get(parent.resourceId)?.type !== VNET) invalid();
        outer = spaces.get(parent.resourceId);
      } else {
        const parentRanges = exactPrefixes(parent.addressPrefixes) ?? invalid();
        if (!components.get(parent.componentId)?.bicepResourceTypes.some(t => t.toLowerCase() === VNET)) invalid();
        newParents.set(parent.id, { ranges: parentRanges, componentId: parent.componentId });
        outer = parentRanges;
      }
      if (outer && !contained(ranges, outer)) cidr.verdict = "violation";
      const previous = children.get(key) ?? [];
      if (previous.some(other => overlap(ranges, other))) cidr.verdict = "violation";
      children.set(key, [...previous, ranges]);
    }
    for (const [key, parent] of networks) {
      const proposed = children.get(key) ?? [];
      // 전체/부모의 수집 근거가 없으면 다른 형제가 없다고 단정하지 않는다.
      if (sourceScan.source !== "live" || sourceScan.completeness.state !== "complete" || !parent.observedFields?.includes("properties")) unknown(cidr, "collection-partial");
      if (!Object.hasOwn(parent.properties, "subnets")) unknown(cidr, "missing-data");
      else if (!Array.isArray(parent.properties.subnets)) unknown(cidr, "invalid-data");
      // embedded-only 서브넷은 아래 부모 JSON Pointer로 증명한다. 저장 행이 없는 합성 ID를 evidence로 내보내지 않는다.
      const siblings = inventory.resources.filter(r => r.type === SUBNET && (r.parentId === key || r.id.startsWith(`${key}/subnets/`)));
      const siblingRanges = new Map<string, string[]>();
      for (const sibling of siblings) {
        const ranges = subnetPrefixes(cidr, sibling);
        if (ranges) {
          if (spaces.has(key) && !contained(ranges, spaces.get(key)!) || proposed.some(p => overlap(p, ranges))) cidr.verdict = "violation";
          siblingRanges.set(sibling.id, ranges);
        }
      }
      // 분리 행이 있어도 embedded 모순을 splitSubnets의 중복 제외로 숨기지 않는다.
      if (Array.isArray(parent.properties.subnets)) for (const [i, raw] of parent.properties.subnets.entries()) {
        const embedded = object(raw), p = object(embedded.properties);
        const hasSingle = Object.hasOwn(p, "addressPrefix"), hasPlural = Object.hasOwn(p, "addressPrefixes");
        if (hasSingle && hasPlural) { unknown(cidr, "invalid-data"); continue; }
        const ranges = savedPrefixes(cidr, parent, `/properties/subnets/${i}/properties/${hasSingle ? "addressPrefix" : "addressPrefixes"}`,
          hasSingle ? p.addressPrefix : p.addressPrefixes, hasSingle);
        if (ranges && (spaces.has(key) && !contained(ranges, spaces.get(key)!) || proposed.some(prefixes => overlap(prefixes, ranges)))) cidr.verdict = "violation";
        const id = typeof embedded.id === "string" ? embedded.id.trim().toLowerCase() : `${parent.id}/subnets/${String(embedded.name).toLowerCase()}`;
        if (ranges) {
          const previous = siblingRanges.get(id);
          if (previous && (!contained(previous, ranges) || !contained(ranges, previous))) unknown(cidr, "invalid-data");
          siblingRanges.set(id, ranges);
        }
      }
      const ranges = [...siblingRanges.values()];
      if (ranges.some((prefixes, i) => ranges.slice(i + 1).some(other => overlap(prefixes, other)))) cidr.verdict = "violation";
    }
    const parents = [...newParents.values()];
    for (const [i, parent] of parents.entries()) {
      if ([...spaces.values()].some(existing => overlap(parent.ranges, existing))
        || parents.slice(i + 1).some(other => overlap(parent.ranges, other.ranges))) cidr.verdict = "violation";
    }
    if (!plan.subnetProposals.length) unknown(cidr, "not-supported");
    // 신규 부모의 비교 범위를 선택하지 않았으면 충돌이 없다고 인정하지 않는다.
    if (newParents.size && (!networks.size || resources.some(resource => resource.type === VNET && !networks.has(resource.id))))
      unknown(cidr, "missing-data");
    const path = state(); unknown(path, "unsupported-path");
    const capacity = state(); unknown(capacity, "capacity-unverified");
    return [finish("region", region), finish("cidr", cidr), finish("path", path), finish("capacity", capacity)];
  } catch { return invalid(); }
}
