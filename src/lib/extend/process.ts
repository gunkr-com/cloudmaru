import "server-only";
import { createHash } from "node:crypto";
import { extensionProposalSchema, extensionResultSchema } from "@/lib/completion/schema";
import { toCompletionSourceScan } from "@/lib/completion/source-scan";
import { loadCatalog } from "@/lib/catalog/load";
import { loadExtensionSupportCatalog } from "@/lib/catalog/extension-support";
import { createExtensionRequestContext, validateExtensionProposal, validateHistoricalExtensionProposal, validatePreDeploymentExtensionProposal, validatePreIntentExtensionProposal, validateExtensionProposalForHistoricalRead } from "./validate-proposal";
import type { ExtensionRequestContext } from "./validate-proposal";
import { calculateExtensionIncrementalCost } from "./incremental-cost";
import { calculateExtensionChecks } from "./deterministic-checks";
import { ExtensionStorageError, validateExtensionStorageMembers } from "./storage-validation";
import type { ExtensionValidationContext } from "./storage-validation";
import type { Catalog } from "@/types/catalog";
import type { ExtensionResult } from "@/types/extension";
import type { ExtensionSupportCatalog } from "@/types/extension-support";

export type ExtensionCoreData = { catalog: Catalog; support: ExtensionSupportCatalog };
export type ExtensionProcessingResult = { ok: true; value: ExtensionResult } | { ok: false; errors: string[] };
// 객체 키 순서만 정규화한다. 배열 순서는 카탈로그/검사 계약의 일부다.
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  return JSON.stringify(value);
}
const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);
const digest = (value: unknown) => createHash("sha256").update(canonical(value)).digest("hex");

/** 날짜만으로는 단가/정책 수정이 식별되지 않는다. 정적 자료 전체의 내용 지문을 보존한다. */
export function getExtensionCoreVersions(catalog: Catalog, support: ExtensionSupportCatalog) {
  return { catalogVersion: `extend-core-v1:sha256:${digest(catalog)}`,
    reusePolicyVersion: `${support.version}:sha256:${digest(support)}` };
}

/** 모델 I/O 없는 처리 API. source/identity는 예약된 행과 그 성공 기준 스캔에서만 가져온다. */
export function processExtensionOutput(
  raw: unknown, context: ExtensionRequestContext, binding: { id: string; createdAt: string },
): ExtensionProcessingResult {
  return processOutput(raw, context, binding, false);
}

function processOutput(raw: unknown, context: ExtensionRequestContext, binding: { id: string; createdAt: string }, historical: boolean, preDeployment = false, preIntent = false,
  historicalRead = false): ExtensionProcessingResult {
  try {
    // v1 저장 계약에는 선택/상한 옵션이 없다. 재열기에 재현 가능한 기본 200개 투영만 사용한다.
    const fixed = createExtensionRequestContext(context.input, context.scan, context.inventory, context.catalog, { support: context.support });
    if (!same(fixed.model.payload, context.model.payload)
      || !same([...fixed.model.aliasToResourceId], [...context.model.aliasToResourceId])) throw new ExtensionStorageError();
    const validate = historical ? validateHistoricalExtensionProposal
      : preDeployment ? validatePreDeploymentExtensionProposal : preIntent ? validatePreIntentExtensionProposal : validateExtensionProposal;
    const proposal = historicalRead ? validateExtensionProposalForHistoricalRead(raw, fixed,
      historical ? "pre-count" : preDeployment ? "pre-deployment" : preIntent ? "pre-intent" : "current") : validate(raw, fixed);
    if (!proposal.ok) return proposal;
    const sourceScan = toCompletionSourceScan(fixed.scan, fixed.inventory);
    const value = extensionResultSchema.parse({ ...proposal.value, ...binding,
      workspaceId: fixed.input.workspaceId, sourceScanId: fixed.input.sourceScanId, sourceScan,
      input: fixed.input, ...getExtensionCoreVersions(fixed.catalog, fixed.support),
      contextCoverage: fixed.model.payload.inventory.coverage,
      plans: proposal.value.plans.map(plan => ({ ...plan,
        incrementalCost: calculateExtensionIncrementalCost(plan, fixed.catalog, { support: fixed.support, region: fixed.input.region }),
        checks: calculateExtensionChecks(plan, fixed),
      })),
    });
    validateExtensionStorageMembers(value, fixed.inventory, fixed.catalog);
    return { ok: true, value };
  } catch { return { ok: false, errors: ["extension: validation-failed"] }; }
}

/** Current writes always enforce today's model contract, including deployment counts. */
export function validateStoredExtensionResult(
  raw: ExtensionResult, context: ExtensionValidationContext,
  data?: ExtensionCoreData,
): void {
  validateStored(raw, context, data, false);
}

