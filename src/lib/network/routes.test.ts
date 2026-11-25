import { describe, expect, it } from "vitest";
import { networkReasonCodeSchema } from "@/lib/completion/schema";
import { parseRouteTableRoutes, classifyRouteVerdict, classifyRouteVerdictDetail, diagnoseRouteVerdict } from "./routes";
import { RT_ID, routeTableResource, routeEntry } from "./fixtures.test-data";
import type { RouteEntry } from "@/types/network";

describe("TestParseRouteTableRoutes", () => {
  it("test_empty_route_table", () => {
    const rt = routeTableResource(RT_ID);
    const routes = parseRouteTableRoutes(rt);
    expect(routes).toEqual([]);
  });
  it("test_single_route_parsed", () => {
    const rt = routeTableResource(RT_ID, { routes: [routeEntry()] });
    const routes = parseRouteTableRoutes(rt);
    expect(routes.length).toEqual(1);
    expect(routes[0].name).toEqual("route-to-hub");
    expect(routes[0].addressPrefix).toEqual("10.0.0.0/8");
    expect(routes[0].nextHopType).toEqual("Internet");
  });
  it("test_multiple_routes_parsed", () => {
    const routeData = [
        routeEntry("route-1", { addressPrefix: "10.0.0.0/8" }),
        routeEntry("route-2", { addressPrefix: "0.0.0.0/0", nextHopType: "Internet" }),
    ];
    const rt = routeTableResource(RT_ID, { routes: routeData });
    const routes = parseRouteTableRoutes(rt);
    expect(routes.length).toEqual(2);
  });
  it("test_route_with_next_hop_ip", () => {
    const rt = routeTableResource(RT_ID, { routes: [
        routeEntry("to-firewall", { nextHopType: "VirtualAppliance", nextHopIp: "10.0.0.1" }),
    ] });
    const routes = parseRouteTableRoutes(rt);
    expect(routes[0].nextHopIp).toEqual("10.0.0.1");
  });
  it("test_route_without_name_preserved", () => {
    const rt = routeTableResource(RT_ID, { routes: [
        {"properties": {"addressPrefix": "10.0.0.0/8", "nextHopType": "VnetLocal"}},
    ] });
    const routes = parseRouteTableRoutes(rt);
    expect(routes).toHaveLength(1);
    expect(routes[0].addressPrefix).toBe("10.0.0.0/8");
  });
});
describe("TestClassifyRouteVerdict", () => {
  it("test_explicit_empty_routes_uses_system_routes", () => {
    expect(classifyRouteVerdict([], { destinationPrefix: "10.0.0.0/8" })).toEqual("allowed");
  });
  it("test_normal_routes_return_allowed", () => {
    const routes = [{name: "to-internet", addressPrefix: "10.0.0.0/8", nextHopType: "Internet"}];
    expect(classifyRouteVerdict(routes, { destinationPrefix: "10.0.0.4" })).toEqual("allowed");
  });
  it("test_virtual_appliance_route_returns_unknown", () => {
    const routes = [{name: "to-firewall", addressPrefix: "10.0.0.0/8", nextHopType: "VirtualAppliance"}];
    expect(classifyRouteVerdict(routes, { destinationPrefix: "10.0.0.5/32" })).toEqual("unknown");
  });
  it("test_blackhole_route_returns_blocked", () => {
    const routes = [{name: "drop", addressPrefix: "10.0.0.0/8", nextHopType: "None"}];
    expect(classifyRouteVerdict(routes, { destinationPrefix: "10.0.0.0/8", virtualNetworkPrefixes: ["10.0.0.0/8"] })).toEqual("blocked");
  });
  it("test_blackhole_catchall_blocks_any_destination", () => {
    const routes = [{name: "drop-all", addressPrefix: "0.0.0.0/0", nextHopType: "None"}];
    expect(classifyRouteVerdict(routes, { destinationPrefix: "172.16.0.0/16" })).toEqual("blocked");
  });
  it("test_blackhole_does_not_block_unrelated_prefix", () => {
    const routes = [{name: "drop-10", addressPrefix: "10.0.0.0/8", nextHopType: "None"}];
    expect(classifyRouteVerdict(routes, { destinationPrefix: "172.16.0.0/16" })).toEqual("allowed");
  });
  it("test_blackhole_route_uses_cidr_containment", () => {
    const routes = [{name: "drop-spoke", addressPrefix: "10.0.0.0/16", nextHopType: "None"}];
    expect(classifyRouteVerdict(routes, { destinationPrefix: "10.0.1.25/32" })).toEqual("blocked");
  });
  it("test_longest_prefix_match_prefers_specific_allow_over_broader_blackhole", () => {
    const routes = [
        {name: "allow-specific", addressPrefix: "10.0.0.0/16", nextHopType: "VnetLocal"},
        {name: "drop-broad", addressPrefix: "10.0.0.0/8", nextHopType: "None"},
    ];

    expect(classifyRouteVerdict(routes, { destinationPrefix: "10.0.1.25/32" })).toEqual("allowed");
  });
  it("test_longest_prefix_match_prefers_specific_blackhole_over_broader_allow", () => {
    const routes = [
        {name: "allow-broad", addressPrefix: "10.0.0.0/8", nextHopType: "VnetLocal"},
        {name: "drop-specific", addressPrefix: "10.0.1.0/24", nextHopType: "None"},
    ];

    expect(classifyRouteVerdict(routes, { destinationPrefix: "10.0.1.25/32" })).toEqual("blocked");
  });
  it("test_blackhole_route_does_not_cross_ip_versions", () => {
    const routes = [{name: "drop-ipv4", addressPrefix: "10.0.0.0/8", nextHopType: "None"}];
    expect(classifyRouteVerdict(routes, { destinationPrefix: "2001:db8::/64" })).toEqual("allowed");
  });
  it("test_azure_service_tag_prefix_matches_known_tag", () => {
    const routes = [{name: "drop-tag", addressPrefix: "VirtualNetwork", nextHopType: "None"}];
    expect(classifyRouteVerdict(routes, { destinationPrefix: "10.0.0.0/8", virtualNetworkPrefixes: ["10.0.0.0/8"] })).toEqual("blocked");
  });
  it("test_no_destination_prefix_with_blackhole_returns_unknown", () => {
    const routes = [{name: "drop", addressPrefix: "10.0.0.0/8", nextHopType: "None"}];
    expect(classifyRouteVerdict(routes, { destinationPrefix: null })).toEqual("unknown");
  });
});

