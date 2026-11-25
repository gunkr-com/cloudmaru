import type { InventoryResource } from "@/types/inventory";
import type { PathVerdict, RouteEntry } from "@/types/network";
import type { NetworkReasonCode } from "@/types/network-diagnostics";
import { parsePrefix, prefixContains, prefixesOverlap } from "./cidr";
import { addressPrefixMatchesTag, isServiceTag, serviceTagReason } from "./service-tags";

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
const string = (value: unknown): string | null => typeof value === "string" ? value : null;
export function parseRouteTableRoutes(resource: InventoryResource): RouteEntry[] {
  const rawRoutes = resource.properties.routes;
  if (!Array.isArray(rawRoutes)) return [{ name: "", diagnostic: {
    reasonCodes: ["route-table-routes-not-collected"], propertyPaths: ["/properties/routes"],
  } }];
  return rawRoutes.map((value, i) => {
    const raw = object(value);
    const props = object(raw?.properties) ?? raw ?? {};
    return {
      name: string(raw?.name ?? props.name) ?? "", addressPrefix: string(props.addressPrefix),
      nextHopType: string(props.nextHopType), nextHopIp: string(props.nextHopIpAddress),
      diagnostic: { reasonCodes: raw ? [] : ["route-malformed"], propertyPaths: [`/properties/routes/${i}`] },
    };
  });
}
export type RouteQuery = Readonly<{ destinationPrefix?: string | null; virtualNetworkPrefixes?: readonly string[] | null; virtualNetworkComplete?: boolean }>;
export type RouteVerdictDetail = Readonly<{ verdict: PathVerdict; route: RouteEntry | null }>;
export type RouteDiagnostic = RouteVerdictDetail & Readonly<{ reasonCodes: readonly NetworkReasonCode[]; routes: readonly RouteEntry[] }>;
function prefixState(route: string | null | undefined, destination: string, query: RouteQuery): { state: boolean | null; code?: NetworkReasonCode; specificity: number } {
  const unknown = (code: NetworkReasonCode) => ({ state: null, code, specificity: 0 });
  if (!route?.trim()) return unknown("route-malformed");
  const text = route.trim().toLowerCase();
  if (text === "*") return { state: true, specificity: 0 };
  if (text === "virtualnetwork") {
    const prefixes = query.virtualNetworkPrefixes;
    if (query.virtualNetworkComplete === false || !prefixes?.length || prefixes.some(prefix => !parsePrefix(prefix))) return unknown("virtual-network-scope-incomplete");
    const covering = prefixes.filter(prefix => prefixContains(prefix, destination) === true);
    if (covering.length) return { state: true, specificity: Math.max(...covering.map(prefix => parsePrefix(prefix)!.length)) };
    return prefixes.some(prefix => prefixesOverlap(prefix, destination) === true)
      ? unknown("route-destination-partial-overlap") : { state: false, specificity: 0 };
  }
  if (isServiceTag(text)) {
    const state = addressPrefixMatchesTag(text, destination);
    return state === null ? unknown(["internet", "azureloadbalancer"].includes(text) ? "route-destination-partial-overlap" : serviceTagReason(text)) : { state, specificity: text === "azureloadbalancer" ? 32 : 0 };
  }
  const parsed = parsePrefix(text);
  if (!parsed) return unknown(text.includes("/") || /^[0-9.:]+$/.test(text) ? "route-malformed" : "service-tag-unsupported");
  if (prefixContains(text, destination) === true) return { state: true, specificity: parsed.length };
  return prefixesOverlap(text, destination) === true ? unknown("route-destination-partial-overlap") : { state: false, specificity: parsed.length };
}
export function diagnoseRouteVerdict(routes: readonly RouteEntry[], query: RouteQuery = {}): RouteDiagnostic {
  const result = (verdict: PathVerdict, route: RouteEntry | null, codes: readonly NetworkReasonCode[], involved: readonly RouteEntry[] = route ? [route] : []): RouteDiagnostic =>
    ({ verdict, route, reasonCodes: [...new Set(codes)], routes: involved });
  const destination = query.destinationPrefix;
  if (!destination) return result("unknown", null, ["route-destination-unspecified"]);
  if (!parsePrefix(destination)) return result("unknown", null, ["invalid-data"]);
  if (!routes.length) return result("allowed", null, ["route-table-empty-system-routes", "effective-routes-not-collected"]);
  const matches = routes.map(route => ({ route, ...prefixState(route.addressPrefix, destination, query) }));
  const malformed = matches.find(item => item.route.diagnostic?.reasonCodes.length);
  if (malformed) return result("unknown", malformed.route, malformed.route.diagnostic!.reasonCodes);
  const uncertain = matches.filter(item => item.state === null);
  if (uncertain.length) return result("unknown", uncertain[0].route, uncertain.map(item => item.code!), uncertain.map(item => item.route));
  const matching = matches.filter(item => item.state === true);
  if (!matching.length) return result("allowed", null, ["route-selected-system", "effective-routes-not-collected"]);
  const specificity = Math.max(...matching.map(item => item.specificity));
  const longest = matching.filter(item => item.specificity === specificity).map(item => item.route);
  // 접두사가 같으면 사용자 경로가 인벤토리 기반 시스템 경로보다 우선한다.
  const candidates = longest.some(route => route.origin !== "system") ? longest.filter(route => route.origin !== "system") : longest;
  const nextHop = (route: RouteEntry) => route.nextHopType?.trim().toLowerCase();
  if (new Set(candidates.map(nextHop)).size > 1 || new Set(candidates.map(route => route.nextHopIp ?? null)).size > 1)
    return result("unknown", candidates[0], ["route-malformed"], candidates);
  const route = candidates[0];
  switch (nextHop(route)) {
    case "none": return result("blocked", route, [route.origin === "system" ? "route-selected-system" : "route-selected-user", "route-blackhole"]);
    case "internet": case "vnetlocal": case "virtualnetwork": case "vnetpeering":
      return result("allowed", route, [route.origin === "system" ? "route-selected-system" : "route-selected-user", "effective-routes-not-collected"]);
    case "virtualappliance": return result("unknown", route, ["route-next-hop-virtual-appliance"]);
    case "virtualnetworkgateway": return result("unknown", route, ["route-next-hop-gateway"]);
    default: return result("unknown", route, [route.nextHopType ? "route-next-hop-unsupported" : "route-malformed"]);
  }
}
export function classifyRouteVerdict(routes: readonly RouteEntry[], query: RouteQuery = {}): PathVerdict {
  return diagnoseRouteVerdict(routes, query).verdict;
}
export function classifyRouteVerdictDetail(routes: readonly RouteEntry[], query: RouteQuery = {}): RouteVerdictDetail {
  const { verdict, route } = diagnoseRouteVerdict(routes, query);
  return { verdict, route };
}
