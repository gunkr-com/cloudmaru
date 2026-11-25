import type { InventoryResource } from "@/types/inventory";
import type { NSGRule, PathVerdict } from "@/types/network";
import type { NetworkReasonCode } from "@/types/network-diagnostics";
import { parsePrefix, prefixContains, prefixesOverlap } from "./cidr";
import { addressPrefixMatchesTag, isServiceTag, serviceTagReason } from "./service-tags";

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function ruleValue(value: unknown): string | readonly string[] | null {
  if (typeof value === "string") return value;
  return Array.isArray(value) && value.every(item => typeof item === "string") ? value : null;
}
function singularOrPlural(props: Record<string, unknown>, singular: string, plural: string) {
  // ARM 내보내기는 복수 값 옆에 빈 단수 필드를 함께 둘 수 있다.
  return ruleValue(props[singular] === "" || props[singular] == null ? props[plural] : props[singular]);
}
function invalidRule(code: NetworkReasonCode, path: string): NSGRule {
  return { direction: "", access: "", priority: NaN, name: "", diagnostic: { reasonCodes: [code], propertyPaths: [path] } };
}
function parseSingleNsgRule(value: unknown, path: string): NSGRule {
  const raw = object(value);
  if (!raw) return invalidRule("nsg-rule-malformed", path);
  const props = object(raw.properties) ?? raw;
  const priority = typeof props.priority === "number" ? props.priority : NaN;
  const rule: NSGRule = {
    direction: typeof props.direction === "string" ? props.direction.toLowerCase() : "",
    access: typeof props.access === "string" ? props.access.toLowerCase() : "",
    priority, name: typeof raw.name === "string" ? raw.name : "",
    sourceAddressPrefix: singularOrPlural(props, "sourceAddressPrefix", "sourceAddressPrefixes"),
    destinationAddressPrefix: singularOrPlural(props, "destinationAddressPrefix", "destinationAddressPrefixes"),
    sourcePortRange: singularOrPlural(props, "sourcePortRange", "sourcePortRanges"),
    destinationPortRange: singularOrPlural(props, "destinationPortRange", "destinationPortRanges"),
    protocol: typeof props.protocol === "string" ? props.protocol : null,
  };
  const reasonCodes: NetworkReasonCode[] = [];
  if (!validPriority(priority) || (path.startsWith("/properties/securityRules/") && priority > 4096)) reasonCodes.push("nsg-rule-priority-invalid");
  if (!["inbound", "outbound"].includes(rule.direction) || !["allow", "deny"].includes(rule.access)) reasonCodes.push("nsg-rule-malformed");
  if (["sourceApplicationSecurityGroups", "destinationApplicationSecurityGroups"].some(key =>
    Object.hasOwn(props, key) && (!Array.isArray(props[key]) || props[key].length > 0))) reasonCodes.push("asg-membership-unresolved");
  return { ...rule, diagnostic: { reasonCodes, propertyPaths: [path] } };
}
function validPriority(priority: number): boolean {
  return Number.isInteger(priority) && priority >= 100 && (priority <= 4096 || [65000, 65001, 65500].includes(priority));
}
export function parseNsgRules(resource: InventoryResource): NSGRule[] {
  return ["securityRules", "defaultSecurityRules"].flatMap(key => {
    const value = resource.properties[key];
    if (key === "defaultSecurityRules" && value === undefined) return [];
    return Array.isArray(value) ? value.map((raw, i) => parseSingleNsgRule(raw, `/properties/${key}/${i}`))
      : [invalidRule("nsg-rules-not-collected", `/properties/${key}`)];
  });
}

export function azureDefaultNsgRules(): NSGRule[] {
  return [
    ["inbound", "allow", 65000, "AllowVnetInBound", "VirtualNetwork", "VirtualNetwork"],
    ["inbound", "allow", 65001, "AllowAzureLoadBalancerInBound", "AzureLoadBalancer", "*"],
    ["inbound", "deny", 65500, "DenyAllInBound", "*", "*"],
    ["outbound", "allow", 65000, "AllowVnetOutBound", "VirtualNetwork", "VirtualNetwork"],
    ["outbound", "allow", 65001, "AllowInternetOutBound", "*", "Internet"],
    ["outbound", "deny", 65500, "DenyAllOutBound", "*", "*"],
  ].map(([direction, access, priority, name, sourceAddressPrefix, destinationAddressPrefix]) => ({
    direction: String(direction), access: String(access), priority: Number(priority), name: String(name),
    sourceAddressPrefix: String(sourceAddressPrefix), destinationAddressPrefix: String(destinationAddressPrefix),
    sourcePortRange: "*", destinationPortRange: "*", protocol: "*",
  }));
}

