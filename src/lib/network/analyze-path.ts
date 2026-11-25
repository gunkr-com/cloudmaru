import type { InventoryResource } from "@/types/inventory";
import { canonicalId } from "@/lib/inventory/normalize";
import { buildExplicitRelations } from "@/lib/inventory/relations";
import {
  diagnoseNsgVerdict,
  rulesWithAzureDefaults,
} from "./nsg";
import { diagnoseRouteVerdict, parseRouteTableRoutes } from "./routes";
import type {
  HopType,
  PathAnalysisResult,
  PathHop,
  PathQuery,
  PathVerdict,
  RouteEntry,
} from "@/types/network";

import type { NetworkEngineResult, NetworkReasonCode } from "@/types/network-diagnostics";
import type { Evidence, JsonValue, SourceScan } from "@/types/completion";
import { sourceScanSchema } from "@/lib/completion/schema";
import { parsePrefix, prefixContains } from "./cidr";

type Detail = { reasonCodes: NetworkReasonCode[]; evidence: Evidence[] };
type DiagnosticHop = PathHop & Detail & { verdict: PathVerdict };
const unique = <T>(values: readonly T[]): T[] => [...new Set(values)];
// Only explicitly selected network facts become evidence; no names, rules blobs or secrets.
function fact(resource: InventoryResource, path: string): Evidence {
  let value: unknown = resource;
  for (const part of path.slice(1).split("/")) {
    if (value === null || typeof value !== "object" || !Object.hasOwn(value, part))
      return { resourceId: canonicalId(resource.id), propertyPath: path, observation: { state: "missing" } };
    value = (value as Record<string, unknown>)[part];
  }
  const safe = value === null || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value)
    || typeof value === "string" && !/AccountKey=|SharedAccessKey=|Password=|[?&]sig=/i.test(value);
  return { resourceId: canonicalId(resource.id), propertyPath: path, observation: safe
    ? { state: "present", value: value as JsonValue } : { state: "invalid", reason: "invalid-data" } };
}
function ruleFacts(resource: InventoryResource, paths: readonly string[], fields: readonly string[]): Evidence[] {
  return paths.flatMap(path => fields.flatMap(field => {
    const pointer = `${path}/properties/${field}`;
    let value: unknown = resource;
    for (const part of pointer.slice(1).split("/")) value = value !== null && typeof value === "object" ? (value as Record<string, unknown>)[part] : undefined;
    return Array.isArray(value) ? value.map((_, i) => fact(resource, `${pointer}/${i}`)) : [fact(resource, pointer)];
  }));
}
type ResourceIndex = ReadonlyMap<string, InventoryResource>;
function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function objects(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter(
        (item) =>
          item !== null && typeof item === "object" && !Array.isArray(item),
      )
    : [];
}
function idFromRef(value: unknown): string | null {
  const id = typeof value === "string" ? value : object(value).id;
  return typeof id === "string" && id.trim() ? canonicalId(id) : null;
}
function resolve(
  value: unknown,
  index: ResourceIndex,
): InventoryResource | undefined {
  const id = idFromRef(value);
  return id ? index.get(id) : undefined;
}
function displayName(resource: InventoryResource): string {
  return (
    (resource.name || resource.id.replace(/\/+$/, "")).split("/").at(-1) ||
    "resource"
  );
}
const HOP_TYPES: readonly [string, HopType][] = [
  ["microsoft.network/virtualnetworks/subnets", "subnet"],
  ["microsoft.network/virtualnetworks", "vnet"],
  ["microsoft.network/networkinterfaces", "nic"],
  ["microsoft.network/networksecuritygroups", "nsg"],
  ["microsoft.network/routetables", "route_table"],
  ["microsoft.network/privateendpoints", "private_endpoint"],
  ["microsoft.network/loadbalancers", "load_balancer"],
  ["microsoft.network/applicationgateways", "application_gateway"],
  ["microsoft.network/publicipaddresses", "public_ip"],
  ["microsoft.compute/virtualmachines", "vm"],
  ["microsoft.storage/storageaccounts", "storage_account"],
  ["microsoft.sql/managedinstances", "sql_managed_instance"],
  ["microsoft.web/sites", "web_app"],
];
function hopType(resource: InventoryResource): HopType {
  return (
    HOP_TYPES.find(([type]) =>
      resource.type.toLowerCase() === type,
    )?.[1] ?? "other"
  );
}

