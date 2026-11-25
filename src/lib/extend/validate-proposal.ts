import "server-only";
import { isIP } from "node:net";
import { extensionInputSchema, extensionProposalSchema } from "@/lib/completion/schema";
import { validateCatalog } from "@/lib/catalog/validate";
import { parseExtensionSupportCatalog } from "@/lib/catalog/extension-support-schema";
import { loadExtensionSupportCatalog } from "@/lib/catalog/extension-support";
import { getPostgresDeploymentMapping } from "@/lib/catalog/extension-deployment";
import { validateExtensionDeploymentPlan } from "./deployment-validation";
import { prefixContains,prefixesOverlap } from "@/lib/network/cidr";
import { buildExtensionModelContext, computeReuseCandidates } from "./reuse-context";
import { extensionModelOutputSchema, historicalExtensionModelOutputSchema } from "./model-output-schema";
import { validateExtensionOperationalProse } from "@/lib/llm/operational-prose";
import type { Catalog } from "@/types/catalog";
import type { ExtensionInput, ExtensionProposal } from "@/types/extension";
import type { ExtensionModelContext, ExtensionModelContextOptions } from "@/types/extend-context";
import type { ExtensionSupportCatalog } from "@/types/extension-support";
import type { ScanInventory, ScanRecord } from "@/types/scan";

export type ExtensionRequestContext = {
  readonly input: ExtensionInput;
  readonly scan: ScanRecord;
  readonly inventory: ScanInventory;
  readonly catalog: Catalog;
  readonly support: ExtensionSupportCatalog;
  readonly options: ExtensionModelContextOptions;
  readonly model: ExtensionModelContext;
};
export type ExtensionProposalValidationResult = { ok: true; value: ExtensionProposal } | { ok: false; errors: string[] };
function invalid(): never { throw new Error("validation-failed"); }
const VNET = "microsoft.network/virtualnetworks";
const SUBNET = `${VNET}/subnets`;

/** 같은 저장 행에서 가져온 scan/inventory만 받는다. 모델용 payload와 서버 자료는 분리한다. */
export function createExtensionRequestContext(
  rawInput: ExtensionInput, scan: ScanRecord, inventory: ScanInventory, catalog: Catalog,
  options: Omit<ExtensionModelContextOptions, "region"> = {},
): ExtensionRequestContext {
  try {
    const input = extensionInputSchema.parse(rawInput);
    if (input.workspaceId !== scan.workspaceId || input.sourceScanId !== scan.id) invalid();
    const parsedCatalog = validateCatalog(catalog);
    if (!parsedCatalog.ok) invalid();
    const support = parseExtensionSupportCatalog(options.support ?? loadExtensionSupportCatalog(), parsedCatalog.catalog);
    const snapshot = structuredClone({ input, scan, inventory, catalog: parsedCatalog.catalog, support,
      options: { ...options, support, region: input.region } });
    const model = buildExtensionModelContext(snapshot.scan, snapshot.inventory, snapshot.catalog, snapshot.options);
    // JSON 전체를 직렬화해도 저장 소유자·이름·주소·별칭 역매핑은 나오지 않는다.
    return Object.defineProperties({ model }, Object.fromEntries(Object.entries(snapshot)
      .map(([key, value]) => [key, { value, enumerable: false }]))) as ExtensionRequestContext;
  } catch { return invalid(); }
}

// 기존 결과물 금액 검사와 같은 형태. 단가/금액은 prose에도 허용하지 않는다.
const amount = /₩\s*\d|\$\s*\d|(?:USD|CAD|KRW)\s*\d|\d[\d,]*(?:\.\d+)?\s*[kmb]?(?:만)?\s*(?:원|달러|USD|CAD|KRW|(?:canadian\s+|us\s+|american\s+)?dollars?\b)/i;
const url = /(?:[a-z][a-z\d+.-]*:\/\/|www\.|\/\/[^\s/]+\.[a-z]|\b[\w-]+\.(?:com|net|org|io|dev)(?:\b|\/))/i;
/** Original V1 prose checks retained for server historical reads. This policy
 * alone is insufficient for new writes; they also require the positive language.
 */