describe("경로 근거와 경계값", () => {
  it.each(["VirtualAppliance", "VirtualNetworkGateway", "FutureHop", null])("다음 홉 %s는 unknown이며 근거를 보존한다", nextHopType => {
    const route: RouteEntry = { name: "route", addressPrefix: "10.0.0.0/8", nextHopType, nextHopIp: "10.0.0.1" };
    expect(classifyRouteVerdictDetail([route], { destinationPrefix: "10.0.1.2" })).toEqual({ verdict: "unknown", route });
  });
  it.each(["UnknownServiceTag", "Storage.UnknownRegion", "invalid/99", null])("접두사 %s의 불확실성을 허용으로 바꾸지 않는다", addressPrefix => {
    const route: RouteEntry = { name: "uncertain", addressPrefix, nextHopType: "Internet" };
    expect(classifyRouteVerdictDetail([route], { destinationPrefix: "10.0.1.2" })).toEqual({ verdict: "unknown", route });
  });
  it("최장 접두사로 고른 경로의 다음 홉과 IP를 보존한다", () => {
    const specific = { name: "to-fw", addressPrefix: "10.0.1.0/24", nextHopType: "VirtualAppliance", nextHopIp: "10.0.0.1" };
    expect(classifyRouteVerdictDetail([{ name: "default", addressPrefix: "*", nextHopType: "Internet" }, specific], { destinationPrefix: "10.0.1.25/32" })).toEqual({ verdict: "unknown", route: specific });
  });
  it("IPv6에서도 최장 접두사와 호스트 비트를 처리한다", () => {
    const specific = { name: "local", addressPrefix: "fd00:1::abcd/64", nextHopType: " VirtualNetwork " };
    expect(classifyRouteVerdictDetail([{ name: "drop", addressPrefix: "::/0", nextHopType: "None" }, specific], { destinationPrefix: "fd00:1::1" })).toEqual({ verdict: "allowed", route: specific });
  });
  it("서비스 태그의 일치 CIDR 길이로 구체성을 비교한다", () => {
    const specific = { name: "local", addressPrefix: "10.1.0.0/16", nextHopType: "VnetLocal" };
    expect(classifyRouteVerdictDetail([{ name: "drop-tag", addressPrefix: "VirtualNetwork", nextHopType: "None" }, specific], { destinationPrefix: "10.1.2.3", virtualNetworkPrefixes: ["10.0.0.0/8"] })).toEqual({ verdict: "allowed", route: specific });
  });
  it("동일 구체성의 충돌 경로는 unknown이다", () => {
    const allowed = { name: "local", addressPrefix: "10.0.0.0/8", nextHopType: "VnetLocal" };
    const unknown = { ...allowed, name: "missing", nextHopType: null };
    const blocked = { ...allowed, name: "drop", nextHopType: "None" };
    expect(classifyRouteVerdictDetail([allowed, unknown], { destinationPrefix: "10.0.0.4" })).toEqual({ verdict: "unknown", route: allowed });
    expect(classifyRouteVerdictDetail([allowed, unknown, blocked], { destinationPrefix: "10.0.0.4" })).toEqual({ verdict: "unknown", route: allowed });
  });
  it("빈 경로와 불일치 경로는 근거가 없다", () => {
    expect(classifyRouteVerdictDetail([])).toEqual({ verdict: "unknown", route: null });
    expect(classifyRouteVerdictDetail([{ name: "other", addressPrefix: "192.168.0.0/16", nextHopType: "None" }], { destinationPrefix: "10.0.0.1" })).toEqual({ verdict: "allowed", route: null });
  });
  it("평면 속성과 잘못된 행을 모두 보존한다", () => {
    expect(parseRouteTableRoutes(routeTableResource(RT_ID, { routes: [{ name: "flat", addressPrefix: "*", nextHopType: "Internet" }] }))).toMatchObject([{ name: "flat", addressPrefix: "*", nextHopType: "Internet", nextHopIp: null }]);
    const rt = routeTableResource();
    rt.properties.routes = [null, [], 4, {}, { name: "partial" }];
    expect(parseRouteTableRoutes(rt)).toHaveLength(5);
    expect(classifyRouteVerdict(parseRouteTableRoutes(rt), { destinationPrefix: "10.0.0.4" })).toBe("unknown");
    rt.properties.routes = {};
    expect(diagnoseRouteVerdict(parseRouteTableRoutes(rt), { destinationPrefix: "10.0.0.4" }).reasonCodes).toContain("route-table-routes-not-collected");
  });
  it("잘못된 목적지는 unknown이다", () => {
    expect(classifyRouteVerdict([{ name: "default", addressPrefix: "*", nextHopType: "Internet" }], { destinationPrefix: "bad/99" })).toEqual("unknown");
  });
});

