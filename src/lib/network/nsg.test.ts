import { describe, expect, it } from "vitest";
import { networkReasonCodeSchema } from "@/lib/completion/schema";
import { parseNsgRules, classifyNsgVerdict, rulesWithAzureDefaults, diagnoseNsgVerdict } from "./nsg";
import { NSG_ID, nsgResource, allowRule, denyRule } from "./fixtures.test-data";
import type { NSGRule } from "@/types/network";

// Valid legacy matching fixtures explicitly describe unconstrained traffic.
const anyTraffic = { protocol: "*", sourceAddressPrefix: "*", destinationAddressPrefix: "*", sourcePortRange: "*", destinationPortRange: "*" };

describe("TestParseNSGRules", () => {
  it("test_empty_nsg_returns_no_rules", () => {
    const nsg = nsgResource(NSG_ID);
    const rules = parseNsgRules(nsg);
    expect(rules).toEqual([]);
  });
  it("test_single_allow_rule_parsed", () => {
    const nsg = nsgResource(NSG_ID, {securityRules: [allowRule()]});
    const rules = parseNsgRules(nsg);
    expect(rules.length).toEqual(1);
    expect(rules[0].direction).toEqual("inbound");
    expect(rules[0].access).toEqual("allow");
    expect(rules[0].priority).toEqual(100);
    expect(rules[0].name).toEqual("allow-rule");
  });
  it("test_single_deny_rule_parsed", () => {
    const nsg = nsgResource(NSG_ID, {securityRules: [denyRule()]});
    const rules = parseNsgRules(nsg);
    expect(rules.length).toEqual(1);
    expect(rules[0].access).toEqual("deny");
  });
  it("test_multiple_rules_parsed", () => {
    const rulesData = [allowRule("allow-https", {priority: 100, destPrefix: "443"}), denyRule("deny-all", {priority: 4000})];
    const nsg = nsgResource(NSG_ID, {securityRules: rulesData});
    const rules = parseNsgRules(nsg);
    expect(rules.length).toEqual(2);
  });
  it("test_default_security_rules_also_parsed", () => {
    const defaults = [denyRule("default-deny-all", {priority: 65500})];
    const nsg = nsgResource(NSG_ID, {defaultRules: defaults});
    const rules = parseNsgRules(nsg);
    expect(rules.length).toEqual(1);
    expect(rules[0].name).toEqual("default-deny-all");
  });
  it("test_custom_and_default_rules_merged", () => {
    const custom = [allowRule("allow-ssh", {priority: 100})];
    const defaults = [denyRule("default-deny", {priority: 65500})];
    const nsg = nsgResource(NSG_ID, {securityRules: custom, defaultRules: defaults});
    const rules = parseNsgRules(nsg);
    expect(rules.length).toEqual(2);
  });
  it("test_malformed_rule_preserved", () => {
    const nsg = nsgResource(NSG_ID, {securityRules: [{"name": "bad-rule", "properties": {"priority": 100}}]});
    const rules = parseNsgRules(nsg);
    expect(rules[0].diagnostic?.reasonCodes).toContain("nsg-rule-malformed");
  });
  it("test_rule_with_missing_priority_is_uncertain", () => {
    const nsg = nsgResource(NSG_ID, {securityRules: [{"name": "no-priority", "properties": {"direction": "Inbound", "access": "Allow"}}]});
    const rules = parseNsgRules(nsg);
    expect(rules.length).toEqual(1);
    expect(rules[0].diagnostic?.reasonCodes).toContain("nsg-rule-priority-invalid");
  });
  it("test_outbound_rule_parsed", () => {
    const nsg = nsgResource(NSG_ID, {securityRules: [allowRule("allow-outbound", {priority: 100, direction: "outbound"})]});
    const rules = parseNsgRules(nsg);
    expect(rules.length).toEqual(1);
    expect(rules[0].direction).toEqual("outbound");
  });
});
describe("TestClassifyNSGVerdict", () => {
  it("test_empty_rules_returns_unknown", () => {
    expect(classifyNsgVerdict([], {direction: "inbound"})).toEqual("unknown");
  });
  it("test_allow_rule_returns_allowed", () => {
    const rules = [{...anyTraffic, direction: "inbound", access: "allow", priority: 100, name: "test"} satisfies NSGRule];
    expect(classifyNsgVerdict(rules, {direction: "inbound"})).toEqual("allowed");
  });
  it("test_deny_rule_returns_blocked", () => {
    const rules = [{...anyTraffic, direction: "inbound", access: "deny", priority: 100, name: "test"} satisfies NSGRule];
    expect(classifyNsgVerdict(rules, {direction: "inbound"})).toEqual("blocked");
  });
  it("test_higher_priority_allow_wins_over_lower_deny", () => {
    const rules = [{...anyTraffic, direction: "inbound", access: "allow", priority: 100, name: "allow-https"} satisfies NSGRule, {...anyTraffic, direction: "inbound", access: "deny", priority: 4000, name: "deny-all"} satisfies NSGRule];
    expect(classifyNsgVerdict(rules, {direction: "inbound"})).toEqual("allowed");
  });
  it("test_higher_priority_deny_wins_over_lower_allow", () => {
    const rules = [{...anyTraffic, direction: "inbound", access: "deny", priority: 100, name: "deny-specific"} satisfies NSGRule, {...anyTraffic, direction: "inbound", access: "allow", priority: 4000, name: "allow-all"} satisfies NSGRule];
    expect(classifyNsgVerdict(rules, {direction: "inbound"})).toEqual("blocked");
  });
  it("test_direction_filtering", () => {
    const rules = [{...anyTraffic, direction: "inbound", access: "allow", priority: 100, name: "in-allow"} satisfies NSGRule, {...anyTraffic, direction: "outbound", access: "deny", priority: 100, name: "out-deny"} satisfies NSGRule];
    expect(classifyNsgVerdict(rules, {direction: "inbound"})).toEqual("allowed");
    expect(classifyNsgVerdict(rules, {direction: "outbound"})).toEqual("blocked");
  });
  it("test_no_matching_direction_returns_unknown", () => {
    const rules = [{...anyTraffic, direction: "outbound", access: "allow", priority: 100, name: "out-allow"} satisfies NSGRule];
    expect(classifyNsgVerdict(rules, {direction: "inbound"})).toEqual("unknown");
  });
  it("test_protocol_filtering_returns_matching_rule", () => {
    const rules = [{...anyTraffic, direction: "inbound", access: "deny", priority: 100, name: "deny-udp", protocol: "Udp"} satisfies NSGRule, {...anyTraffic, direction: "inbound", access: "allow", priority: 200, name: "allow-tcp", protocol: "Tcp"} satisfies NSGRule];
    expect(classifyNsgVerdict(rules, {direction: "inbound", protocol: "Tcp"})).toEqual("allowed");
  });
  it("test_destination_port_filtering_supports_ranges", () => {
    const rules = [{...anyTraffic, direction: "inbound", access: "deny", priority: 100, name: "deny-admin", destinationPortRange: "3389"} satisfies NSGRule, {...anyTraffic, direction: "inbound", access: "allow", priority: 200, name: "allow-web", destinationPortRange: "80-443"} satisfies NSGRule];
    expect(classifyNsgVerdict(rules, {direction: "inbound", destinationPort: 443})).toEqual("allowed");
  });
  it("test_destination_port_filtering_returns_unknown_without_match", () => {
    const rules = [{...anyTraffic, direction: "inbound", access: "allow", priority: 100, name: "allow-https", destinationPortRange: "443"} satisfies NSGRule];
    expect(classifyNsgVerdict(rules, {direction: "inbound", destinationPort: 8443})).toEqual("unknown");
  });
  it("test_source_port_filtering_supports_ranges", () => {
    const rules = [{...anyTraffic, direction: "inbound", access: "deny", priority: 100, name: "deny-admin-source", sourcePortRange: "3389"} satisfies NSGRule, {...anyTraffic, direction: "inbound", access: "allow", priority: 200, name: "allow-ephemeral", sourcePortRange: "49152-65535"} satisfies NSGRule];
    expect(classifyNsgVerdict(rules, {direction: "inbound", sourcePort: 50000})).toEqual("allowed");
    expect(classifyNsgVerdict(rules, {direction: "inbound", sourcePort: 3389})).toEqual("blocked");
  });
  it("test_real_export_style_port_range_lists_are_supported", () => {
    const nsg = nsgResource(NSG_ID, {securityRules: [{"name": "allow-app-ephemeral-to-https", "properties": {"direction": "Inbound", "access": "Allow", "priority": 100, "protocol": "Tcp", "sourceAddressPrefixes": ["10.0.0.0/24", "10.0.1.0/24"], "destinationAddressPrefix": "10.2.0.4/32", "sourcePortRanges": ["49152-65535"], "destinationPortRanges": ["443", "8443"]}}]});
    const rules = parseNsgRules(nsg);
    expect(classifyNsgVerdict(rules, {direction: "inbound", protocol: "Tcp", sourceAddressPrefix: "10.0.1.25/32", destinationAddressPrefix: "10.2.0.4/32", sourcePort: 50000, destinationPort: 443})).toEqual("allowed");
    expect(classifyNsgVerdict(rules, {direction: "inbound", protocol: "Tcp", sourceAddressPrefix: "10.0.1.25/32", destinationAddressPrefix: "10.2.0.4/32", sourcePort: 12345, destinationPort: 443})).toEqual("unknown");
  });
  it("test_empty_prefix_and_port_lists_are_uncertain", () => {
    const rules = [{...anyTraffic, direction: "inbound", access: "allow", priority: 100, name: "allow-empty-list-shape", sourceAddressPrefix: [], destinationAddressPrefix: [], sourcePortRange: [], destinationPortRange: [], protocol: "Tcp"} satisfies NSGRule];
    expect(classifyNsgVerdict(rules, {direction: "inbound", protocol: "Tcp", sourceAddressPrefix: "10.0.1.25/32", destinationAddressPrefix: "10.2.0.4/32", sourcePort: 50000, destinationPort: 443})).toEqual("unknown");
  });
  it("test_partial_default_rules_are_backfilled_with_missing_outbound_defaults", () => {
    const inboundDefaultOnly = [{"name": "AllowVnetInBound", "properties": {"direction": "Inbound", "access": "Allow", "priority": 65000, "sourceAddressPrefix": "VirtualNetwork", "destinationAddressPrefix": "VirtualNetwork", "sourcePortRange": "*", "destinationPortRange": "*", "protocol": "*"}}];
    const nsg = nsgResource(NSG_ID, {defaultRules: inboundDefaultOnly});
    const rules = rulesWithAzureDefaults(nsg);
    expect(classifyNsgVerdict(rules, {direction: "outbound", sourceAddressPrefix: "10.0.1.25/32", destinationAddressPrefix: "10.0.2.25/32", virtualNetworkPrefixes: ["10.0.0.0/16"]})).toEqual("allowed");
  });
  it("test_source_port_filtering_returns_unknown_without_match", () => {
    const rules = [{...anyTraffic, direction: "inbound", access: "allow", priority: 100, name: "allow-ephemeral", sourcePortRange: "49152-65535"} satisfies NSGRule];
    expect(classifyNsgVerdict(rules, {direction: "inbound", sourcePort: 12345})).toEqual("unknown");
  });
  it("test_destination_port_filtering_supports_comma_separated_ranges", () => {
    const rules = [{...anyTraffic, direction: "inbound", access: "allow", priority: 100, name: "allow-web-admin", destinationPortRange: "80,443,1000-1002"} satisfies NSGRule];
    expect(classifyNsgVerdict(rules, {direction: "inbound", destinationPort: 443})).toEqual("allowed");
    expect(classifyNsgVerdict(rules, {direction: "inbound", destinationPort: 1001})).toEqual("allowed");
  });
  it("test_address_prefix_filtering_uses_cidr_containment", () => {
    const rules = [{...anyTraffic, direction: "inbound", access: "allow", priority: 100, name: "allow-spoke", sourceAddressPrefix: "10.0.0.0/16", destinationAddressPrefix: "10.1.0.0/16"} satisfies NSGRule];
    expect(classifyNsgVerdict(rules, {direction: "inbound", sourceAddressPrefix: "10.0.2.4/32", destinationAddressPrefix: "10.1.3.5/32"})).toEqual("allowed");
  });
  it("test_address_prefix_filtering_returns_unknown_without_match", () => {
    const rules = [{...anyTraffic, direction: "inbound", access: "allow", priority: 100, name: "allow-spoke", sourceAddressPrefix: "10.0.0.0/16"} satisfies NSGRule];
    expect(classifyNsgVerdict(rules, {direction: "inbound", sourceAddressPrefix: "10.2.0.4/32"})).toEqual("unknown");
  });
  it("test_virtual_network_tag_uses_context_prefixes_when_available", () => {
    const rules = [{...anyTraffic, direction: "inbound", access: "allow", priority: 65000, name: "AllowVnetInBound", sourceAddressPrefix: "VirtualNetwork", destinationAddressPrefix: "VirtualNetwork"} satisfies NSGRule, {...anyTraffic, direction: "inbound", access: "deny", priority: 65500, name: "DenyAllInBound", sourceAddressPrefix: "*", destinationAddressPrefix: "*"} satisfies NSGRule];
    expect(classifyNsgVerdict(rules, {direction: "inbound", sourceAddressPrefix: "10.0.1.25/32", destinationAddressPrefix: "10.0.2.25/32", virtualNetworkPrefixes: ["10.0.0.0/16"]})).toEqual("allowed");
    expect(classifyNsgVerdict(rules, {direction: "inbound", sourceAddressPrefix: "10.9.1.25/32", destinationAddressPrefix: "10.0.2.25/32", virtualNetworkPrefixes: ["10.0.0.0/16"]})).toEqual("blocked");
  });
  it("test_empty_virtual_network_context_does_not_fall_back_to_broad_static_tag", () => {
    const rules = [{...anyTraffic, direction: "inbound", access: "allow", priority: 100, name: "allow-vnet", sourceAddressPrefix: "VirtualNetwork"} satisfies NSGRule];
    expect(classifyNsgVerdict(rules, {direction: "inbound", sourceAddressPrefix: "10.9.1.25/32", virtualNetworkPrefixes: []})).toEqual("unknown");
  });
  it("test_uncertain_higher_allow_rule_does_not_hide_lower_matching_allow", () => {
    const rules = [{...anyTraffic, direction: "inbound", access: "allow", priority: 100, name: "allow-vnet-empty-context", sourceAddressPrefix: "VirtualNetwork"} satisfies NSGRule, {...anyTraffic, direction: "inbound", access: "allow", priority: 200, name: "allow-explicit-spoke", sourceAddressPrefix: "10.0.0.0/16"} satisfies NSGRule];
    expect(classifyNsgVerdict(rules, {direction: "inbound", sourceAddressPrefix: "10.0.1.25/32", virtualNetworkPrefixes: []})).toEqual("allowed");
  });
});