function historicalSafeText(value: string, componentIds: Set<string>, catalog: Catalog): boolean {
  if (!value.trim() || url.test(value.replace(/\bASP\.NET\b(?![/?#\w.])/g, "")) || amount.test(value)
    || /\/subscriptions\/|\br\d{6,}\b|\bmicrosoft\.[\w.]+\/|\b(?:azure|microsoft|amazon|aws|gcp|google cloud)\b/i.test(value)) return false;
  // ID는 문장 구두점/한국어 조사 옆에서도 검사한다. 일반적인 하이픈 문장을 서비스 ID로 오인하지 않는다.
  for (const match of value.matchAll(/[a-z][a-z0-9]*(?:-[a-z0-9]+)+/g)) {
    if (catalog.components.some(c => c.id === match[0]) ? !componentIds.has(match[0])
      : /(?:^|-)component(?:-|$)/.test(match[0])) return false;
  }
  // 카탈로그 제품명·통상적인 서비스 이름도 구조화 ID 대신 자유문장으로 도입하지 않는다.
  const products = /\b(?:OpenAI|AI Search|Kubernetes|AKS|Event Hubs?|Service Bus|Data Factory|Databricks|Synapse|S3|EC2|Lambda|App Service|Key Vault|Log Analytics|Container Apps|Cosmos DB|Front Door|Redis|PostgreSQL|Static Web Apps)\b|애저|아마존|구글\s*클라우드|쿠버네티스|오픈\s*AI|이벤트\s*허브|서비스\s*버스|데이터\s*팩터리|데이터브릭스|시냅스|람다|앱\s*서비스|키\s*볼트|로그\s*애널리틱스|컨테이너\s*앱|코스모스|프런트\s*도어|레디스|포스트그레스/i;
  // 선택된 ID 안의 redis 등은 제품명 우회가 아니라 검증된 참조다.
  let prose = value;
  for (const id of componentIds) prose = prose.replaceAll(id, "");
  return !products.test(prose);
}

/** The enclosing schema bounds this input. Consume the numeric boundary by
 * Unicode categories instead of maintaining a list of signs or digit scripts.
 * A leading decimal point touches its digits; a sentence-ending dot followed
 * by whitespace keeps the next operational step outside the previous claim.
 */
function startsMonetaryValue(raw: string): boolean {
  const chars = Array.from(raw);
  for (const [index, char] of chars.entries()) {
    if (/\p{Nd}/u.test(char)) return true;
    if (!/[\s\p{P}\p{S}]/u.test(char) || /[!?;]/u.test(char)
      || char === "." && /\s/u.test(chars[index + 1] ?? "")) return false;
  }
  return false;
}

/** Current writes only. This recognizes bounded monetary assertions and literal
 * identities, not general natural-language meaning. Strip only exact selected
 * references: their digits are public catalog references, never model prices.
 */
function currentClaimsAndLiteralsSafe(value: string, componentIds: Set<string>): boolean {
  let prose = value;
  for (const id of componentIds) prose = prose.replace(new RegExp(`(?<![a-zA-Z0-9_-])${id}(?![a-zA-Z0-9_-])`, "g"), " ");
  // Recognize one bounded operational quantity clause, then keep scanning the
  // remainder for an assertion. Commas/brackets are never blanket terminators:
  // "cost (2 replicas) is (± .١٢)" still contains a model-authored amount.
  const prefixes = [
    /\b(?:costs?|prices?|pricing|charges?|estimates?|bills?|billing|rates?|budgets?)(?![a-z])/gi,
    /(?:비용|가격|요금|단가|견적|청구)(?:은|는|이|가|을|를)?\s*(?:(?:총|월|합계|추가)\s*)*/gu,
  ];
  for (const [language, prefix] of prefixes.entries()) for (const match of prose.matchAll(prefix)) {
    let tail = prose.slice(match.index + match[0].length);
    const quantity = language === 0
      ? /^[\s([,]+(?:(?:for|of)(?![a-z])[\s([,]*)?\p{Nd}+(?:\.\p{Nd}+)?\s+(?:replicas?|zones?|regions?|workers?|instances?|environments?)(?![a-z])[\s)\],]*/iu
      : /^[\s([,]*\p{Nd}+\s*(?:영역|지역|복제|인스턴스|작업자|환경)(?:에서는|으로는|에서|으로|에는|의|을|를|은|는|에|로)?[\s)\],]*/u;
    tail = tail.replace(quantity, ' ');
    // Wrapping a recognized assertion word cannot hide its amount. Preserve the
    // same sentence boundaries as startsMonetaryValue; punctuation is not prose.
    tail = tail.replace(language === 0
      ? /^(?:(?:(?![!?;]|\.\s)[\s\p{P}\p{S}])*(?:is|are|was|were|will|be|at|of|for|about|around|between|total|expected|estimated|now|only)(?![a-z]))*/iu
      : /^(?:(?:(?![!?;]|\.\s)[\s\p{P}\p{S}])*(?:총|월|합계|추가|은|는|이|가))*/u, '');
    if (startsMonetaryValue(tail)) return false;
  }
  if (/\b(?:no|zero|without)[\s-]+(?:additional[\s-]+)?(?:costs?|charges?|prices?|billing|bill)\b/i.test(prose)
    || /(?:비용|가격|요금|단가|청구)(?:은|는|이|가)?\s*없/u.test(prose)) return false;
  if (/(?<![a-f0-9])[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}(?![a-f0-9])/i.test(prose)) return false;
  // Literal syntax, not a numeric ban. Ordinary counts, steps and short dotted
  // versions remain valid. Korean particles/punctuation cannot hide an address.
  for (const match of prose.matchAll(/(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?!\d|\.\d)/g)) if (isIP(match[0]) === 4) return false;
  for (const match of prose.matchAll(/[a-f0-9:.]*:[a-f0-9:.]+(?:%[a-z0-9_.-]+)?/gi)) if (isIP(match[0].replace(/\.+$/, "")) === 6) return false;
  return true;
}

export function validateExtensionProposal(raw: unknown, context: ExtensionRequestContext): ExtensionProposalValidationResult {
  return validateProposal(raw, context, false);
}

/** Server storage replay only. This mode is never selected by model/client fields. */
export function validateHistoricalExtensionProposal(raw: unknown, context: ExtensionRequestContext): ExtensionProposalValidationResult {
  return validateProposal(raw, context, true);
}

/** Exact pre-mapping catalog fingerprint was checked by server storage replay. Counts still apply. */
export function validatePreDeploymentExtensionProposal(raw: unknown, context: ExtensionRequestContext): ExtensionProposalValidationResult {
  return validateProposal(raw, context, false, true);
}

/** Server replay after matching the complete PG-mapping-v1 catalog and reuse fingerprints. */
export function validatePreIntentExtensionProposal(raw: unknown, context: ExtensionRequestContext): ExtensionProposalValidationResult {
  return validateProposal(raw, context, false, false, true);
}

/** DB read replay only, after process.ts matches both full data fingerprints.
 * Prose compatibility is independent of deployment/count policy. Neither the
 * current generation nor the mandatory new-write validator selects this entry.
 */
export function validateExtensionProposalForHistoricalRead(raw: unknown, context: ExtensionRequestContext,
  deployment: "current" | "pre-count" | "pre-deployment" | "pre-intent"): ExtensionProposalValidationResult {
  return validateProposal(raw, context, deployment === "pre-count", deployment === "pre-deployment", deployment === "pre-intent", "historical-read");
}

function validateProposal(raw: unknown, context: ExtensionRequestContext, historical: boolean, preDeployment = false, preIntent = false,
  textPolicy: "current-write" | "historical-read" = "current-write"): ExtensionProposalValidationResult {
  const errors: string[] = [];
  const fail = (path: string, code: string) => { errors.push(`${path}: ${code}`); };
  try {
    const parsed = (historical ? historicalExtensionModelOutputSchema : extensionModelOutputSchema).safeParse(raw);
    if (!parsed.success) return { ok: false, errors: parsed.error.issues.map(issue => `${issue.path.join(".")}: invalid-model-structure`) };
    // 정책/판정을 payload에서 신뢰하지 않고 고정 저장 스캔으로 다시 계산한다.
    const fresh = buildExtensionModelContext(context.scan, context.inventory, context.catalog, context.options);
    const candidates = computeReuseCandidates(context.scan, context.inventory, context.catalog, { region: context.input.region, support: context.support });
    if (JSON.stringify([...fresh.aliasToResourceId]) !== JSON.stringify([...context.model.aliasToResourceId])) invalid();
    if (context.input.workspaceId !== candidates.sourceScan.workspaceId || context.input.sourceScanId !== candidates.sourceScan.id) invalid();
    const resolve = (alias: string): string => fresh.aliasToResourceId.get(alias) ?? invalid();
    const output = parsed.data;
    for (const plan of output.plans) {
      for (const item of [...plan.reusedResources, ...plan.usageIncreases]) item.resourceId = resolve(item.resourceId);
      for (const subnet of plan.subnetProposals) if (subnet.parent.kind === "existing") subnet.parent.resourceId = resolve(subnet.parent.resourceId);
      for (const binding of plan.deploymentBindings ?? []) if (binding.target.kind === "reused-subnet") binding.target.resourceId = resolve(binding.target.resourceId);
    }
    // alias 단계 검사 뒤에 W0 저장 ID/중복/부모 범위/3안 계약을 그대로 적용한다.
    const saved = extensionProposalSchema.safeParse(output);
    if (!saved.success) return { ok: false, errors: saved.error.issues.map(issue => `${issue.path.join(".")}: invalid-proposal-structure`) };
    const proposal = saved.data;
    const components = new Map(context.catalog.components.map(c => [c.id, c]));
    const allIds = new Set(proposal.plans.flatMap(p => [...p.newItems, ...p.reusedResources].map(i => i.componentId)));
    const checkText = (text: { en: string; ko: string }, path: string, ids: Set<string>) => {
      for (const locale of ["en", "ko"] as const) {
        // New writes normalize before every lexical/reference/URL/amount guard.
        // V1 reads retain their exact original raw-text behavior.
        const value = textPolicy === "current-write" ? text[locale].normalize("NFKC").normalize("NFC") : text[locale];
        if (!historicalSafeText(value, ids, context.catalog) || textPolicy === "current-write"
          && (/[\p{Sc}\p{Cc}\p{Cf}]/u.test(value.replace(/[\n\r\t]/g, ""))
            || !validateExtensionOperationalProse(value, [...ids])
            || !currentClaimsAndLiteralsSafe(value, ids))) fail(`${path}.${locale}`, "unsafe-text-or-service-reference");
      }
    };
    checkText(proposal.requestTitle, "requestTitle", allIds);
    checkText(proposal.recommendationReason, "recommendationReason", allIds);
    for (const [index, plan] of proposal.plans.entries()) {
      const path = `plans.${index}`;
      if (!context.catalog.architectures.some(a => a.id === plan.referenceArchitectureId)) fail(path, "unknown-reference-architecture");
      const ids = new Set([...plan.newItems, ...plan.reusedResources, ...plan.usageIncreases].map(i => i.componentId));
      for (const id of ids) if (!components.has(id) || !context.support.components.some(c => c.componentId === id)) fail(path, "unknown-component");
      checkText(plan.title, `${path}.title`, ids);
      plan.pros.forEach((text, i) => checkText(text, `${path}.pros.${i}`, ids));
      for (const [i, reused] of plan.reusedResources.entries()) {
        const eligible = candidates.candidates.find(c => c.resourceId === reused.resourceId && c.componentId === reused.componentId && c.eligibility === "supported");
        if (!eligible) fail(`${path}.reusedResources.${i}`, "reuse-not-eligible");
        const increases = plan.usageIncreases.filter(u => u.resourceId === reused.resourceId && u.componentId === reused.componentId);
        if (eligible?.additionalUsage === "metered" ? increases.length !== 1 : increases.length !== 0) fail(path, "invalid-incremental-usage");
        // 무료 네트워크 구성은 다른 신규 identity를 명시해 함께 만들 수 있다.
        const component = components.get(reused.componentId);
        const structuredNetwork = component?.pricing.kind === "free" && component.bicepResourceTypes
          .some(t => [VNET, SUBNET].includes(t.toLowerCase()));
        if (!structuredNetwork && plan.newItems.some(i => i.componentId === reused.componentId)) fail(path, "duplicate-base-charge");
        checkText(reused.reason, `${path}.reusedResources.${i}.reason`, ids);
      }
      const networkCounts = new Map<string, number>();
      const parents = new Set<string>();
      const hasType = (id: string, type: string) => components.get(id)?.bicepResourceTypes.some(t => t.toLowerCase() === type);
      const count = (id: string) => networkCounts.set(id, (networkCounts.get(id) ?? 0) + 1);
      const proposedRanges = new Map<string,string[]>();
      const proposedParents = new Map<string,string[]>();
      for (const [subnetIndex,subnet] of plan.subnetProposals.entries()) {
        const subnetPath = `${path}.subnetProposals.${subnetIndex}`;
        if(subnet.region !== context.input.region) fail(`${subnetPath}.region`,"region-mismatch");
        const key=subnet.parent.kind === "existing" ? subnet.parent.resourceId : subnet.parent.id;
        const previous=proposedRanges.get(key) ?? [];
        if(subnet.addressPrefixes.some((prefix,i)=>[...previous,...subnet.addressPrefixes.slice(i+1)]
          .some(other=>prefixesOverlap(prefix,other) === true))) fail(`${subnetPath}.addressPrefixes`,"proposed-subnet-overlap");
        proposedRanges.set(key,[...previous,...subnet.addressPrefixes]);
        if(subnet.parent.kind === "new") {
          const parentRanges=subnet.parent.addressPrefixes;
          if(!proposedParents.has(subnet.parent.id)) {
            if([...proposedParents.values()].some(other=>parentRanges.some(prefix=>other.some(range=>prefixesOverlap(prefix,range) === true))))
              fail(`${subnetPath}.parent.addressPrefixes`,"proposed-parent-overlap");
            proposedParents.set(subnet.parent.id,parentRanges);
          }
          if(subnet.addressPrefixes.some(prefix=>!parentRanges.some(parent=>prefixContains(parent,prefix) === true)))
            fail(`${subnetPath}.addressPrefixes`,"outside-new-parent");
        }
        if (!hasType(subnet.componentId, SUBNET)) fail(path, "invalid-subnet-component");
        count(subnet.componentId);
        const parent = subnet.parent;
        if (parent.kind === "existing") {
          const selected = plan.reusedResources.find(r => r.resourceId === parent.resourceId);
          if (!selected || !hasType(selected.componentId, VNET)
            || candidates.resources.find(r => r.id === parent.resourceId)?.type !== VNET) fail(path, "invalid-existing-parent");
        } else {
          if (!hasType(parent.componentId, VNET)) fail(path, "invalid-new-parent");
          if (!parents.has(parent.id)) { parents.add(parent.id); count(parent.componentId); }
        }
      }
      for (const item of plan.newItems) {
        const component = components.get(item.componentId);
        if (!historical && component && (component.bicepResourceTypes.length === 0
          ? item.instanceCount !== 0 : !(item.instanceCount! > 0))) fail(`${path}.newItems`, "invalid-deployment-cardinality");
        if (!historical && !components.get(item.componentId)?.usage
          && (!Number.isInteger(item.quantity) || item.quantity !== item.instanceCount)) fail(`${path}.newItems`, "instance-quantity-mismatch");
        if ((hasType(item.componentId, VNET) || hasType(item.componentId, SUBNET))
          && item.quantity !== networkCounts.get(item.componentId)) fail(path, "unrepresented-network-quantity");
      }
      if (!historical) {
        if (!preDeployment && !preIntent) for (const error of validateExtensionDeploymentPlan(plan, {
          catalog: context.catalog, resources: context.inventory.resources, region: context.input.region,
        })) errors.push(`${path}.${error}`);
        if (preDeployment) {
          // ADR-027 counted rows predate mapping metadata but still require their original pairing.
          const compute = plan.newItems.filter(i => i.componentId.startsWith("postgres-flex-") && i.componentId !== "postgres-flex-storage");
          const storage = plan.newItems.find(i => i.componentId === "postgres-flex-storage");
          if (compute.length || storage) {
            if (compute.length !== 1 || !storage) fail(`${path}.newItems`, "postgres-compute-storage-pair-required");
            else {
              const count = compute[0].instanceCount!;
              const perInstance = storage.quantity / count;
              const minimum = components.get(storage.componentId)?.usage?.defaultQuantity;
              if (storage.instanceCount !== count || !Number.isInteger(perInstance) || minimum === undefined || perInstance < minimum)
                fail(`${path}.newItems`, "postgres-storage-basis-mismatch");
            }
          }
          continue;
        }
        const mappings = new Map(plan.newItems.map(item => {
          const component = components.get(item.componentId);
          return [item.componentId, component ? getPostgresDeploymentMapping(component) : null];
        }));
        // A PostgreSQL root with old metadata cannot silently use today's SKU mapping.
        for (const item of plan.newItems) if (hasType(item.componentId, "microsoft.dbforpostgresql/flexibleservers")
          && !mappings.get(item.componentId)) fail(`${path}.newItems`, "postgres-deployment-mapping-required");
        const compute = plan.newItems.filter(i => mappings.get(i.componentId)?.kind === "postgres-flex-compute");
        const storage = plan.newItems.find(i => mappings.get(i.componentId)?.kind === "postgres-flex-storage");
        if (compute.length || storage) {
          if (compute.length !== 1 || !storage) fail(`${path}.newItems`, "postgres-compute-storage-pair-required");
          else {
            const computeMapping = mappings.get(compute[0].componentId)!;
            const storageMapping = mappings.get(storage.componentId)!;
            const count = compute[0].instanceCount!;
            const perInstance = storage.quantity / count;
            const minimum = components.get(storage.componentId)?.usage?.defaultQuantity;
            if (computeMapping.kind !== "postgres-flex-compute" || storageMapping.kind !== "postgres-flex-storage"
              || computeMapping.storageComponentId !== storage.componentId
              || storage.instanceCount !== count || !Number.isInteger(perInstance) || minimum === undefined || perInstance < minimum
              || !storageMapping.storageSizesGB.includes(perInstance))
              fail(`${path}.newItems`, "postgres-storage-basis-mismatch");
          }
        }
      }
    }
    return errors.length ? { ok: false, errors } : { ok: true, value: proposal };
  } catch { return { ok: false, errors: ["request-context: validation-failed"] }; }
}
