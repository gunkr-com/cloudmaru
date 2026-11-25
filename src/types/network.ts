import type { NetworkReasonCode } from "./network-diagnostics";

export type PathVerdict = "allowed" | "blocked" | "unknown";
export type HopType = "vnet" | "subnet" | "nic" | "nsg" | "route_table" | "private_endpoint"
  | "load_balancer" | "application_gateway" | "public_ip" | "vm" | "storage_account"
  | "sql_managed_instance" | "web_app" | "other";

export type NetworkParseDiagnostic = Readonly<{
  reasonCodes: readonly NetworkReasonCode[];
  propertyPaths: readonly string[];
}>;

type RuleValue = string | readonly string[] | null;
export type NSGRule = Readonly<{
  direction: string;
  access: string;
  priority: number;
  name: string;
  sourceAddressPrefix?: RuleValue;
  sourcePortRange?: RuleValue;
  destinationAddressPrefix?: RuleValue;
  destinationPortRange?: RuleValue;
  protocol?: string | null;
  diagnostic?: NetworkParseDiagnostic;
}>;
export type RouteEntry = Readonly<{
  origin?: "user" | "system";
  name: string;
  addressPrefix?: string | null;
  nextHopType?: string | null;
  nextHopIp?: string | null;
  diagnostic?: NetworkParseDiagnostic;
}>;
export type PathHop = Readonly<{
  resourceId: string;
  resourceType: string;
  hopType: HopType;
  displayName: string;
  nsgVerdict?: PathVerdict | null;
  nsgName?: string | null;
  nsgRuleName?: string | null;
  nsgDirection?: string | null;
  nsgOutboundVerdict?: PathVerdict | null;
  nsgOutboundName?: string | null;
  nsgOutboundRuleName?: string | null;
  routeVerdict?: PathVerdict | null;
  routeTableName?: string | null;
  routeName?: string | null;
  routeNextHopType?: string | null;
  routeNextHopIp?: string | null;
  isPeeringBoundary?: boolean;
}>;
export type PathCandidate = Readonly<{
  sourceResourceId: string;
  destinationResourceId: string;
  verdict: PathVerdict;
  hops: readonly PathHop[];
  reason: string;
  peeringHopCount?: number;
  isForwardedTraffic?: boolean | null;
}>;
export type PathAnalysisResult = Readonly<{
  sourceResourceId: string;
  destinationResourceId: string;
  overallVerdict: PathVerdict;
  pathCandidates: readonly PathCandidate[];
  warnings: readonly string[];
}>;
export type PathQuery = Readonly<{
  sourceResourceId: string;
  destinationResourceId: string;
  protocol?: string | null;
  sourceAddressPrefix?: string | null;
  destinationAddressPrefix?: string | null;
  sourcePort?: number | null;
  destinationPort?: number | null;
}>;