describe("default routes respect the IP version", () => {
  const table = (addressPrefix: string, nextHopType: string) =>
    parseRouteTableRoutes(routeTableResource(RT_ID, { routes: [routeEntry("default", { addressPrefix, nextHopType })] }));
  it("an IPv6 default route does not apply to IPv4 destinations", () => {
    expect(classifyRouteVerdict(table("::/0", "None"), { destinationPrefix: "10.0.2.4" })).toBe("allowed");
    expect(classifyRouteVerdict(table("::/0", "VirtualAppliance"), { destinationPrefix: "10.0.2.4" })).toBe("allowed");
  });
  it("an IPv4 default route does not apply to IPv6 destinations", () => {
    expect(classifyRouteVerdict(table("0.0.0.0/0", "None"), { destinationPrefix: "fd00::4" })).toBe("allowed");
  });
  it("a default route still applies within its IP version", () => {
    expect(classifyRouteVerdict(table("0.0.0.0/0", "None"), { destinationPrefix: "10.0.2.4" })).toBe("blocked");
    expect(classifyRouteVerdict(table("::/0", "None"), { destinationPrefix: "fd00::4" })).toBe("blocked");
  });
});

describe("VNetPeering next hop", () => {
  it("is allowed like VnetLocal (only system routes use it)", () => {
    const routes = [{ name: "system-vnetpeering", addressPrefix: "10.1.0.0/16", nextHopType: "VNetPeering" }];
    expect(classifyRouteVerdict(routes, { destinationPrefix: "10.1.1.4" })).toBe("allowed");
  });
});