function indexResources(
  resources: readonly InventoryResource[],
): Map<string, InventoryResource> {
  const index = new Map(
    resources.map((resource) => [canonicalId(resource.id), resource]),
  );
  for (const vnet of resources) {
    if (hopType(vnet) !== "vnet") continue;
    for (const raw of objects(vnet.properties.subnets)) {
      const id =
        idFromRef(raw) ??
        (typeof raw.name === "string" && raw.name
          ? canonicalId(`${vnet.id}/subnets/${raw.name}`)
          : null);
      if (!id || index.has(id)) continue;
      index.set(id, {
        ...vnet,
        id,
        name: typeof raw.name === "string" ? raw.name : id.split("/").at(-1)!,
        type: "microsoft.network/virtualnetworks/subnets",
        parentId: canonicalId(vnet.id),
        properties: object(raw.properties),
      });
    }
  }
  return index;
}
function subnetResources(
  resource: InventoryResource,
  index: ResourceIndex,
): InventoryResource[] {
  return objects(resource.properties.ipConfigurations).flatMap((config) => {
    const subnet = resolve(object(config.properties).subnet, index);
    return subnet ? [subnet] : [];
  });
}
/** 끝점이 직접 참조하는 서브넷만 해석하고, 인벤토리에 없는 참조는 건너뛴다. */
function endpointSubnets(
  resource: InventoryResource,
  index: ResourceIndex,
): InventoryResource[] {
  const type = hopType(resource);
  if (type === "nic") return subnetResources(resource, index);
  // Application Gateway instances run inside their subnet, so its NSG and route table apply.
  // Azure Load Balancer is pass-through: its frontend subnet does not filter LB traffic, so an
  // internal LB endpoint gets no subnet attachment (the backend NICs and subnets decide).
  const configurations =
    type === "application_gateway"
      ? [
          ...objects(resource.properties.gatewayIPConfigurations),
          ...objects(resource.properties.frontendIPConfigurations),
        ]
      : [];
  return [
    resource.properties.subnet,
    ...configurations.map((config) => object(config.properties).subnet),
  ].flatMap((ref) => {
    const subnet = resolve(ref, index);
    return subnet ? [subnet] : [];
  });
}
function associatedNsgResources(
  resource: InventoryResource,
  index: ResourceIndex,
): InventoryResource[] {
  const attachments = [
    resource,
    ...(hopType(resource) === "nic" ? subnetResources(resource, index) : []),
  ];
  const nsgs = new Map<string, InventoryResource>();
  for (const attachment of attachments) {
    const nsg = resolve(attachment.properties.networkSecurityGroup, index);
    if (nsg) nsgs.set(canonicalId(nsg.id), nsg);
  }
  return [...nsgs.values()];
}
function vnetForResource(
  resource: InventoryResource,
  index: ResourceIndex,
): InventoryResource | undefined {
  const subnetIds =
    hopType(resource) === "subnet"
      ? [canonicalId(resource.id)]
      : endpointSubnets(resource, index).map((subnet) => canonicalId(subnet.id));
  for (const subnetId of subnetIds) {
    if (!subnetId) continue;
    const id = canonicalId(subnetId);
    const offset = id.indexOf("/subnets/");
    if (offset >= 0) return index.get(id.slice(0, offset));
  }
  return undefined;
}
function peeringProperties(
  source: InventoryResource,
  targetId: string,
): Record<string, unknown> | undefined {
  return objects(source.properties.virtualNetworkPeerings)
    .map((raw) =>
      raw.properties !== null && typeof raw.properties === "object"
        ? object(raw.properties)
        : raw,
    )
    .find(
      (props) =>
        idFromRef(props.remoteVirtualNetwork) === canonicalId(targetId),
    );
}
function isConnected(props: Record<string, unknown> | undefined): boolean {
  return (
    String(props?.peeringState ?? "")
      .trim()
      .toLowerCase() === "connected"
  );
}
function peeredVnets(
  vnet: InventoryResource,
  index: ResourceIndex,
): InventoryResource[] {
  return [...index.values()].filter(
    (peer) =>
      isConnected(peeringProperties(vnet, peer.id)) &&
      isConnected(peeringProperties(peer, vnet.id)),
  );
}
function addressSpace(vnet: InventoryResource): string[] {
  const raw = object(vnet.properties.addressSpace).addressPrefixes;
  return [
    ...(Array.isArray(raw)
      ? raw.filter(
          (prefix): prefix is string => typeof prefix === "string" && !!prefix,
        )
      : typeof raw === "string"
        ? [raw]
        : []),
    ...(typeof vnet.properties.addressPrefix === "string"
      ? [vnet.properties.addressPrefix]
      : []),
  ].filter((prefix) => prefix.trim());
}
function vnetScopeComplete(resource: InventoryResource, index: ResourceIndex): boolean {
  const vnet = vnetForResource(resource, index);
  if (!vnet || !addressSpace(vnet).length || addressSpace(vnet).some(prefix => !parsePrefix(prefix))) return false;
  return objects(vnet.properties.virtualNetworkPeerings).every(raw => {
    const props = object(raw.properties), id = idFromRef(props.remoteVirtualNetwork), peer = id ? index.get(id) : undefined;
    const reverse = peer ? peeringProperties(peer, vnet.id) : undefined;
    return !!peer && isConnected(props) && isConnected(reverse) && props.allowVirtualNetworkAccess === true
      && reverse?.allowVirtualNetworkAccess === true && addressSpace(peer).length > 0 && addressSpace(peer).every(prefix => !!parsePrefix(prefix));
  });
}
function virtualNetworkPrefixes(
  resource: InventoryResource,
  index: ResourceIndex,
): string[] | null {
  const vnet = vnetForResource(resource, index);
  if (!vnet) return null;
  // NSG VirtualNetwork 태그에는 양방향 접근이 확인된 피어만 포함한다.
  // 연결된 피어의 시스템 경로 계산은 별도로 유지한다.
  const accessiblePeers = peeredVnets(vnet, index).filter(peer =>
    peeringProperties(vnet, peer.id)?.allowVirtualNetworkAccess === true
    && peeringProperties(peer, vnet.id)?.allowVirtualNetworkAccess === true);
  const prefixes = [vnet, ...accessiblePeers].flatMap(addressSpace);
  return [
    ...new Map(
      prefixes.map((prefix) => [prefix.trim().toLowerCase(), prefix]),
    ).values(),
  ];
}
/**
 * Azure system routes for the hop's VNet address space (VnetLocal) and connected peers
 * (VNetPeering). They join longest-prefix matching so a broad user route such as
 * 0.0.0.0/0 does not capture traffic that stays in the VNet; a user route with an
 * equal prefix still wins through the blocked/unknown tie-break in routes.ts.
 */
function systemRoutes(
  resource: InventoryResource,
  index: ResourceIndex,
): RouteEntry[] {
  const vnet = vnetForResource(resource, index);
  if (!vnet) return [];
  const route = (nextHopType: string) => (addressPrefix: string) => ({
    name: `system-${nextHopType.toLowerCase()}`,
    origin: "system" as const,
    addressPrefix,
    nextHopType,
  });
  return [
    ...addressSpace(vnet).map(route("VnetLocal")),
    ...peeredVnets(vnet, index).flatMap(addressSpace).map(route("VNetPeering")),
  ];
}

