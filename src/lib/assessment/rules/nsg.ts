import { parsePrefix, prefixLastAddress } from "@/lib/network/cidr";
import { canonicalId, isCanonicalArmResourceId } from "@/lib/inventory/normalize";
import type { CompletionReasonCode } from "@/types/completion";
import type { FindingVerdict } from "@/types/assessment";

type Interval = readonly [bigint, bigint];
type Box = { family: 4 | 6; axes: Interval[] };
type ParsedRule = { priority: number; inbound: boolean; tcp: boolean; allow: boolean; broad: boolean; symbolic: boolean; asg: boolean; limitedSource: boolean; boxes: Box[] };
export type ManagementResult = { verdict: FindingVerdict; reasonCode: CompletionReasonCode | null };
const unknown = (reasonCode: CompletionReasonCode): ManagementResult => ({verdict: "unknown", reasonCode});
const result = (verdict: FindingVerdict): ManagementResult => ({verdict, reasonCode: null});
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
class RuleError extends Error {
  constructor(readonly code: CompletionReasonCode) { super(code); }
}
function values(p: Record<string, unknown>, single: string, plural: string): string[] {
  const a = p[single], b = p[plural];
  if (a !== undefined && b !== undefined && !(Array.isArray(b) && b.length === 0)) throw new RuleError("invalid-data");
  if (a === undefined && b === undefined) throw new RuleError("missing-data");
  const list = a !== undefined ? [a] : b;
  if (!Array.isArray(list) || list.length === 0 || list.some(v => typeof v !== "string" || !v.length)) throw new RuleError("invalid-data");
  return list as string[];
}
function ports(values: string[]): Interval[] {
  return values.map(v => {
    if (v === "*") return [BigInt(0), BigInt(65535)];
    if (!/^\d+(?:-\d+)?$/.test(v)) throw new RuleError("invalid-data");
    const [a, b = a] = v.split("-").map(Number);
    if (a > b || b > 65535 || !Number.isSafeInteger(b)) throw new RuleError("invalid-data");
    return [BigInt(a), BigInt(b)];
  });
}
type Address = { family: 4 | 6; range: Interval; category: Interval; broad: boolean; symbolic?: boolean; limited?: boolean };
function symbolicAddresses(limited = false): Address[] {
  return ([4, 6] as const).map(family => ({family,
    range: [BigInt(0), (BigInt(1) << BigInt(family === 4 ? 32 : 128)) - BigInt(1)] as Interval,
    category: [BigInt(0), BigInt(1)] as Interval, broad: false, symbolic: true, limited}));
}
function addresses(values: string[]): Address[] {
  return values.flatMap(v => {
    if (v === "*" || v === "Internet") return ([4, 6] as const).map(family => ({family,
      range: [BigInt(0), (BigInt(1) << BigInt(family === 4 ? 32 : 128)) - BigInt(1)] as Interval,
      category: [BigInt(0), v === "Internet" ? BigInt(0) : BigInt(1)] as Interval, broad: true}));
    const prefix = parsePrefix(v);
    if (!prefix) {
      if (!/^[a-z][a-z0-9.]*$/i.test(v)) throw new RuleError("invalid-data");
      // Envelope only: never treat this approximation as an observed service-tag range.
      return symbolicAddresses(v === "VirtualNetwork" || v === "AzureLoadBalancer");
    }
    return [{family: prefix.version, range: [prefix.network, prefixLastAddress(prefix)] as Interval,
      category: [BigInt(0), BigInt(1)] as Interval, broad: prefix.length === 0}];
  });
}
function parseRule(raw: unknown, defaults: boolean): ParsedRule {
  if (!object(raw) || !object(raw.properties)) throw new RuleError("invalid-data");
  const p = raw.properties;
  const priority = p.priority;
  if (!Number.isInteger(priority) || typeof priority !== "number" || priority < (defaults ? 65000 : 100)
    || priority > (defaults ? 65500 : 4096)) throw new RuleError("invalid-data");
  if (!['Inbound', 'Outbound'].includes(p.direction as string) || !['Allow', 'Deny'].includes(p.access as string)
    || !['Tcp', 'Udp', 'Icmp', 'Esp', 'Ah', '*'].includes(p.protocol as string)) throw new RuleError("invalid-data");
  let asg = false;
  function ruleAddresses(side: "source" | "destination"): Address[] {
    const groups = p[`${side}ApplicationSecurityGroups`];
    if (groups !== undefined && !Array.isArray(groups)) throw new RuleError("invalid-data");
    if (!Array.isArray(groups) || groups.length === 0) return addresses(values(p, `${side}AddressPrefix`, `${side}AddressPrefixes`));
    if (groups.some(group => !object(group) || typeof group.id !== "string"
      || !isCanonicalArmResourceId(canonicalId(group.id))
      || !/\/providers\/microsoft\.network\/applicationsecuritygroups\/[^/]+$/.test(canonicalId(group.id)))) throw new RuleError("missing-data");
    const single = p[`${side}AddressPrefix`], plural = p[`${side}AddressPrefixes`];
    if (single !== undefined && single !== null && single !== ""
      || plural !== undefined && (!Array.isArray(plural) || plural.length > 0)) throw new RuleError("invalid-data");
    asg = true;
    return symbolicAddresses();
  }
  const src = ruleAddresses("source");
  const dst = ruleAddresses("destination");
  const sp = ports(values(p, "sourcePortRange", "sourcePortRanges"));
  const dp = ports(values(p, "destinationPortRange", "destinationPortRanges"));
  const boxes: Box[] = [];
  for (const s of src) for (const d of dst) for (const a of sp) for (const b of dp) {
    if (s.family === d.family) boxes.push({family: s.family, axes: [s.range, d.range, a, b, s.category, d.category]});
    if (boxes.length > 4096) throw new RuleError("context-limit");
  }
  if (!boxes.length) throw new RuleError("invalid-data");
  return {priority, inbound: p.direction === "Inbound", tcp: p.protocol === "Tcp" || p.protocol === "*",
    allow: p.access === "Allow", broad: src.some(s => s.broad), symbolic: [...src, ...dst].some(s => s.symbolic), asg,
    limitedSource: src.every(s => !s.symbolic || s.limited), boxes};
}
function intersection(a: Box, b: Box): Box | null {
  if (a.family !== b.family) return null;
  const axes = a.axes.map(([lo, hi], i) => [lo > b.axes[i][0] ? lo : b.axes[i][0], hi < b.axes[i][1] ? hi : b.axes[i][1]] as Interval);
  return axes.some(([lo, hi]) => lo > hi) ? null : {family: a.family, axes};
}
// 각 차원을 분할해 deny 합집합의 전체 포함을 검사한다. IP 한 점을 표본으로 쓰지 않는다.
function subtract(a: Box, b: Box): Box[] {
  const overlap = intersection(a, b);
  if (!overlap) return [a];
  const rest: Box[] = [];
  const core = {family: a.family, axes: [...a.axes]};
  for (let i = 0; i < core.axes.length; i++) {
    const [lo, hi] = core.axes[i], [cutLo, cutHi] = overlap.axes[i];
    if (lo < cutLo) { const axes = [...core.axes]; axes[i] = [lo, cutLo - BigInt(1)]; rest.push({family: a.family, axes}); }
    if (cutHi < hi) { const axes = [...core.axes]; axes[i] = [cutHi + BigInt(1), hi]; rest.push({family: a.family, axes}); }
    core.axes[i] = overlap.axes[i];
  }
  return rest;
}