describe("보수적 판정과 파싱 경계", () => {
  it("모르는 태그의 상위 allow는 하위 deny로 확정하지 않는다", () => {
    const rules: NSGRule[] = [
      { ...anyTraffic, direction: "inbound", access: "allow", priority: 100, name: "unknown", sourceAddressPrefix: "UnknownTag" },
      { ...anyTraffic, direction: "inbound", access: "deny", priority: 200, name: "deny", sourceAddressPrefix: "*" },
    ];
    expect(classifyNsgVerdict(rules, { direction: "inbound", sourceAddressPrefix: "10.0.0.1" })).toBe("unknown");
    expect(classifyNsgVerdict(rules.map(r => ({ ...r, access: r.access === "allow" ? "deny" : "allow" })),
      { direction: "inbound", sourceAddressPrefix: "10.0.0.1" })).toBe("unknown");
  });
  it("규칙 하나만 있어도 모르는 태그는 unknown이다", () => {
    expect(classifyNsgVerdict([{ ...anyTraffic, direction: "inbound", access: "allow", priority: 100, name: "unknown", sourceAddressPrefix: "UnknownTag" }],
      { direction: "inbound", sourceAddressPrefix: "10.0.0.1" })).toBe("unknown");
  });
  it("평면 규칙과 잘못된 배열 원소를 처리하고 원본을 바꾸지 않는다", () => {
    const nsg = nsgResource();
    nsg.properties.securityRules = [null, "bad", [], { name: "flat", direction: "Inbound", access: "Deny", priority: "101" }];
    const before = structuredClone(nsg);
    expect(parseNsgRules(nsg)).toHaveLength(4);
    expect(parseNsgRules(nsg)[3]).toMatchObject({
      name: "flat", direction: "inbound", access: "deny", priority: NaN,
      sourceAddressPrefix: null, destinationAddressPrefix: null, sourcePortRange: null, destinationPortRange: null, protocol: null,
    });
    expect(nsg).toEqual(before);
  });
  it("Azure 기본 규칙 여섯 개를 중복 없이 보충한다", () => {
    const nsg = nsgResource();
    const rules = rulesWithAzureDefaults(nsg);
    expect(rules).toHaveLength(6);
    nsg.properties.defaultSecurityRules = rules.map(r => ({ name: r.name, properties: { ...r, direction: r.direction, access: r.access } }));
    expect(rulesWithAzureDefaults(nsg)).toHaveLength(6);
  });
  it("IPv6와 잘못된 포트 범위를 처리한다", () => {
    const rules: NSGRule[] = [{ ...anyTraffic, direction: "inbound", access: "allow", priority: 100, name: "v6",
      sourceAddressPrefix: ["bad", "fd00::/8"], destinationPortRange: ["bad-443", "443"] }];
    expect(classifyNsgVerdict(rules, { direction: "inbound", sourceAddressPrefix: "fd00::1", destinationPort: 443 })).toBe("unknown");
    expect(classifyNsgVerdict(rules, { direction: "inbound", sourceAddressPrefix: "fd00::1", destinationPort: 80 })).toBe("unknown");
  });
});