type NsgEvaluation = Detail & {
  verdict: PathVerdict | null;
  name: string | null;
  ruleName: string | null;
};
function evaluateNsg(
  resource: InventoryResource,
  index: ResourceIndex,
  direction: string,
  query: PathQuery,
  strict: boolean,
  knownOmissions: boolean,
): NsgEvaluation {
  const params = {
    ...query,
    direction,
    virtualNetworkPrefixes: virtualNetworkPrefixes(resource, index),
    virtualNetworkComplete: !strict || vnetScopeComplete(resource, index),
  };
  const evaluated: NsgEvaluation[] = associatedNsgResources(
    resource,
    index,
  ).map((nsg) => {
    const rules = rulesWithAzureDefaults(nsg);
    const detail = diagnoseNsgVerdict(rules, params);
    return {
      verdict: detail.verdict, name: displayName(nsg), ruleName: detail.rule?.name ?? null,
      reasonCodes: [...detail.reasonCodes],
      evidence: ruleFacts(nsg, unique(detail.rules.flatMap(rule => rule.diagnostic?.propertyPaths ?? [])),
        ["direction", "priority", "access", "protocol", "sourceAddressPrefix", "destinationAddressPrefix", "sourcePortRange", "destinationPortRange", "sourceAddressPrefixes", "destinationAddressPrefixes", "sourcePortRanges", "destinationPortRanges"]),
    };
  });
  const attachments = [
    resource,
    ...(hopType(resource) === "nic" ? subnetResources(resource, index) : []),
  ];
  if (
    attachments.some(
      (item) =>
        idFromRef(item.properties.networkSecurityGroup) &&
        !resolve(item.properties.networkSecurityGroup, index),
    )
  ) {
    evaluated.push({ verdict: "unknown", name: null, ruleName: null, reasonCodes: ["nsg-reference-missing"], evidence: [] });
  }
  if (strict) for (const attachment of attachments) {
    const props = attachment.properties;
    const ref = props.networkSecurityGroup;
    const present = Object.hasOwn(props, "networkSecurityGroup");
    const known = knownOmissions && attachment.observedFields?.includes("properties");
    const code = !present ? known ? null : "nsg-association-not-collected"
      : ref !== null && !idFromRef(ref) ? "nsg-association-mismatch" : null;
    if (code) evaluated.push({ verdict: "unknown", name: null, ruleName: null, reasonCodes: [code], evidence: [fact(attachment, "/properties/networkSecurityGroup/id")] });
    const reverse = [...index.values()].filter(item => hopType(item) === "nsg"
      && objects(item.properties[hopType(attachment) === "nic" ? "networkInterfaces" : "subnets"])
        .some(item => idFromRef(item) === attachment.id) && idFromRef(ref) !== item.id);
    if (reverse.length) evaluated.push({ verdict: "unknown", name: null, ruleName: null,
      reasonCodes: ["nsg-association-mismatch"], evidence: reverse.flatMap(nsg => {
        const field = hopType(attachment) === "nic" ? "networkInterfaces" : "subnets";
        return objects(nsg.properties[field]).map((_, i) => fact(nsg, `/properties/${field}/${i}/id`));
      }) });
  }
  if (!evaluated.length) return { verdict: null, name: null, ruleName: null, reasonCodes: ["nsg-not-attached"], evidence: attachments.map(item => fact(item, "/properties/networkSecurityGroup")) };
  const blocked = evaluated.find((item) => item.verdict === "blocked");
  const detail = { reasonCodes: unique(evaluated.flatMap(item => item.reasonCodes)), evidence: evaluated.flatMap(item => item.evidence) };
  if (blocked) return { ...blocked, ...detail };
  return {
    ...detail,
    verdict: evaluated.some((item) => item.verdict === "unknown")
      ? "unknown"
      : "allowed",
    name:
      evaluated
        .map((item) => item.name)
        .filter(Boolean)
        .join("+") || null,
    ruleName:
      evaluated
        .map((item) => item.ruleName)
        .filter(Boolean)
        .join("+") || null,
  };
}
type HopSide = { outbound: boolean; inbound: boolean };
const NO_NSG: NsgEvaluation = { verdict: null, name: null, ruleName: null, reasonCodes: [], evidence: [] };
/**
 * The resource itself plus the NICs and subnets it sits on: a VM's NICs, a NIC's
 * subnets, or another resource's direct and gateway/frontend subnet references.
 */
function endpointAttachments(
  resourceId: string,
  index: ResourceIndex,
): Set<string> {
  const ids = new Set<string>();
  const add = (resource: InventoryResource | undefined) => {
    if (!resource || ids.has(canonicalId(resource.id))) return;
    ids.add(canonicalId(resource.id));
    const type = hopType(resource);
    if (type === "vm")
      for (const ref of objects(
        object(resource.properties.networkProfile).networkInterfaces,
      ))
        add(resolve(ref, index));
    else if (type !== "subnet")
      for (const subnet of endpointSubnets(resource, index)) add(subnet);
  };
  add(index.get(canonicalId(resourceId)));
  for (const item of index.values()) if (hopType(item) === "private_endpoint"
    && objects(item.properties.privateLinkServiceConnections).some(connection => idFromRef(object(connection.properties).privateLinkServiceId) === canonicalId(resourceId))) add(item);
  return ids;
}
/**
 * Azure applies outbound NSG rules (and route tables) where traffic leaves the source
 * NIC/subnet and inbound rules where it reaches the destination NIC/subnet. A hop is
 * on the source side when it belongs to the source endpoint and on the destination
 * side when it belongs to the destination endpoint; a shared subnet is both. A hop
 * that belongs to neither but comes after the last source-side hop (for example the
 * NIC behind a destination public IP or load balancer) is treated as destination side.
 */
