import { canonicalId, isCanonicalArmResourceId } from "@/lib/inventory/normalize";
import { parseScanInventory } from "@/lib/scans/rows";
import { sourceScanSchema } from "./schema";
import type { CompletionReasonCode, SourceScan } from "@/types/completion";
import type { ScanInventory, ScanRecord } from "@/types/scan";
import type { InventoryResource } from "@/types/inventory";

function matchesResourceIdentity(resource: InventoryResource, id: string): boolean {
  if (!isCanonicalArmResourceId(id)) return false;
  const parts = id.split("/");
  if (parts.some(part => part === "." || part === "..")
    || parts[4] !== resource.resourceGroup.trim().toLowerCase()) return false;
  // Extension resources use the final provider namespace. Names occupy the
  // alternating positions, so a resource named "providers" is not a marker.
  let provider = 5;
  for (let index = 9; index < parts.length; index += 2) {
    if (parts[index] === "providers") provider = index;
  }
  const types = parts.slice(provider + 2).filter((_, index) => index % 2 === 0);
  return [parts[provider + 1], ...types].join("/") === resource.type.trim().toLowerCase();
}

export class CompletionSourceScanError extends Error {
  constructor() { super("Invalid completed scan."); }
}

/** 저장된 스캔의 범위를 공통 계약으로 옮긴다. 추정이나 I/O는 하지 않는다. */
export function toCompletionSourceScan(scan: ScanRecord, inventory: ScanInventory): SourceScan {
  try {
    if (scan.status !== "succeeded" || !scan.summary || !scan.collectedAt) {
      throw new CompletionSourceScanError();
    }
    const data = parseScanInventory(inventory);
    const subscriptionIds = scan.subscriptionIds.map(id => id.toLowerCase());
    const requested = new Set(subscriptionIds);
    const observed = new Set(data.resources.map(resource => resource.subscriptionId.toLowerCase()));
    const resourceIds = data.resources.map(resource => canonicalId(resource.id));
    const invalidData = scan.summary.resourceCount !== data.resources.length
      || new Set(resourceIds).size !== resourceIds.length
      || data.resources.some((resource, index) => {
        const subscriptionId = resource.subscriptionId.toLowerCase();
        return !requested.has(subscriptionId)
          || !resourceIds[index].startsWith(`/subscriptions/${subscriptionId}/`)
          || !matchesResourceIdentity(resource, resourceIds[index]);
      });
    const partialReasons: CompletionReasonCode[] = [];
    if (data.skippedRows > 0) partialReasons.push("collection-partial");
    if (subscriptionIds.some(id => !observed.has(id))) partialReasons.push("scope-not-collected");
    if (invalidData) partialReasons.push("invalid-data");
    const legacy = data.resources.some(resource => resource.observedFields === undefined);
    const reasons = [...partialReasons];
    const imported = scan.source === "import";
    // Import scope comes from the uploaded rows; no query or paging evidence
    // establishes that absent resources were actually collected.
    if (imported) reasons.push("import-scope-unverified");
    if (legacy) reasons.push("legacy-completeness-unknown");
    const completeness = partialReasons.length ? { state: "partial" as const, reasons }
      : legacy || imported ? { state: "unknown" as const, reasons }
      : { state: "complete" as const, reasons: [] };
    return sourceScanSchema.parse({
      id: scan.id, workspaceId: scan.workspaceId, status: "succeeded", source: scan.source,
      collectedAt: scan.collectedAt, subscriptionIds, completeness,
    });
  } catch {
    // 잘못된 행이나 원본 속성을 오류/로그에 포함하지 않는다.
    throw new CompletionSourceScanError();
  }
}