describe("malformed query address", () => {
  const rules = parseNsgRules(nsgResource(NSG_ID, { securityRules: [
    allowRule("allow-app", { priority: 100, sourcePrefix: "10.0.0.0/16" }),
    denyRule("deny-all", { priority: 4000 }),
  ] }));
  it("is unknown instead of falling through to a wildcard rule", () => {
    expect(classifyNsgVerdict(rules, { direction: "inbound", protocol: "Tcp", sourceAddressPrefix: "10.0.0.300" })).toBe("unknown");
    expect(classifyNsgVerdict(rules, { direction: "inbound", protocol: "Tcp", destinationAddressPrefix: "not-an-ip" })).toBe("unknown");
  });
  it("leaves valid addresses unchanged", () => {
    expect(classifyNsgVerdict(rules, { direction: "inbound", protocol: "Tcp", sourceAddressPrefix: "10.0.0.4" })).toBe("allowed");
    expect(classifyNsgVerdict(rules, { direction: "inbound", protocol: "Tcp", sourceAddressPrefix: "10.9.0.4" })).toBe("blocked");
  });
});

// ADR-024: C1/C4, M1–M4/M6. Explicit traffic and raw ARM rows, no company data.
describe("ADR-024 regressions", () => {
  const query = { direction: "inbound", protocol: "tcp", sourceAddressPrefix: "10.4.1.4", destinationAddressPrefix: "10.4.2.4", sourcePort: 50000, destinationPort: 22 };
  const evaluate = (properties: Record<string, unknown>) => classifyNsgVerdict(parseNsgRules(nsgResource(NSG_ID, { securityRules: [
    { name: "first", properties: { ...allowRule().properties, ...properties } }, denyRule(),
  ] })), query);
  it("C1: ASG-only empty addresses remain unresolved", () => {
    expect(evaluate({ sourceAddressPrefix: undefined, sourceAddressPrefixes: [], sourceApplicationSecurityGroups: [{ id: "asg-admin" }] })).toBe("unknown");
  });
  it("C4: unresolved decisive source is not a wildcard", () => {
    const rules = parseNsgRules(nsgResource(NSG_ID, { securityRules: [allowRule("restricted", { sourcePrefix: "203.0.113.5/32" }), denyRule()] }));
    expect(classifyNsgVerdict(rules, { ...query, sourceAddressPrefix: null })).toBe("unknown");
    expect(classifyNsgVerdict(rules, query)).toBe("blocked");
  });
  it.each([
    { direction: undefined }, { access: "Maybe" }, { protocol: undefined },
    { sourcePortRange: undefined }, { destinationPortRange: 22 }, { destinationPortRange: "22-" },
    { sourceAddressPrefix: "10.0.0.0/33" }, { sourceAddressPrefix: 42 },
    { priority: undefined }, { priority: 65000 }, { priority: 99 }, { priority: 4097 }, { priority: 100.5 }, { priority: "100" }, { priority: 200 },
  ])("M1/M2: preserves malformed earlier data: %j", properties => {
    expect(evaluate(properties)).toBe("unknown");
  });
  it("M3: missing/non-array securityRules differs from an explicit empty list", () => {
    for (const value of [undefined, null, {}]) {
      const nsg = nsgResource(); nsg.properties.securityRules = value;
      expect(classifyNsgVerdict(rulesWithAzureDefaults(nsg), query)).toBe("unknown");
    }
    expect(classifyNsgVerdict(rulesWithAzureDefaults(nsgResource()), { ...query, virtualNetworkPrefixes: ["10.4.0.0/16"] })).toBe("allowed");
  });
  it("M6: a partially overlapping earlier rule cannot be skipped", () => {
    expect(classifyNsgVerdict(parseNsgRules(nsgResource(NSG_ID, { securityRules: [denyRule("partial", { priority: 100, sourcePrefix: "10.4.1.0/24" }), allowRule("all", { priority: 200 })] })), { ...query, sourceAddressPrefix: "10.4.0.0/16" })).toBe("unknown");
  });
  it.each(["Storage", "AzureCloud", "GatewayManager", "Storage.CanadaCentral"])("M4: %s is not decisive", sourceAddressPrefix => {
    expect(evaluate({ sourceAddressPrefix })).toBe("unknown");
  });
});