function hopSides(
  hops: readonly PathHop[],
  sourceId: string,
  destinationId: string,
  index: ResourceIndex,
): HopSide[] {
  const source = endpointAttachments(sourceId, index);
  const destination = endpointAttachments(destinationId, index);
  // A destination LB keeps its frontend subnet as destination side (inbound), even when that subnet
  // is also the source's own subnet; the path ends at the LB, so its backends are not on it.
  const destinationResource = index.get(canonicalId(destinationId));
  if (destinationResource && hopType(destinationResource) === "load_balancer")
    for (const config of objects(destinationResource.properties.frontendIPConfigurations)) {
      const id = idFromRef(object(config.properties).subnet);
      if (id) destination.add(canonicalId(id));
    }
  // A source LB is pass-through: its frontend subnet filters neither side, unless it is also an
  // endpoint's own subnet. A destination LB keeps that subnet's inbound rules, because the path ends
  // at the LB and its backends (often in the same subnet) are not on the path.
  const sourceResource = index.get(canonicalId(sourceId));
  const passThrough = new Set(
    (sourceResource && hopType(sourceResource) === "load_balancer" ? [sourceResource] : [])
      .flatMap((lb) => objects(lb.properties.frontendIPConfigurations))
      .map((config) => idFromRef(object(config.properties).subnet))
      .filter((id): id is string => !!id && !source.has(id) && !destination.has(id)),
  );
  let lastSource = -1;
  hops.forEach((hop, i) => {
    if (source.has(hop.resourceId)) lastSource = i;
  });
  return hops.map((hop, i) => {
    if (passThrough.has(canonicalId(hop.resourceId)))
      return { outbound: false, inbound: false };
    const outbound = source.has(hop.resourceId);
    return {
      outbound,
      inbound: destination.has(hop.resourceId) || (!outbound && i > lastSource),
    };
  });
}
function classifyHop(
  hop: PathHop,
  index: ResourceIndex,
  query: PathQuery,
  side: HopSide,
  strict: boolean,
  knownOmissions: boolean,
  skipInboundNsg = false,
  skipOutboundNsg = false,
  skipRoute = false,
): DiagnosticHop {
  const neutral: DiagnosticHop = { ...hop, verdict: "allowed", reasonCodes: [], evidence: [] };
  if (!["subnet", "nic"].includes(hop.hopType)) return neutral;
  const resource = index.get(canonicalId(hop.resourceId));
  if (!resource) return { ...neutral, verdict: "unknown", reasonCodes: ["missing-data"] };
  const inbound = side.inbound && !skipInboundNsg
    ? evaluateNsg(resource, index, "inbound", query, strict, knownOmissions)
    : NO_NSG;
  const outbound = side.outbound && !skipOutboundNsg
    ? evaluateNsg(resource, index, "outbound", query, strict, knownOmissions)
    : NO_NSG;
  // Route tables only steer traffic leaving their subnet, so only source-side hops use them.
  const routeId = !side.outbound || skipRoute
    ? null
    : (idFromRef(resource.properties.routeTable) ??
      (hop.hopType === "nic"
        ? subnetResources(resource, index)
            .map((subnet) => idFromRef(subnet.properties.routeTable))
            .find(Boolean)
        : null));
  const rt = routeId ? index.get(routeId) : undefined;
  const userRoutes = rt ? parseRouteTableRoutes(rt) : [];
  const route = rt
    ? diagnoseRouteVerdict(
        userRoutes.length && query.destinationAddressPrefix
          ? [...userRoutes, ...systemRoutes(resource, index)]
          : userRoutes,
        { destinationPrefix: query.destinationAddressPrefix },
      )
    : routeId
      ? { verdict: "unknown" as const, route: null, reasonCodes: ["route-table-reference-missing" as const], routes: [] }
      : null;
  const reasonCodes = unique([...inbound.reasonCodes, ...outbound.reasonCodes, ...(route?.reasonCodes ?? [])]);
  const evidence = [...inbound.evidence, ...outbound.evidence,
    ...(rt && route ? ruleFacts(rt, unique(route.routes.flatMap(item => item.diagnostic?.propertyPaths ?? [])), ["addressPrefix", "nextHopType", "nextHopIpAddress"]) : []),
    ...(routeId ? [fact(resource, "/properties/routeTable/id")] : [])];
  if (route?.route?.origin === "system") {
    const vnet = vnetForResource(resource, index);
    for (const item of vnet ? [vnet, ...peeredVnets(vnet, index)] : [])
      evidence.push(...addressSpace(item).map((_, i) => fact(item, `/properties/addressSpace/addressPrefixes/${i}`)));
  }
  if (side.outbound && !routeId && !skipRoute) reasonCodes.push("route-table-not-attached", "effective-routes-not-collected");
  if (strict && side.outbound && !skipRoute && hop.hopType === "subnet") {
    if (!Object.hasOwn(resource.properties, "routeTable")) {
      if (!knownOmissions || !resource.observedFields?.includes("properties")) reasonCodes.push("missing-data");
    }
    else if (resource.properties.routeTable !== null && !idFromRef(resource.properties.routeTable)) reasonCodes.push("invalid-data");
  }
  const values = [inbound.verdict, outbound.verdict, route?.verdict];
  const verdict: PathVerdict = values.includes("blocked") ? "blocked" : values.includes("unknown") || reasonCodes.some(code => code === "missing-data" || code === "invalid-data") ? "unknown" : "allowed";
  return {
    ...hop, verdict, reasonCodes, evidence,
    nsgVerdict: inbound.verdict ?? outbound.verdict,
    nsgName: inbound.name ?? outbound.name,
    nsgRuleName: inbound.ruleName ?? outbound.ruleName,
    nsgDirection:
      inbound.verdict !== null
        ? "inbound"
        : outbound.verdict !== null
          ? "outbound"
          : null,
    nsgOutboundVerdict: outbound.verdict,
    nsgOutboundName: outbound.name,
    nsgOutboundRuleName: outbound.ruleName,
    routeVerdict: route?.verdict ?? null,
    routeTableName: rt ? displayName(rt) : null,
    routeName: route?.route?.name ?? null,
    routeNextHopType: route?.route?.nextHopType ?? null,
    routeNextHopIp: route?.route?.nextHopIp ?? null,
  };
}