describe("ADR-024 route regressions", () => {
  it("C4: unspecified destination cannot select a blackhole", () => {
    expect(classifyRouteVerdict([{ name: "drop", addressPrefix: "10.99.0.0/16", nextHopType: "None" }])).toBe("unknown");
  });
  it("M6: unnamed blackhole is retained", () => {
    const routes = parseRouteTableRoutes(routeTableResource(RT_ID, { routes: [{ properties: { addressPrefix: "0.0.0.0/0", nextHopType: "None" } }] }));
    expect(classifyRouteVerdict(routes, { destinationPrefix: "10.4.1.4" })).toBe("blocked");
  });
  it("M6: partial overlap is uncertain", () => {
    expect(classifyRouteVerdict([{ name: "partial", addressPrefix: "10.4.1.0/24", nextHopType: "None" }], { destinationPrefix: "10.4.0.0/16" })).toBe("unknown");
  });
  it("M4: approximate tags cannot select a blackhole", () => {
    expect(classifyRouteVerdict([{ name: "tag", addressPrefix: "Storage", nextHopType: "None" }], { destinationPrefix: "20.1.2.3" })).toBe("unknown");
  });
});

describe("structured route diagnostics", () => {
  const query = { destinationPrefix: "10.0.1.4" };
  it("distinguishes collected empty tables from missing or malformed collections", () => {
    expect(diagnoseRouteVerdict(parseRouteTableRoutes(routeTableResource()), query)).toMatchObject({ verdict: "allowed", reasonCodes: ["route-table-empty-system-routes", "effective-routes-not-collected"] });
    const rt = routeTableResource(); delete rt.properties.routes;
    expect(diagnoseRouteVerdict(parseRouteTableRoutes(rt), query)).toMatchObject({ verdict: "unknown", reasonCodes: ["route-table-routes-not-collected"] });
    rt.properties.routes = [null, { properties: { addressPrefix: "*", nextHopType: "Internet" } }];
    expect(diagnoseRouteVerdict(parseRouteTableRoutes(rt), query).reasonCodes).toContain("route-malformed");
  });
  it("reports partial overlap and retains its evidence row", () => {
    const route = { name: "partial", addressPrefix: "10.0.1.0/24", nextHopType: "None" };
    expect(diagnoseRouteVerdict([route], { destinationPrefix: "10.0.0.0/16" })).toMatchObject({ verdict: "unknown", route, reasonCodes: ["route-destination-partial-overlap"] });
  });
  it("preserves NVA type and IP without claiming forwarding", () => {
    const route = { name: "fw", addressPrefix: "10.0.0.0/16", nextHopType: "VirtualAppliance", nextHopIp: "10.0.0.4" };
    expect(diagnoseRouteVerdict([route], query)).toMatchObject({ verdict: "unknown", route, reasonCodes: ["route-next-hop-virtual-appliance"] });
  });
});


it("partial Internet membership carries an overlap reason, not an unsupported-tag claim", () => {
  const detail = diagnoseRouteVerdict([{ name: "internet", addressPrefix: "Internet", nextHopType: "None" }], { destinationPrefix: "0.0.0.0/0" });
  expect(detail.reasonCodes).toContain("route-destination-partial-overlap");
  expect(networkReasonCodeSchema.array().parse(detail.reasonCodes)).toEqual(detail.reasonCodes);
});