export function rulesWithAzureDefaults(resource: InventoryResource): NSGRule[] {
  const rules = parseNsgRules(resource);
  const names = new Set(rules.map(rule => rule.name.toLowerCase()));
  return [...rules, ...azureDefaultNsgRules().filter(rule => !names.has(rule.name.toLowerCase()))];
}

export type NsgQuery = Readonly<{
  direction: string;
  protocol?: string | null;
  sourceAddressPrefix?: string | null;
  destinationAddressPrefix?: string | null;
  sourcePort?: number | null;
  destinationPort?: number | null;
  virtualNetworkPrefixes?: readonly string[] | null;
  virtualNetworkComplete?: boolean;
}>;
type Match = { state: boolean | null; reasons: NetworkReasonCode[] };
const match = (state: boolean | null, ...reasons: NetworkReasonCode[]): Match => ({ state, reasons });
function protocolMatch(rule: NSGRule["protocol"], query: NsgQuery["protocol"]): Match {
  if (!rule || !["*", "any", "tcp", "udp", "icmp", "esp", "ah"].includes(rule.toLowerCase())) return match(null, "nsg-rule-malformed");
  if (["*", "any"].includes(rule.toLowerCase())) return match(true);
  if (!query || ["*", "any"].includes(query.toLowerCase())) return match(null, "query-field-unspecified");
  return match(rule.toLowerCase() === query.toLowerCase());
}
function portMatch(rule: NSGRule["sourcePortRange"], query: number | null | undefined): Match {
  const values = typeof rule === "string" ? rule.split(",") : rule;
  if (!values?.length) return match(null, "nsg-rule-malformed");
  const ranges = values.map(value => {
    const text = value.trim();
    if (text === "*") return [0, 65535];
    const parts = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(text);
    if (!parts) return null;
    const low = Number(parts[1]), high = Number(parts[2] ?? parts[1]);
    return low <= high && high <= 65535 ? [low, high] : null;
  });
  if (ranges.some(range => range === null)) return match(null, "nsg-rule-malformed");
  if (ranges.some(range => range![0] === 0 && range![1] === 65535)) return match(true);
  if (query == null) return match(null, "query-field-unspecified");
  return match(ranges.some(range => range![0] <= query && query <= range![1]));
}
function prefixMatch(prefixes: readonly string[], query: string): Match {
  if (!prefixes.length || prefixes.some(prefix => !parsePrefix(prefix))) return match(null, "virtual-network-scope-incomplete");
  if (prefixes.some(prefix => prefixContains(prefix, query) === true)) return match(true);
  return prefixes.some(prefix => prefixesOverlap(prefix, query) === true)
    ? match(null, "nsg-rule-precedence-ambiguous") : match(false);
}
function addressMatch(rule: NSGRule["sourceAddressPrefix"], requested: string | null | undefined, query: NsgQuery): Match {
  const values = typeof rule === "string" ? [rule] : rule;
  if (!values?.length) return match(null, "nsg-rule-malformed");
  const states = values.map(value => {
    const text = value.trim().toLowerCase();
    if (text === "*") return match(true);
    if (!text) return match(null, "nsg-rule-malformed");
    if (!requested) return match(null, "endpoint-address-unresolved");
    if (text === "virtualnetwork") {
      const known = prefixMatch(query.virtualNetworkPrefixes ?? [], requested);
      // 알려진 대역의 소속은 다른 피어 누락으로 사라지지 않는다. 불일치 확정에는 전체 범위가 필요하다.
      return known.state === true || query.virtualNetworkComplete !== false
        ? known : match(null, "virtual-network-scope-incomplete");
    }
    if (isServiceTag(text)) {
      const state = addressPrefixMatchesTag(text, requested);
      return state === null ? match(null, ["internet", "azureloadbalancer"].includes(text) ? "nsg-rule-precedence-ambiguous" : serviceTagReason(text)) : match(state);
    }
    if (!parsePrefix(text)) return match(null, text.includes("/") || /^[0-9.:]+$/.test(text) ? "nsg-rule-malformed" : "service-tag-unsupported");
    if (prefixContains(text, requested) === true) return match(true);
    return prefixesOverlap(text, requested) === true ? match(null, "nsg-rule-precedence-ambiguous") : match(false);
  });
  // 일치 항목이 있어도 잘못된 값은 조용히 버리지 않는다.
  if (states.some(state => state.reasons.includes("nsg-rule-malformed"))) return match(null, "nsg-rule-malformed");
  return states.find(state => state.state === true) ?? states.find(state => state.state === null) ?? match(false);
}
function ruleMatch(rule: NSGRule, query: NsgQuery): Match {
  if (["inbound", "outbound"].includes(rule.direction) && rule.direction !== query.direction) return match(false);
  const errors = [...(rule.diagnostic?.reasonCodes ?? [])];
  if (!validPriority(rule.priority)) errors.push("nsg-rule-priority-invalid");
  if (!["inbound", "outbound"].includes(rule.direction) || !["allow", "deny"].includes(rule.access)) errors.push("nsg-rule-malformed");
  if (errors.some(code => code !== "asg-membership-unresolved")) return match(null, ...new Set(errors));
  const traffic = [protocolMatch(rule.protocol, query.protocol), portMatch(rule.sourcePortRange, query.sourcePort),
    portMatch(rule.destinationPortRange, query.destinationPort)];
  if (errors.length) {
    // ASG 소속만 불확실하면 독립적인 프로토콜·포트 불일치로 이 규칙을 제외할 수 있다.
    if (traffic.some(state => state.reasons.includes("nsg-rule-malformed"))) return match(null, "nsg-rule-malformed", ...new Set(errors));
    if (traffic.some(state => state.state === false)) return match(false);
    return match(null, ...new Set([...errors, ...traffic.flatMap(state => state.reasons)]));
  }
  const states = [...traffic, addressMatch(rule.sourceAddressPrefix, query.sourceAddressPrefix, query),
    addressMatch(rule.destinationAddressPrefix, query.destinationAddressPrefix, query)];
  if (states.some(state => state.reasons.includes("nsg-rule-malformed"))) return match(null, "nsg-rule-malformed");
  if (states.some(state => state.state === false)) return match(false);
  return match(states.every(state => state.state === true) ? true : null, ...new Set(states.flatMap(state => state.reasons)));
}
export type NsgVerdictDetail = Readonly<{
  verdict: PathVerdict; rule: NSGRule | null; rules: readonly NSGRule[]; reasonCodes: readonly NetworkReasonCode[];
}>;
export function diagnoseNsgVerdict(rules: readonly NSGRule[], query: NsgQuery): NsgVerdictDetail {
  const result = (verdict: PathVerdict, rule: NSGRule | null, involved: readonly NSGRule[], codes: readonly NetworkReasonCode[]): NsgVerdictDetail =>
    ({ verdict, rule, rules: involved, reasonCodes: [...new Set(codes)] });
  if (!["inbound", "outbound"].includes(query.direction) || [query.sourcePort, query.destinationPort].some(port =>
    port != null && (!Number.isInteger(port) || port < 0 || port > 65535)) || [query.sourceAddressPrefix, query.destinationAddressPrefix].some(prefix => prefix != null && !parsePrefix(prefix))
    || (query.protocol != null && !["tcp", "udp", "icmp", "esp", "ah", "*", "any"].includes(query.protocol.toLowerCase())))
    return result("unknown", null, [], ["invalid-data"]);
  const candidates = rules.map(rule => ({ rule, ...ruleMatch(rule, query) })).filter(item => item.state !== false)
    .sort((a, b) => (validPriority(a.rule.priority) && !a.reasons.includes("nsg-rule-priority-invalid") ? a.rule.priority : -1) - (validPriority(b.rule.priority) && !b.reasons.includes("nsg-rule-priority-invalid") ? b.rule.priority : -1));
  const uncertain: typeof candidates = [];
  for (const item of candidates) {
    const samePriority = rules.filter(other => other.direction === item.rule.direction && other.priority === item.rule.priority);
    if (samePriority.length > 1) return result("unknown", null, [...uncertain.map(x => x.rule), ...samePriority], ["nsg-rule-priority-duplicate", ...uncertain.flatMap(x => x.reasons)]);
    if (item.state === null) { uncertain.push(item); continue; }
    if (uncertain.some(other => other.rule.access !== item.rule.access || other.reasons.some(code => ["nsg-rule-malformed", "nsg-rule-priority-invalid", "nsg-rules-not-collected"].includes(code))))
      return result("unknown", null, [...uncertain.map(x => x.rule), item.rule], ["nsg-rule-precedence-ambiguous", ...uncertain.flatMap(x => x.reasons)]);
    return result(item.rule.access === "allow" ? "allowed" : "blocked", item.rule, [...uncertain.map(x => x.rule), item.rule],
      [item.rule.access === "allow" ? "nsg-rule-decisive-allow" : "nsg-rule-decisive-deny"]);
  }
  return result("unknown", null, uncertain.map(x => x.rule), uncertain.length ? uncertain.flatMap(x => x.reasons) : ["missing-data"]);
}
export function matchingNsgRules(rules: readonly NSGRule[], query: NsgQuery): NSGRule[] {
  return rules.filter(rule => ruleMatch(rule, query).state === true).sort((a, b) => a.priority - b.priority);
}
export function firstEffectiveNsgRule(rules: readonly NSGRule[], query: NsgQuery): NSGRule | null {
  return diagnoseNsgVerdict(rules, query).rule;
}
export function classifyNsgVerdict(rules: readonly NSGRule[], query: NsgQuery): PathVerdict {
  return diagnoseNsgVerdict(rules, query).verdict;
}