type Edge = {
  targetId: string;
  isPeering: boolean;
  allowForwardedTraffic: boolean | null;
};
type State = {
  id: string;
  peeringHops: number;
  forwardedAllowed: boolean;
  parent: State | null;
  boundary: boolean;
};
function tracePath(
  index: ResourceIndex,
  sourceId: string,
  destinationId: string,
) {
  const resources = [...index.values()];
  const adjacency = new Map<string, Edge[]>();
  function add(
    source: string,
    target: string,
    isPeering = false,
    allowForwardedTraffic: boolean | null = null,
  ) {
    const key = canonicalId(source);
    adjacency.set(key, [
      ...(adjacency.get(key) ?? []),
      { targetId: canonicalId(target), isPeering, allowForwardedTraffic },
    ]);
  }
  for (const relation of buildExplicitRelations(resources)) {
    if (relation.type !== "connects_to") continue;
    if (relation.evidence.some(path => path.includes("backendAddressPools"))) continue;
    if (
      relation.evidence.some((evidence) =>
        evidence.includes("virtualNetworkPeerings"),
      )
    )
      continue;
    add(relation.sourceId, relation.targetId);
    add(relation.targetId, relation.sourceId);
  }
  // Gateway subnet references are attachment evidence, unlike backend targets.
  for (const gateway of resources.filter(resource => hopType(resource) === "application_gateway"))
    for (const subnet of endpointSubnets(gateway, index)) {
      add(gateway.id, subnet.id); add(subnet.id, gateway.id);
    }
  for (const source of resources.filter(
    (resource) => hopType(resource) === "vnet",
  )) {
    for (const target of resources.filter(
      (resource) => hopType(resource) === "vnet",
    )) {
      const props = peeringProperties(source, target.id);
      if (
        !isConnected(props) ||
        !isConnected(peeringProperties(target, source.id)) ||
        props?.allowVirtualNetworkAccess === false ||
        peeringProperties(target, source.id)?.allowVirtualNetworkAccess === false
      )
        continue;
      add(
        source.id,
        target.id,
        true,
        typeof props?.allowForwardedTraffic === "boolean"
          ? props.allowForwardedTraffic
          : null,
      );
    }
  }
  const queue: State[] = [
    {
      id: sourceId,
      peeringHops: 0,
      forwardedAllowed: true,
      parent: null,
      boundary: false,
    },
  ];
  const key = (state: State) =>
    JSON.stringify([state.id, state.peeringHops, state.forwardedAllowed]);
  const visited = new Set([key(queue[0])]);
  let found: State | undefined;
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const current = queue[cursor];
    if (current.id === destinationId) {
      found = current;
      break;
    }
    // PaaS targets, gateways, LB frontends and public IPs are endpoints, never routers.
    if (current.id !== sourceId && !["vm", "nic", "subnet", "vnet", "private_endpoint"].includes(hopType(index.get(current.id)!))) continue;
    if (current.id !== sourceId && hopType(index.get(current.id)!) === "vm") continue;
    for (const edge of adjacency.get(current.id) ?? []) {
      const peeringHops = current.peeringHops + Number(edge.isPeering);
      const forwardedAllowed =
        current.forwardedAllowed &&
        (!edge.isPeering || edge.allowForwardedTraffic === true);
      if (
        peeringHops > Math.max(resources.length, 1) ||
        (peeringHops > 1 && !forwardedAllowed)
      )
        continue;
      const next: State = {
        id: edge.targetId,
        peeringHops,
        forwardedAllowed,
        parent: current,
        boundary: edge.isPeering,
      };
      if (visited.has(key(next))) continue;
      visited.add(key(next));
      queue.push(next);
    }
  }
  if (!found) return null;
  const path: State[] = [];
  for (let state: State | null = found; state; state = state.parent)
    path.push(state);
  const hops: PathHop[] = path.reverse().map((state) => {
    const resource = index.get(state.id)!;
    return {
      resourceId: canonicalId(resource.id),
      resourceType: resource.type.toLowerCase(),
      hopType: hopType(resource),
      displayName: displayName(resource),
      isPeeringBoundary: state.boundary,
    };
  });
  return {
    hops,
    peeringHopCount: found.peeringHops,
    isForwardedTraffic: found.peeringHops === 0 ? null : found.peeringHops > 1,
  };
}
/**
 * Application Gateway instances send backend traffic out of their own subnet, but the
 * backend pool relation links the gateway straight to the backend NIC, so that subnet is
 * not on the traced path. Insert it right after the gateway so its outbound NSG and route
 * table are evaluated as source side.
 */