describe("structured NSG diagnostics", () => {
  const query = { direction: "inbound", protocol: "tcp", sourceAddressPrefix: "10.0.1.4", destinationAddressPrefix: "10.0.2.4", destinationPort: 22 };
  it("keeps ambiguous rule names, priorities and evidence pointers", () => {
    const first = allowRule("asg", { priority: 100 });
    const rules = parseNsgRules(nsgResource(NSG_ID, { securityRules: [
      { ...first, properties: { ...first.properties, sourceAddressPrefix: "", sourceAddressPrefixes: [], sourceApplicationSecurityGroups: [{ id: "asg" }] } }, denyRule("deny", { priority: 200 }),
    ] }));
    const detail = diagnoseNsgVerdict(rules, query);
    expect(networkReasonCodeSchema.array().parse(detail.reasonCodes)).toEqual(detail.reasonCodes);
    expect(detail.verdict).toBe("unknown");
    expect(detail.reasonCodes).toContain("asg-membership-unresolved");
    expect(detail.rules.map(rule => [rule.name, rule.priority])).toEqual([["asg", 100], ["deny", 200]]);
    expect(detail.rules[0].diagnostic?.propertyPaths).toContain("/properties/securityRules/0");
  });
  it("reports duplicate priorities independent of input order", () => {
    const rules = parseNsgRules(nsgResource(NSG_ID, { securityRules: [allowRule(), denyRule("deny", { priority: 100 })] }));
    for (const order of [rules, [...rules].reverse()]) expect(diagnoseNsgVerdict(order, query).reasonCodes).toContain("nsg-rule-priority-duplicate");
  });
  it("whole-traffic earlier deny overrides a later malformed rule", () => {
    const rules = parseNsgRules(nsgResource(NSG_ID, { securityRules: [denyRule("deny", { priority: 100 }), { name: "bad-later", properties: { priority: 200, direction: "inbound", access: "allow" } }] }));
    expect(diagnoseNsgVerdict(rules, query)).toMatchObject({ verdict: "blocked", reasonCodes: ["nsg-rule-decisive-deny"] });
  });
  it.each([null, undefined, "*", "any"])("unspecified protocol %s cannot skip an earlier protocol-specific deny", protocol => {
    const rules = parseNsgRules(nsgResource(NSG_ID, { securityRules: [denyRule("tcp-deny", { priority: 100 }), allowRule("all", { priority: 200, protocol: "*" })] }));
    expect(classifyNsgVerdict(rules, { ...query, protocol })).toBe("unknown");
  });
  it("known VirtualNetwork membership stays decisive when the rest of the scope is incomplete", () => {
    expect(classifyNsgVerdict(rulesWithAzureDefaults(nsgResource()), { ...query, virtualNetworkPrefixes: ["10.0.0.0/16"], virtualNetworkComplete: false })).toBe("allowed");
  });
  it("an address outside known VirtualNetwork prefixes stays unknown under incomplete scope", () => {
    expect(classifyNsgVerdict(rulesWithAzureDefaults(nsgResource()), { ...query, sourceAddressPrefix: "172.16.1.4", virtualNetworkPrefixes: ["10.0.0.0/16"], virtualNetworkComplete: false })).toBe("unknown");
  });
  it.each([{protocol: "udp"}, {destinationPortRange: "80"}, {sourcePortRange: "1234"}])(
    "ASG-only uncertainty does not match a disjoint traffic dimension: %j", nonMatch => {
      const first = denyRule("asg-deny", { priority: 100 });
      const rules = parseNsgRules(nsgResource(NSG_ID, { securityRules: [
        { ...first, properties: { ...first.properties, sourceAddressPrefix: "", sourceApplicationSecurityGroups: [{id: "asg"}], ...nonMatch } },
        allowRule("allow", { priority: 200 }),
      ] }));
      expect(classifyNsgVerdict(rules, { ...query, sourcePort: 443 })).toBe("allowed");
    },
  );
  it("malformed ASG traffic dimensions remain unknown despite another disjoint dimension", () => {
    const first = denyRule("asg-deny", { priority: 100 });
    const rules = parseNsgRules(nsgResource(NSG_ID, { securityRules: [
      { ...first, properties: { ...first.properties, sourceApplicationSecurityGroups: [{id: "asg"}], protocol: "udp", destinationPortRange: "bad" } },
      allowRule("allow", { priority: 200 }),
    ] }));
    expect(classifyNsgVerdict(rules, query)).toBe("unknown");
  });
});

it("duplicate priority remains invalid even when one rule's port is disjoint", () => {
  const deny = denyRule("deny-http", { priority: 100 });
  const rules = parseNsgRules(nsgResource(NSG_ID, { securityRules: [
    { ...deny, properties: { ...deny.properties, destinationPortRange: "80" } }, allowRule("allow", { priority: 100 }),
  ] }));
  expect(diagnoseNsgVerdict(rules, { direction: "inbound", protocol: "tcp", destinationPort: 443 }).reasonCodes).toContain("nsg-rule-priority-duplicate");
});