/** Only the DB historical read callsite uses this; never accepts a client/model mode. */
export function validateHistoricalStoredExtensionResult(raw: ExtensionResult, context: ExtensionValidationContext, data: ExtensionCoreData, options?: { allowVersionMismatch: boolean }): boolean {
  try {
    const value = extensionResultSchema.parse(raw);
    // Counts identify the newer contract even if its evidence is lost. Partially stripped
    // counts must fail current validation; only wholly count-absent V1 rows need old replay.
    const newItems = value.plans.flatMap(plan => plan.newItems);
    const legacy = newItems.length > 0 && newItems.every(item => item.instanceCount === undefined);
    // Exactly three server-only profiles. Strip only known additive fields, then match
    // BOTH complete catalog and reuse-policy fingerprints. No historical=true bypass
    // may mask a catalog, price or reuse-policy change. Prose policy was not
    // fingerprinted in V1: recognized unsealed reads explicitly retain V1 prose
    // even for current counted rows. This does not attest DB-writer authenticity.
    const pgV1 = structuredClone(data.catalog);
    for (const component of pgV1.components) {
      delete component.extensionDeployment;
      if (component.bicepDeployment?.kind === "postgres-flex-compute") {
        delete component.bicepDeployment.allowedHighAvailabilityModes;
        delete component.bicepDeployment.highAvailabilityBilling;
      }
    }
    for (const a of pgV1.architectures) for (const tier of ["low", "balanced", "ha"] as const) delete a.tiers[tier].deploymentIntent;
    const preDeploymentCatalog = structuredClone(pgV1);
    for (const component of preDeploymentCatalog.components) delete component.bicepDeployment;
    const candidates = [data.catalog, pgV1, preDeploymentCatalog];
    const catalog = candidates.find(catalog => {
      const versions = getExtensionCoreVersions(catalog, data.support);
      return value.catalogVersion === versions.catalogVersion && value.reusePolicyVersion === versions.reusePolicyVersion;
    });
    if (!catalog && options?.allowVersionMismatch) return false;
    if (!catalog) throw new ExtensionStorageError();
    const hasIntentOrRoles = catalog.architectures.some(a => Object.values(a.tiers).some(t => t.deploymentIntent !== undefined))
      || catalog.components.some(c => c.extensionDeployment !== undefined || c.bicepDeployment?.kind === "postgres-flex-compute"
        && (c.bicepDeployment.allowedHighAvailabilityModes !== undefined || c.bicepDeployment.highAvailabilityBilling !== undefined));
    const preDeployment = !hasIntentOrRoles && catalog.components.every(c => c.bicepDeployment === undefined);
    const preIntent = !hasIntentOrRoles && !preDeployment;
    if (legacy && !preDeployment) throw new ExtensionStorageError();
    // These plan fields did not exist under either old policy. An old fingerprint
    // cannot opt a new binding/delegation out of current role validation.
    if ((preDeployment || preIntent) && value.plans.some(plan => plan.deploymentBindings !== undefined
      || plan.subnetProposals.some(subnet => subnet.delegation !== undefined))) throw new ExtensionStorageError();
    validateStored(value, context, { ...data, catalog }, legacy, preDeployment, preIntent, true);
    return true;
  } catch { throw new ExtensionStorageError(); }
}

function validateStored(raw: ExtensionResult, context: ExtensionValidationContext, data: ExtensionCoreData | undefined, historical: boolean, preDeployment = false, preIntent = false,
  historicalRead = false): void {
  try {
    const value = extensionResultSchema.parse(raw);
    const fixedData = data ?? { catalog: loadCatalog(), support: loadExtensionSupportCatalog() };
    const request = createExtensionRequestContext(context.input, context.scan, context.inventory, fixedData.catalog, { support: fixedData.support });
    if (!same(context.sourceScan, toCompletionSourceScan(context.scan, context.inventory))) throw new ExtensionStorageError();
    const byId = new Map([...request.model.aliasToResourceId].map(([alias, id]) => [id, alias]));
    const alias = (id: string) => byId.get(id) ?? (() => { throw new ExtensionStorageError(); })();
    // 계산 필드를 제거하고, 저장된 실제 ID는 이 요청의 별칭으로만 변환한다.
    const proposal = extensionProposalSchema.parse({ schemaVersion: value.schemaVersion, requestTitle: value.requestTitle,
      recommendationReason: value.recommendationReason, recommendedTier: value.recommendedTier,
      plans: value.plans.map(({ tier, referenceArchitectureId, title, pros, reusedResources, newItems, usageIncreases, subnetProposals, deploymentBindings }) =>
        ({ tier, referenceArchitectureId, title, pros, reusedResources, newItems, usageIncreases, subnetProposals, ...(deploymentBindings !== undefined ? {deploymentBindings} : {}) })),
    });
    for (const plan of proposal.plans) {
      for (const item of [...plan.reusedResources, ...plan.usageIncreases]) item.resourceId = alias(item.resourceId);
      for (const subnet of plan.subnetProposals) if (subnet.parent.kind === "existing") subnet.parent.resourceId = alias(subnet.parent.resourceId);
      for (const binding of plan.deploymentBindings ?? []) if (binding.target.kind === "reused-subnet") binding.target.resourceId = alias(binding.target.resourceId);
    }
    const replay = processOutput(proposal, request, { id: value.id, createdAt: value.createdAt }, historical, preDeployment, preIntent, historicalRead);
    if (!replay.ok || !same(replay.value, value)) throw new ExtensionStorageError();
  } catch { throw new ExtensionStorageError(); }
}