function withGatewaySubnetHops(
  hops: readonly PathHop[],
  index: ResourceIndex,
  sourceId: string,
): PathHop[] {
  const source = index.get(sourceId);
  if (!source || hopType(source) !== "application_gateway" || !hops.length)
    return [...hops];
  const onPath = new Set(hops.map((hop) => canonicalId(hop.resourceId)));
  const missing = new Map<string, PathHop>();
  for (const subnet of endpointSubnets(source, index)) {
    const id = canonicalId(subnet.id);
    if (onPath.has(id) || missing.has(id)) continue;
    missing.set(id, {
      resourceId: id,
      resourceType: subnet.type.toLowerCase(),
      hopType: hopType(subnet),
      displayName: displayName(subnet),
      isPeeringBoundary: false,
    });
  }
  return [hops[0], ...missing.values(), ...hops.slice(1)];
}
function verdicts(hop: PathHop) {
  return [hop.nsgVerdict, hop.nsgOutboundVerdict, hop.routeVerdict];
}
function overallVerdict(hops: readonly PathHop[]): PathVerdict {
  const values = hops.flatMap(verdicts);
  if (values.includes("blocked")) return "blocked";
  if (values.includes("unknown") || !values.includes("allowed"))
    return "unknown";
  return "allowed";
}
function routeNextHopLabel(
  type: string,
  ip: string | null | undefined,
): string {
  switch (type.trim().toLowerCase()) {
    case "vnetlocal":
      return "direct within VNet";
    case "virtualnetwork":
      return "direct within virtual network";
    case "vnetpeering":
      return "direct via VNet peering";
    case "internet":
      return "internet-bound";
    case "virtualappliance":
      return ip ? `via appliance ${ip}` : "via appliance";
    case "virtualnetworkgateway":
      return "via virtual network gateway";
    case "none":
      return "black hole dropped";
    default:
      return `via ${type}${ip ? ` ${ip}` : ""}`;
  }
}
function hopDetail(hop: PathHop): string {
  const nsg = [
    hop.nsgDirection === "inbound" && hop.nsgVerdict
      ? `inNSG=${hop.nsgVerdict}`
      : null,
    hop.nsgOutboundVerdict ? `outNSG=${hop.nsgOutboundVerdict}` : null,
  ].filter(Boolean);
  const route = [
    hop.routeVerdict ? `route=${hop.routeVerdict}` : null,
    hop.routeNextHopType
      ? routeNextHopLabel(hop.routeNextHopType, hop.routeNextHopIp)
      : null,
  ].filter(Boolean);
  return [
    hop.displayName,
    nsg.length ? `(${nsg.join(", ")})` : null,
    route.length ? `(${route.join(", ")})` : null,
  ]
    .filter(Boolean)
    .join(" ");
}
function verdictReason(hops: readonly PathHop[], verdict: PathVerdict): string {
  if (verdict !== "unknown") {
    const details = hops
      .filter((hop) => verdicts(hop).includes(verdict))
      .map(hopDetail)
      .join(", ");
    return verdict === "allowed"
      ? `All hops allow traffic: ${details}`
      : `Traffic blocked at: ${details}`;
  }
  const unknown = hops.filter(
    (hop) =>
      verdicts(hop).every((value) => value == null) ||
      verdicts(hop).includes("unknown"),
  );
  return unknown.length
    ? `Insufficient NSG/route data for hops: ${unknown.map(hopDetail).join(", ")}`
    : "Verdict unknown: insufficient data for classification";
}