/** NSG의 광범위 관리 허용 설정만 판정한다. 연결/인터넷 도달성을 판정하지 않는다. */
export function evaluateManagementPorts(properties: Record<string, unknown>): ManagementResult {
  if (!Object.hasOwn(properties, "securityRules")) return unknown("missing-data");
  if (!Array.isArray(properties.securityRules)) return unknown("invalid-data");
  if (Object.hasOwn(properties, "defaultSecurityRules") && !Array.isArray(properties.defaultSecurityRules)) return unknown("invalid-data");
  let rules: ParsedRule[];
  try {
    rules = [...properties.securityRules.map(r => parseRule(r, false)),
      ...((properties.defaultSecurityRules ?? []) as unknown[]).map(r => parseRule(r, true))].sort((a,b) => a.priority - b.priority);
  } catch (error) { return unknown(error instanceof RuleError ? error.code : "invalid-data"); }
  if (new Set(rules.map(r => `${r.inbound}:${r.priority}`)).size !== rules.length) return unknown("invalid-data");
  let uncertain = false;
  let unsupported: CompletionReasonCode | null = null;
  for (let i = 0; i < rules.length; i++) {
    const candidate = rules[i];
    if (!candidate.inbound || !candidate.tcp || !candidate.allow) continue;
    const management: Box[] = [];
    for (const box of candidate.boxes) for (const port of [BigInt(22), BigInt(3389), BigInt(5985), BigInt(5986)]) {
      if (box.axes[3][0] <= port && port <= box.axes[3][1]) {
        const axes = [...box.axes]; axes[3] = [port, port]; management.push({family: box.family, axes});
      }
    }
    if (!management.length) continue;
    if (!candidate.broad) {
      if (candidate.symbolic && !candidate.limitedSource) unsupported = candidate.asg ? "missing-data" : "unsupported-service-tag";
      continue;
    }
    let remaining = management;
    let overlap = false;
    const earlierDenies = rules.slice(0, i).filter(r => r.inbound && r.tcp && !r.allow);
    for (const earlier of earlierDenies.filter(r => !r.symbolic)) {
      for (const box of earlier.boxes) {
        if (remaining.some(r => intersection(r, box))) overlap = true;
        remaining = remaining.flatMap(r => subtract(r, box));
        if (remaining.length > 4096) return unknown("context-limit");
      }
    }
    if (remaining.length === 0) continue;
    const unresolvedDeny = earlierDenies.find(r => r.symbolic && r.boxes.some(b => remaining.some(a => intersection(a,b))));
    if (unresolvedDeny) {
      unsupported = unresolvedDeny.asg ? "missing-data" : "unsupported-service-tag"; continue;
    }
    // This is an explicit broad-source management allow configuration finding,
    // not proof that an address in a destination service tag is reachable.
    if (!overlap) return result("violation");
    if (candidate.symbolic) { unsupported = candidate.asg ? "missing-data" : "unsupported-service-tag"; continue; }
    uncertain = true;
  }
  return unsupported ? unknown(unsupported) : uncertain ? unknown("missing-data") : result("pass");
}
