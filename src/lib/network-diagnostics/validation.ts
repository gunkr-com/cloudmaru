import { z } from "zod";
import { networkQuerySchema, networkEngineResultSchema } from "@/lib/completion/schema";
import { canonicalId, isCanonicalArmResourceId } from "@/lib/inventory/normalize";
import { splitSubnets } from "@/lib/inventory/split-subnets";
import type { InventoryResource } from "@/types/inventory";
import type { NetworkQuery, NetworkEngineResult } from "@/types/network-diagnostics";

// 로컬 동기 계산의 입력·그래프 상한. 주소는 저장된 인벤토리에서만 해석한다.
export const NETWORK_BODY_MAX_BYTES = 16 * 1024;
export const NETWORK_RESOURCE_LIMIT = 2000;
export const NETWORK_STALE_MS = 5 * 60 * 1000;
const endpoint = z.string().max(2048).transform(canonicalId).refine(isCanonicalArmResourceId);
const queryInput = z.strictObject({
  sourceScanId: z.uuid(), sourceResourceId: endpoint, destinationResourceId: endpoint,
  protocol: z.enum(["tcp", "udp", "icmp", "any"]),
  sourcePort: z.number().nullable().optional().transform(value => value ?? null),
  destinationPort: z.number().nullable().optional().transform(value => value ?? null),
}).pipe(networkQuerySchema);
export const networkInputSchema = z.strictObject({
  schemaVersion: z.literal(1), workspaceId: z.uuid(), sourceScanId: z.uuid(), query: queryInput,
}).refine(value => value.sourceScanId === value.query.sourceScanId);
export type NetworkInput = z.infer<typeof networkInputSchema>;
export type NetworkInputCode = "invalid-query" | "resource-missing" | "inventory-too-large";
export class NetworkInputError extends Error {
  constructor(readonly code: NetworkInputCode) { super(code); }
}

export function networkResources(resources: readonly InventoryResource[]): InventoryResource[] {
  for (const resource of resources) {
    if (resource.type !== "microsoft.network/virtualnetworks" || !Array.isArray(resource.properties.subnets)) continue;
    for (const raw of resource.properties.subnets) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw) || typeof raw.id !== "string" || !raw.id.trim()) continue;
      const id = canonicalId(raw.id);
      const prefix = `${canonicalId(resource.id)}/subnets/`;
      if (!id.startsWith(prefix) || !id.slice(prefix.length) || id.slice(prefix.length).includes("/")
        || typeof raw.name === "string" && id !== canonicalId(`${prefix}${raw.name}`)) throw new NetworkInputError("invalid-query");
    }
  }
  const expanded = splitSubnets(resources);
  const ids = expanded.map(r => canonicalId(r.id));
  if (expanded.length > NETWORK_RESOURCE_LIMIT) throw new NetworkInputError("inventory-too-large");
  if (ids.some(id => !isCanonicalArmResourceId(id))
    || new Set(ids).size !== ids.length) throw new NetworkInputError("invalid-query");
  return expanded;
}
export function validateNetworkMembers(resources: readonly InventoryResource[], query: NetworkQuery): InventoryResource[] {
  const expanded = networkResources(resources);
  const members = new Set(expanded.map(r => canonicalId(r.id)));
  if (!members.has(query.sourceResourceId) || !members.has(query.destinationResourceId)) throw new NetworkInputError("resource-missing");
  return expanded;
}
export function validateNetworkEngine(resources: readonly InventoryResource[], query: NetworkQuery, raw: unknown): NetworkEngineResult {
  const members = new Set(validateNetworkMembers(resources, query).map(r => canonicalId(r.id)));
  const engine = networkEngineResultSchema.parse(raw);
  if (engine.sourceResourceId !== query.sourceResourceId || engine.destinationResourceId !== query.destinationResourceId
    || engine.paths.some(path => path.hops.some(hop => !members.has(hop.resourceId)
      || hop.evidence.some(evidence => !members.has(evidence.resourceId))))) throw new NetworkInputError("invalid-query");
  return engine;
}
