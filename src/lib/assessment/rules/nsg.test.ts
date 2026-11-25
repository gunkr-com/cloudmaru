import { expect, it } from "vitest";
import { evaluateManagementPorts } from "./nsg";
const allow = (overrides: Record<string, unknown> = {}) => ({ properties: {
  priority: 200, direction: "Inbound", access: "Allow", protocol: "Tcp",
  sourceAddressPrefix: "*", destinationAddressPrefix: "*", sourcePortRange: "*", destinationPortRange: "22", ...overrides,
}});
const deny = (overrides: Record<string, unknown> = {}) => allow({priority: 100, access: "Deny", ...overrides});
const check = (securityRules: unknown, rest = {}) => evaluateManagementPorts({securityRules, ...rest});

it.each(["22", "3389", "5985-5986", "0-65535", "*"])("detects broad management port %s", port => {
  expect(check([allow({destinationPortRange: port})]).verdict).toBe("violation");
});
it.each(["0.0.0.0/0", "::/0", "Internet", "*"])("recognizes broad source %s", source => {
  expect(check([allow({sourceAddressPrefix: source})]).verdict).toBe("violation");
});
it("parses plural ports and addresses", () => {
  expect(check([allow({sourceAddressPrefix: undefined, sourceAddressPrefixes: ["::/0", "0.0.0.0/0"],
    destinationPortRange: undefined, destinationPortRanges: ["443", "5985-5986"]})]).verdict).toBe("violation");
});
it("complete higher priority denies suppress broad allow, including union coverage", () => {
  expect(check([allow(), deny()]).verdict).toBe("pass");
  expect(check([deny({sourceAddressPrefix: "0.0.0.0/1"}), deny({priority: 101, sourceAddressPrefix: "128.0.0.0/1"}),
    allow({sourceAddressPrefix: "0.0.0.0/0"})]).verdict).toBe("pass");
  expect(check([deny({destinationPortRange: "22"}), deny({priority: 101, destinationPortRange: "3389"}),
    allow({destinationPortRange: undefined, destinationPortRanges: ["22", "3389"]})]).verdict).toBe("pass");
});
it("partial overlapping denies are unknown, later or disjoint denies do not mask", () => {
  expect(check([deny({sourceAddressPrefix: "10.0.0.0/8"}), allow()]).verdict).toBe("unknown");
  expect(check([deny({priority: 300}), allow()]).verdict).toBe("violation");
  expect(check([deny({destinationPortRange: "443"}), allow()]).verdict).toBe("violation");
});
it.each([
  {priority: 200}, {priority: 99}, {priority: "100"}, {priority: undefined}, {protocol: "bad"},
  {destinationPortRange: "65536"}, {destinationPortRange: "30-20"}, {sourceAddressPrefix: "10.0.0.0/99"},
  {sourceAddressPrefix: undefined, sourceAddressPrefixes: []}, {sourceApplicationSecurityGroups: [{id: "unresolved"}]},
])("malformed rules and ambiguous priorities are unknown: %j", overrides => {
  expect(check([deny(overrides), allow()]).verdict).toBe("unknown");
});
it("unsupported service tags stay unknown", () => {
  expect(check([allow({sourceAddressPrefix: "AzureCloud"})]).reasonCode).toBe("unsupported-service-tag");
});
it("does not infer reachability from public configuration or missing associations", () => {
  expect(check([allow({destinationPortRange: "443"})]).verdict).toBe("pass");
  expect(check([allow({sourceAddressPrefix: "10.0.0.0/8"})]).verdict).toBe("pass");
  expect(check([allow({protocol: "Udp"})]).verdict).toBe("pass");
  expect(check([]).verdict).toBe("pass");
  expect(evaluateManagementPorts({}).verdict).toBe("unknown");
  expect(check(null).reasonCode).toBe("invalid-data");
  expect(check([allow()]).verdict).toBe("violation");
});
it("validates explicit defaults without inventing missing priority", () => {
  expect(check([], {defaultSecurityRules: [deny({priority: 65500})]}).verdict).toBe("pass");
  expect(check([], {defaultSecurityRules: [deny({priority: undefined})]}).verdict).toBe("unknown");
});
it("accepts ARM's empty unused plural forms but rejects conflicting forms", () => {
  expect(check([allow({sourceAddressPrefixes: [], destinationPortRanges: []})]).verdict).toBe("violation");
  expect(check([allow({destinationPortRanges: ["443"]})]).verdict).toBe("unknown");
});
it("does not confuse an Internet-only deny with complete wildcard coverage", () => {
  expect(check([deny({sourceAddressPrefix: "Internet"}), allow()]).verdict).toBe("unknown");
});
it("supports duplicate priorities only across separate directions", () => {
  expect(check([allow({direction: "Outbound"}), allow()]).verdict).toBe("violation");
});
const defaults = [
  allow({ priority: 65000, protocol: "*", sourceAddressPrefix: "VirtualNetwork", destinationAddressPrefix: "VirtualNetwork", destinationPortRange: "*" }),
  allow({ priority: 65001, protocol: "*", sourceAddressPrefix: "AzureLoadBalancer", destinationPortRange: "*" }),
  deny({ priority: 65500, protocol: "*", destinationPortRange: "*" }),
];
it("does not let standard default tag allows hide explicit broad management exposure", () => {
  expect(check([allow({sourceAddressPrefix: "Internet"})], {defaultSecurityRules: defaults}).verdict).toBe("violation");
  expect(check([], {defaultSecurityRules: defaults}).verdict).toBe("pass");
});
it("only potentially overlapping higher-priority tag denies make a candidate uncertain", () => {
  expect(check([allow({sourceAddressPrefix: "AzureCloud", destinationPortRange: "443"})]).verdict).toBe("pass");
  expect(check([deny({sourceAddressPrefix: "AzureCloud"}), allow()]).verdict).toBe("unknown");
  expect(check([deny({sourceAddressPrefix: "AzureCloud", destinationPortRange: "443"}), allow()]).verdict).toBe("violation");
  expect(check([deny({sourceAddressPrefix: "AzureCloud", priority: 300}), allow()]).verdict).toBe("violation");
  expect(check([deny(), deny({sourceAddressPrefix: "AzureCloud", priority: 150}), allow()]).verdict).toBe("pass");
  expect(check([allow({destinationAddressPrefix: "AzureCloud"})]).verdict).toBe("violation");
});
it("detects broad source management rules targeting a configured service tag without claiming reachability", () => {
  expect(check([allow({sourceAddressPrefix: "Internet", destinationAddressPrefix: "VirtualNetwork", destinationPortRange: "3389"})]).verdict).toBe("violation");
  expect(check([allow({sourceAddressPrefix: "10.0.0.0/8", destinationAddressPrefix: "VirtualNetwork"})]).verdict).toBe("pass");
});
const group = {id: "/subscriptions/00000000-0000-4000-8000-000000000001/resourcegroups/rg/providers/microsoft.network/applicationsecuritygroups/clients"};
const asgSource = {sourceAddressPrefix: undefined, sourceApplicationSecurityGroups: [group]};
it("does not let unrelated ASG rules mask definite broad management configuration", () => {
  expect(check([deny({...asgSource, direction: "Outbound"}), allow()]).verdict).toBe("violation");
  expect(check([allow({...asgSource, priority: 100, destinationPortRange: "443"}), allow()]).verdict).toBe("violation");
  expect(check([deny({...asgSource, destinationPortRange: "443"}), allow()]).verdict).toBe("violation");
  expect(check([deny({...asgSource, priority: 300}), allow()]).verdict).toBe("violation");
});
it("retains uncertainty for relevant unresolved ASG source/deny membership", () => {
  expect(check([deny(asgSource), allow()])).toEqual({verdict:"unknown", reasonCode:"missing-data"});
  expect(check([allow(asgSource)])).toEqual({verdict:"unknown", reasonCode:"missing-data"});
  expect(check([allow({destinationAddressPrefix: undefined, destinationApplicationSecurityGroups: [group]})]).verdict).toBe("violation");
});