function endpointAddresses(resource: InventoryResource, index: ResourceIndex, visited = new Set<string>()): string[] {
  if (visited.has(resource.id)) return [];
  visited.add(resource.id);
  const props = resource.properties;
  const refs = hopType(resource) === "vm" ? objects(object(props.networkProfile).networkInterfaces)
    : hopType(resource) === "private_endpoint" ? objects(props.networkInterfaces) : [];
  const addresses: unknown[] = [props.ipAddress,
    ...objects(props.ipConfigurations).map(config => object(config.properties).privateIPAddress),
    ...objects(props.frontendIPConfigurations).map(config => object(config.properties).privateIPAddress),
    ...objects(props.customDnsConfigs).flatMap(config => Array.isArray(config.ipAddresses) ? config.ipAddresses : [])];
  for (const ref of refs) {
    const target = resolve(ref, index);
    if (target) addresses.push(...endpointAddresses(target, index, visited));
  }
  // A PaaS destination has an address only through a single collected private endpoint.
  const endpoints = [...index.values()].filter(item => hopType(item) === "private_endpoint"
    && objects(item.properties.privateLinkServiceConnections).some(connection => idFromRef(object(connection.properties).privateLinkServiceId) === resource.id));
  if (endpoints.length === 1) addresses.push(...endpointAddresses(endpoints[0], index, visited));
  return unique(addresses.filter((value): value is string => typeof value === "string" && !!parsePrefix(value)
    && !value.includes("/")));
}
function endpointFacts(resource: InventoryResource, index: ResourceIndex): Evidence[] {
  const facts: Evidence[] = [];
  const ids = endpointAttachments(resource.id, index);
  for (const id of ids) {
    const item = index.get(id)!;
    if (Object.hasOwn(item.properties, "ipAddress")) facts.push(fact(item, "/properties/ipAddress"));
    for (const field of ["ipConfigurations", "frontendIPConfigurations", "gatewayIPConfigurations"])
      for (const [i, config] of objects(item.properties[field]).entries()) {
        if (Object.hasOwn(object(config.properties), "privateIPAddress")) facts.push(fact(item, `/properties/${field}/${i}/properties/privateIPAddress`));
        facts.push(fact(item, `/properties/${field}/${i}/properties/subnet/id`));
      }
    for (const [i, config] of objects(item.properties.customDnsConfigs).entries())
      for (const j of Array.isArray(config.ipAddresses) ? config.ipAddresses.keys() : []) facts.push(fact(item, `/properties/customDnsConfigs/${i}/ipAddresses/${j}`));
    for (const [i] of objects(object(item.properties.networkProfile).networkInterfaces).entries())
      facts.push(fact(item, `/properties/networkProfile/networkInterfaces/${i}/id`));
  }
  return facts;
}
function resolveAddresses(index: ResourceIndex, query: PathQuery, strict: boolean): { query: PathQuery; reasonCodes: NetworkReasonCode[] } {
  const reasonCodes: NetworkReasonCode[] = [];
  const address = (id: string, supplied: string | null | undefined): string | null => {
    // Existing API can still describe explicit hypothetical traffic. Stored diagnostics cannot.
    if (!strict && supplied) return supplied;
    const candidates = endpointAddresses(index.get(canonicalId(id))!, index);
    if (supplied) {
      const parsed = parsePrefix(supplied);
      if (!parsed || parsed.length !== (parsed.version === 4 ? 32 : 128)
        || !candidates.some(ip => prefixContains(supplied, ip) === true)) {
        reasonCodes.push("endpoint-address-mismatch"); return null;
      }
      return supplied;
    }
    if (candidates.length !== 1) { reasonCodes.push("endpoint-address-unresolved"); return null; }
    return candidates[0];
  };
  const sourceAddressPrefix = address(query.sourceResourceId, query.sourceAddressPrefix);
  const destinationAddressPrefix = address(query.destinationResourceId, query.destinationAddressPrefix);
  if (sourceAddressPrefix && destinationAddressPrefix && parsePrefix(sourceAddressPrefix)?.version !== parsePrefix(destinationAddressPrefix)?.version)
    reasonCodes.push("address-family-mismatch");
  return { query: { ...query, sourceAddressPrefix, destinationAddressPrefix }, reasonCodes: unique(reasonCodes) };
}
function noPathCodes(index: ResourceIndex, sourceId: string, destinationId: string): NetworkReasonCode[] {
  const codes: NetworkReasonCode[] = ["no-path-in-scan"];
  for (const endpoint of [sourceId, destinationId]) for (const id of endpointAttachments(endpoint, index)) {
    const vnet = hopType(index.get(id)!) === "vnet" ? index.get(id) : vnetForResource(index.get(id)!, index);
    if (!vnet) continue;
    for (const raw of objects(vnet.properties.virtualNetworkPeerings)) {
      const props = object(raw.properties), peerId = idFromRef(props.remoteVirtualNetwork);
      const peer = peerId ? index.get(peerId) : undefined;
      if (!peer) codes.push("peer-vnet-not-in-scan");
      else if (!peeringProperties(peer, vnet.id)) codes.push("peering-one-way");
      else if (!isConnected(props) || !isConnected(peeringProperties(peer, vnet.id))) codes.push("peering-not-connected");
      else if (props.allowVirtualNetworkAccess === false || peeringProperties(peer, vnet.id)?.allowVirtualNetworkAccess === false) codes.push("peering-access-disabled");
      else if (props.allowVirtualNetworkAccess !== true) codes.push("missing-data");
    }
  }
  return unique(codes);
}
function decorateTopology(hops: DiagnosticHop[], index: ResourceIndex, peeringCount: number, strict: boolean) {
  for (const [i, hop] of hops.entries()) {
    const resource = index.get(hop.resourceId)!;
    if (hop.hopType === "other") { hop.verdict = "unknown"; hop.reasonCodes.push("unsupported-type"); }
    if (hop.isPeeringBoundary) {
      const previous = index.get(hops[i - 1]?.resourceId);
      for (const [from, to] of previous ? [[previous, resource], [resource, previous]] : []) {
        const entries = objects(from.properties.virtualNetworkPeerings);
        const n = entries.findIndex(raw => idFromRef(object(raw.properties).remoteVirtualNetwork) === to.id);
        const path = `/properties/virtualNetworkPeerings/${n}/properties`;
        hop.evidence.push(...["remoteVirtualNetwork/id", "peeringState", "allowVirtualNetworkAccess", "allowForwardedTraffic"].map(field => fact(from, `${path}/${field}`)));
        const props = object(entries[n]?.properties);
        if (strict && props.allowVirtualNetworkAccess !== true) { hop.verdict = "unknown"; hop.reasonCodes.push(props.allowVirtualNetworkAccess === false ? "peering-access-disabled" : "missing-data"); }
      }
      if (peeringCount > 1) { hop.verdict = "unknown"; hop.reasonCodes.push("transitive-peering-requires-forwarder"); }
    }
    if (hop.hopType !== "private_endpoint") continue;
    const connections = objects(resource.properties.privateLinkServiceConnections);
    const target = hops[i + 1]?.resourceId;
    const matching = connections.filter(connection => idFromRef(object(connection.properties).privateLinkServiceId) === target);
    const selected = matching.length ? matching : connections;
    const valid = selected.length === 1 && object(object(selected[0].properties).privateLinkServiceConnectionState).status === "Approved";
    for (const connection of selected) {
      const n = connections.indexOf(connection);
      hop.evidence.push(fact(resource, `/properties/privateLinkServiceConnections/${n}/properties/privateLinkServiceConnectionState/status`));
    }
    if (!valid) { hop.verdict = "unknown"; hop.reasonCodes.push("private-link-connection-not-approved"); }
    const subnet = resolve(resource.properties.subnet, index);
    const policy = subnet?.properties.privateEndpointNetworkPolicies;
    if (subnet) hop.evidence.push(fact(subnet, "/properties/privateEndpointNetworkPolicies"));
    if (!["Enabled", "Disabled", "NetworkSecurityGroupEnabled", "RouteTableEnabled"].includes(String(policy))) {
      hop.verdict = "unknown"; hop.reasonCodes.push("missing-data");
    } else if (policy === "Disabled" || policy === "RouteTableEnabled") hop.reasonCodes.push("nsg-not-applied-private-endpoint-policy");
  }
}

/** ADR-020: ARM 참조로 경로를 찾고 NSG·경로·피어링 근거로 판정한다. 외부 I/O는 없다. */
function analyzePathCore(
  resources: readonly InventoryResource[],
  query: PathQuery,
  strict = false,
  knownOmissions = false,
): PathAnalysisResult & { diagnostic: NetworkEngineResult } {
  const index = indexResources(resources);
  const sourceId = canonicalId(query.sourceResourceId);
  const destinationId = canonicalId(query.destinationResourceId);
  const warnings: string[] = [];
  const empty = (reasonCodes: NetworkReasonCode[]): NetworkEngineResult => ({ engineVersion: "1", sourceResourceId: sourceId, destinationResourceId: destinationId, verdict: "unknown", reasonCodes, paths: [] });
  const base = {
    sourceResourceId: query.sourceResourceId,
    destinationResourceId: query.destinationResourceId,
  };
  if (!index.has(sourceId))
    warnings.push(`Source resource not found: ${query.sourceResourceId}`);
  if (!index.has(destinationId))
    warnings.push(
      `Destination resource not found: ${query.destinationResourceId}`,
    );
  if (warnings.length)
    return { ...base, overallVerdict: "unknown", pathCandidates: [], warnings, diagnostic: empty(["endpoint-not-in-scan"]) };
  const trace = tracePath(index, sourceId, destinationId);
  if (!trace)
    return {
      ...base,
      overallVerdict: "unknown",
      pathCandidates: [],
      warnings: ["No network path found between source and destination"],
      diagnostic: empty(noPathCodes(index, sourceId, destinationId)),
    };
  const addresses = resolveAddresses(index, query, strict);
  query = addresses.query;
  const tracedHops = withGatewaySubnetHops(trace.hops, index, sourceId);
  const sides = hopSides(tracedHops, sourceId, destinationId, index);
  const privateEndpoints = tracedHops.filter(hop => hop.hopType === "private_endpoint");
  const policySkips = (hop: PathHop, outbound: boolean, nsg: boolean) => privateEndpoints.some(pe => {
    const subnet = resolve(index.get(pe.resourceId)!.properties.subnet, index);
    if (subnet?.id !== hop.resourceId) return false;
    const onSource = endpointAttachments(sourceId, index).has(pe.resourceId);
    if (outbound !== onSource) return false;
    const policy = subnet.properties.privateEndpointNetworkPolicies;
    return !["Enabled", "Disabled", "NetworkSecurityGroupEnabled", "RouteTableEnabled"].includes(String(policy))
      || policy === "Disabled" || policy === (nsg ? "RouteTableEnabled" : "NetworkSecurityGroupEnabled");
  });
  const hops = tracedHops.map((hop, i) => classifyHop(hop, index, query, sides[i], strict, knownOmissions,
    policySkips(hop, false, true), policySkips(hop, true, true), policySkips(hop, true, false)));
  decorateTopology(hops, index, trace.peeringHopCount, strict);
  hops[0].evidence.push(...endpointFacts(index.get(sourceId)!, index));
  hops.at(-1)!.evidence.push(...endpointFacts(index.get(destinationId)!, index));
  if (addresses.reasonCodes.length) for (const hop of hops) {
    hop.verdict = "unknown";
    hop.reasonCodes.push(...addresses.reasonCodes);
  }
  const diagnosticHops = hops.map(hop => {
    if (!hop.evidence.length) hop.evidence.push(fact(index.get(hop.resourceId)!, "/type"));
    return { resourceId: hop.resourceId, hopType: hop.hopType, verdict: hop.verdict,
      reasonCodes: unique(hop.reasonCodes), evidence: hop.evidence };
  });
  const codes = unique(["single-candidate" as const, ...diagnosticHops.flatMap(hop => hop.reasonCodes)]);
  const storedVerdict = diagnosticHops.some(hop => hop.verdict === "blocked") ? "blocked"
    : diagnosticHops.some(hop => hop.verdict === "unknown") ? "unknown" : "allowed";
  const verdict = strict || addresses.reasonCodes.length || trace.peeringHopCount > 1 || hops.some(h => h.reasonCodes.includes("private-link-connection-not-approved") || h.hopType === "private_endpoint" && h.verdict === "unknown")
    ? storedVerdict : overallVerdict(hops);
  return {
    ...base,
    overallVerdict: verdict,
    diagnostic: { engineVersion: "1", sourceResourceId: sourceId, destinationResourceId: destinationId,
      verdict: storedVerdict, reasonCodes: codes, paths: [{ verdict: storedVerdict, reasonCodes: codes, hops: diagnosticHops }] },
    warnings,
    pathCandidates: [
      {
        ...base,
        verdict,
        hops,
        reason: verdictReason(hops, verdict),
        peeringHopCount: trace.peeringHopCount,
        isForwardedTraffic: trace.isForwardedTraffic,
      },
    ],
  };
}

/** Legacy explicit traffic queries remain usable; resource-only callers resolve saved addresses. */
export function analyzePath(resources: readonly InventoryResource[], query: PathQuery): PathAnalysisResult {
  const { diagnostic: _diagnostic, ...result } = analyzePathCore(resources, query);
  void _diagnostic;
  return result;
}
/** W0 diagnostic: strict endpoint identity, structured codes/evidence, no English parsing. */
export function diagnosePath(resources: readonly InventoryResource[], query: PathQuery, sourceScan?: SourceScan): NetworkEngineResult {
  // Only the server's validated complete live projection can attest that an
  // omitted optional association means none. Imports and legacy rows stay unknown.
  const source = sourceScanSchema.safeParse(sourceScan);
  const knownOmissions = source.success && source.data.source === "live" && source.data.completeness.state === "complete";
  return analyzePathCore(resources, query, true, knownOmissions).diagnostic;
}
