import { z } from "zod";
import { analysisInputSchema } from "@/lib/analysis/input-schema";
import { tierSchema } from "@/lib/catalog/schema";
import { validationLimit } from "@/lib/llm/localized-text";
import { parsePrefix } from "@/lib/network/cidr";
import { isCanonicalArmResourceId } from "@/lib/inventory/normalize";
import type { JsonValue } from "@/types/completion";

export const COMPLETION_SCHEMA_VERSION = 1 as const;
const version = z.literal(COMPLETION_SCHEMA_VERSION);
const text = z.string().min(1).refine(value => value.trim().length > 0);
const identifier = z.string().regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/);
const propertyPath = text.refine(value => value.startsWith("/") && !/~(?![01])/u.test(value), "JSON Pointer가 필요합니다.");
const uuid = z.uuid();
const azureGuid = z.guid().toLowerCase();
const timestamp = z.iso.datetime({ offset: true });
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const amount = z.number().finite().nonnegative();
const quantity = z.number().finite().positive();
const unique = <T>(values: readonly T[]) => new Set(values).size === values.length;
const uuids = z.array(uuid).refine(unique, "ID는 중복할 수 없습니다.");
const azureGuids = z.array(azureGuid).refine(unique, "ID는 중복할 수 없습니다.");
const resourceId = z.string().refine(isCanonicalArmResourceId, "정규화한 ARM 리소스 ID가 필요합니다.");
const resourceIds = z.array(resourceId).refine(unique, "리소스 ID는 중복할 수 없습니다.");
const catalogIds = z.array(identifier).refine(unique, "카탈로그 ID는 중복할 수 없습니다.");
// 관측 값은 JSON만 허용한다. 누락과 null은 observation의 state로 구분한다.
export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() => z.union([
  z.null(), z.boolean(), z.string(), z.number().finite(), z.array(jsonValueSchema),
  z.record(z.string(), jsonValueSchema),
]));
const localized = z.strictObject({
  en: text.max(validationLimit(1200)).refine(value => !/\p{Script=Hangul}/u.test(value)),
  ko: text.max(validationLimit(600)),
}).refine(value => !/https?:\/\/|www\./i.test(value.en + value.ko), "모델 문장에 URL을 허용하지 않습니다.");

export const reasonCodeSchema = z.enum([
  "missing-data", "invalid-data", "unsupported-type", "unsupported-region", "unsupported-path",
  "unsupported-service-tag", "no-applicable-rule", "policy-not-configured", "scope-not-collected",
  "collection-partial", "legacy-completeness-unknown", "import-scope-unverified", "context-limit", "redacted",
  "unmapped-advisor-type", "price-unavailable", "capacity-unverified", "forbidden",
  "not-configured", "not-supported", "auth-failed", "timeout", "throttled", "invalid-response",
  "validation-failed", "compiler-unavailable", "interrupted", "internal", "no-data",
]);
// 성공 판정 근거도 포함한다. 구성요소 실패/coverage의 오류 namespace와 분리한다.
export const networkReasonCodeSchema = z.enum([
  ...reasonCodeSchema.options,
  "endpoint-not-in-scan", "no-path-in-scan", "peer-vnet-not-in-scan", "peering-not-connected",
  "peering-one-way", "peering-access-disabled", "transitive-peering-requires-forwarder",
  "private-link-connection-not-approved", "endpoint-address-unresolved", "endpoint-address-mismatch",
  "address-family-mismatch", "query-field-unspecified", "single-candidate", "external-source-unsupported",
  "nsg-rule-decisive-allow", "nsg-rule-decisive-deny", "nsg-not-attached", "nsg-association-not-collected",
  "nsg-association-mismatch", "nsg-reference-missing", "nsg-rules-not-collected", "nsg-rule-malformed",
  "nsg-rule-priority-invalid", "nsg-rule-priority-duplicate", "nsg-rule-precedence-ambiguous",
  "asg-membership-unresolved", "service-tag-unsupported", "service-tag-approximate",
  "virtual-network-scope-incomplete", "nsg-not-applied-private-endpoint-policy",
  "route-selected-user", "route-selected-system", "route-table-not-attached", "route-table-reference-missing",
  "route-table-routes-not-collected", "route-table-empty-system-routes", "route-malformed", "route-blackhole",
  "route-next-hop-virtual-appliance", "route-next-hop-gateway", "route-next-hop-unsupported",
  "route-destination-unspecified", "route-destination-partial-overlap", "effective-routes-not-collected",
]);
const reasons = z.array(reasonCodeSchema).min(1).refine(unique);
export const componentStateSchema = z.enum(["not-requested", "available", "partial", "unavailable", "failed"]);
export function componentSchema<T extends z.ZodType>(data: T) {
  return z.discriminatedUnion("state", [
    z.strictObject({ state: z.literal("not-requested") }),
    z.strictObject({ state: z.literal("available"), data }),
    z.strictObject({ state: z.literal("partial"), data, reasons }),
    z.strictObject({ state: z.literal("unavailable"), reason: reasonCodeSchema }),
    z.strictObject({ state: z.literal("failed"), reason: reasonCodeSchema }),
  ]);
}
export const coverageSchema = z.strictObject({
  total: count, included: count, excluded: count,
  reasons: z.array(z.strictObject({ code: reasonCodeSchema, count: count.positive() })),
}).refine(value => value.total === value.included + value.excluded
  && value.excluded === value.reasons.reduce((sum, reason) => sum + reason.count, 0)
  && unique(value.reasons.map(reason => reason.code)), "coverage 집계가 일치해야 합니다.");

export const sourceScanSchema = z.strictObject({
  id: uuid, workspaceId: uuid, status: z.literal("succeeded"), source: z.enum(["live", "import"]),
  collectedAt: timestamp, subscriptionIds: azureGuids.nonempty(),
  completeness: z.discriminatedUnion("state", [
    z.strictObject({ state: z.literal("complete"), reasons: z.tuple([]) }),
    z.strictObject({ state: z.literal("partial"), reasons }),
    z.strictObject({ state: z.literal("unknown"), reasons }),
  ]),
}).refine(value => value.completeness.state === "complete" ? value.source !== "import"
  : value.completeness.reasons.includes("import-scope-unverified") === (value.source === "import"),
"가져온 파일의 수집 범위는 검증되지 않았습니다.");
export const observationSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("present"), value: jsonValueSchema }),
  z.strictObject({ state: z.literal("missing") }),
  z.strictObject({ state: z.literal("invalid"), reason: z.literal("invalid-data") }),
]);
export const evidenceSchema = z.strictObject({
  resourceId, propertyPath, observation: observationSchema,
});
export const pillarSchema = z.enum(["reliability", "security", "cost", "operations", "performance"]);
export const severitySchema = z.enum(["critical", "high", "medium", "low", "informational"]);
export const findingVerdictSchema = z.enum(["pass", "violation", "unknown"]);
export const codeFindingSchema = z.strictObject({
  id: uuid, ruleId: identifier, ruleVersion: text, resourceId,
  pillar: pillarSchema, severity: severitySchema, verdict: findingVerdictSchema,
  reasonCode: reasonCodeSchema.nullable(), evidence: z.array(evidenceSchema).min(1),
}).refine(value => value.verdict === "unknown" ? value.reasonCode !== null
  : value.reasonCode === null && value.evidence.some(e => e.observation.state === "present"),
"판정에는 관측 근거, unknown에는 이유 코드가 필요합니다.");

export const advisorResultSchema = z.strictObject({
  schemaVersion: version, retrievedAt: timestamp, mappingVersion: text, coverage: coverageSchema,
  recommendations: z.array(z.strictObject({
    recommendationId: text, recommendationTypeId: azureGuid, resourceId, ruleId: identifier, actionId: identifier,
  })),
}).refine(value => value.coverage.included === value.recommendations.length
  && unique(value.recommendations.map(r => r.recommendationId)), "Advisor 매핑 개수가 일치해야 합니다.");
const currency = z.string().regex(/^[A-Z]{3}$/);
const costAttribution = z.union([
  z.strictObject({ kind: z.literal("resource"), resourceId: z.string() }).transform(value => {
    const parsed = resourceId.safeParse(value.resourceId.trim().toLowerCase());
    return parsed.success ? { kind: "resource" as const, resourceId: parsed.data }
      : { kind: "unattributed" as const, resourceId: null, reason: "invalid-resource-id" as const };
  }),
  z.strictObject({ kind: z.literal("unattributed"), resourceId,
    reason: z.literal("outside-inventory") }),
  z.strictObject({ kind: z.literal("unattributed"), resourceId: z.null(),
    reason: z.enum(["missing-resource-id", "invalid-resource-id"]) }),
]);
export const actualCostRowSchema = z.strictObject({
  subscriptionId: azureGuid, currency, amount: z.number().finite(), attribution: costAttribution,
}).refine(value => value.attribution.resourceId === null
  || value.attribution.resourceId.split("/")[2] === value.subscriptionId,
"비용 행은 조회한 구독에 속해야 합니다.");
export const actualCostSchema = z.strictObject({
  schemaVersion: version, retrievedAt: timestamp,
  period: z.strictObject({ from: timestamp, to: timestamp, preset: z.enum(["month-to-date", "trailing30-days"]) })
    .refine(value => Date.parse(value.from) < Date.parse(value.to), "기간 순서가 잘못되었습니다."),
  scope: z.strictObject({ kind: z.literal("subscriptions"), requestedSubscriptionIds: azureGuids.nonempty(),
    availableSubscriptionIds: azureGuids.nonempty(), paginationComplete: z.boolean() }),
  rows: z.array(actualCostRowSchema).min(1),
  totals: z.array(z.strictObject({
    currency, amount: z.number().finite(), subscriptionIds: azureGuids.nonempty(),
  })).min(1),
}).refine(value => unique(value.totals.map(t => t.currency))
  && value.scope.availableSubscriptionIds.every(id => value.scope.requestedSubscriptionIds.includes(id))
  && value.rows.every(row => value.scope.availableSubscriptionIds.includes(row.subscriptionId))
  && new Set(value.rows.map(row => row.currency)).size === value.totals.length
  && value.totals.every(total => {
    const rows = value.rows.filter(row => row.currency === total.currency);
    const subscriptions = new Set(rows.map(row => row.subscriptionId));
    return rows.length > 0 && Math.abs(total.amount - rows.reduce((sum, row) => sum + row.amount, 0)) <= 1e-8
      && total.subscriptionIds.length === subscriptions.size && total.subscriptionIds.every(id => subscriptions.has(id));
  }),
"모든 비용 행의 원금액·통화별 합계와 수집 범위를 보존합니다.");
export const actualCostWindowsSchema = z.strictObject({
  schemaVersion: version, monthToDate: componentSchema(actualCostSchema), trailing30Days: componentSchema(actualCostSchema),
}).refine(value => (!("data" in value.monthToDate) || value.monthToDate.data.period.preset === "month-to-date")
  && (!("data" in value.trailing30Days) || value.trailing30Days.data.period.preset === "trailing30-days")
  && [value.monthToDate, value.trailing30Days].every(window => {
    if (!("data" in window)) return true;
    const scope = window.data.scope;
    const complete = scope.paginationComplete && scope.requestedSubscriptionIds.length === scope.availableSubscriptionIds.length;
    return window.state === "available" ? complete : !complete;
  }),
"실제 비용의 조회 기간이 창과 일치해야 합니다.");

const propertyChange = z.strictObject({ path: propertyPath, before: observationSchema, after: observationSchema })
  .refine(value => JSON.stringify(value.before) !== JSON.stringify(value.after), "동일 값은 변경이 아닙니다.");
export const scanDiffSchema = z.strictObject({
  schemaVersion: version, workspaceId: uuid, baselineScan: sourceScanSchema, comparisonScan: sourceScanSchema,
  comparedAt: timestamp, coverage: coverageSchema,
  counts: z.strictObject({ added: count, removed: count, changed: count, unknown: count }),
  changes: z.array(z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("added"), resourceId }),
    z.strictObject({ kind: z.literal("removed"), resourceId }),
    z.strictObject({ kind: z.literal("changed"), resourceId, properties: z.array(propertyChange).min(1)
      .refine(values => unique(values.map(p => p.path))) }),
    z.strictObject({ kind: z.literal("unknown"), resourceId, reasons }),
  ])),
}).superRefine((value, ctx) => {
  const fail = (message: string) => ctx.addIssue({ code: "custom", message });
  if (value.baselineScan.workspaceId !== value.workspaceId || value.comparisonScan.workspaceId !== value.workspaceId
    || value.baselineScan.id === value.comparisonScan.id
    || Date.parse(value.baselineScan.collectedAt) > Date.parse(value.comparisonScan.collectedAt)
    || Date.parse(value.comparedAt) < Date.parse(value.comparisonScan.collectedAt)) fail("비교 스캔 소속·시각이 일치해야 합니다.");
  if (!unique(value.changes.map(c => c.resourceId))) fail("리소스별 변경 분류는 하나여야 합니다.");
  if (value.changes.length > value.coverage.total) fail("변경 리소스 수는 비교 대상 수를 넘을 수 없습니다.");
  for (const kind of ["added", "removed", "changed", "unknown"] as const) {
    if (value.counts[kind] !== value.changes.filter(c => c.kind === kind).length) fail("변경 집계가 일치해야 합니다.");
  }
  for (const change of value.changes) {
    const scope = change.kind === "removed" ? value.comparisonScan : change.kind === "added" ? value.baselineScan : null;
    if (scope && (scope.completeness.state !== "complete"
      || !scope.subscriptionIds.includes(change.resourceId.split("/")[2]))) fail("불완전하거나 수집하지 않은 범위는 추가·삭제로 확정할 수 없습니다.");
  }
});

export const roadmapSchema = z.strictObject({
  schemaVersion: version, generatedAt: timestamp, summary: localized,
  phases: z.array(z.strictObject({
    id: identifier, title: localized, findingIds: uuids.nonempty(), actions: z.array(localized).min(1),
  })).min(1).refine(values => unique(values.map(p => p.id))),
});
const boundShape = {
  schemaVersion: version, id: uuid, workspaceId: uuid, sourceScanId: uuid,
  sourceScan: sourceScanSchema, createdAt: timestamp,
};
function boundToScan(value: {
  workspaceId: string; sourceScanId: string; sourceScan: z.infer<typeof sourceScanSchema>; createdAt: string;
}) {
  return value.workspaceId === value.sourceScan.workspaceId && value.sourceScanId === value.sourceScan.id
    && Date.parse(value.createdAt) >= Date.parse(value.sourceScan.collectedAt);
}
export const assessmentResultSchema = z.strictObject({
  ...boundShape,
  local: z.strictObject({ rulesVersion: text, evaluatedAt: timestamp, coverage: coverageSchema,
    findings: z.array(codeFindingSchema).refine(values => unique(values.map(f => f.id))
      && unique(values.map(f => `${f.ruleId}:${f.resourceId}`))) }),
  advisor: componentSchema(advisorResultSchema), actualCost: actualCostWindowsSchema,
  diff: componentSchema(scanDiffSchema), roadmap: componentSchema(roadmapSchema),
}).superRefine((value, ctx) => {
  const fail = (message: string) => ctx.addIssue({ code: "custom", message });
  if (!boundToScan(value) || Date.parse(value.local.evaluatedAt) < Date.parse(value.sourceScan.collectedAt)) fail("기준 스캔 소속·시각이 일치해야 합니다.");
  if (value.local.coverage.included !== new Set(value.local.findings.map(f => f.resourceId)).size) fail("점검 coverage는 판정한 리소스 수입니다.");
  if ("data" in value.diff && (value.diff.data.workspaceId !== value.workspaceId
    || value.diff.data.comparisonScan.id !== value.sourceScanId)) fail("비교 결과가 기준 스캔에 속해야 합니다.");
  if ("data" in value.roadmap) {
    const ids = new Set(value.local.findings.map(f => f.id));
    if (value.roadmap.data.phases.some(p => p.findingIds.some(id => !ids.has(id)))) fail("로드맵은 저장된 판정만 인용합니다.");
  }
});

export const networkQuerySchema = z.strictObject({
  sourceScanId: uuid, sourceResourceId: resourceId, destinationResourceId: resourceId,
  protocol: z.enum(["tcp", "udp", "icmp", "any"]),
  sourcePort: z.number().int().min(0).max(65535).nullable(),
  destinationPort: z.number().int().min(0).max(65535).nullable(),
}).refine(value => value.protocol === "tcp" || value.protocol === "udp"
  ? value.destinationPort !== null : value.sourcePort === null && value.destinationPort === null,
"프로토콜에 맞는 포트가 필요합니다.");
const pathVerdict = z.enum(["allowed", "blocked", "unknown"]);
const hop = z.strictObject({
  resourceId, hopType: z.enum(["vnet", "subnet", "nic", "nsg", "route_table", "private_endpoint",
    "load_balancer", "application_gateway", "public_ip", "vm", "storage_account", "sql_managed_instance", "web_app", "other"]),
  verdict: pathVerdict, reasonCodes: z.array(networkReasonCodeSchema).refine(unique), evidence: z.array(evidenceSchema),
}).refine(value => value.verdict === "unknown" ? value.reasonCodes.length > 0 : value.evidence.length > 0);
export const networkEngineResultSchema = z.strictObject({
  engineVersion: text, sourceResourceId: resourceId, destinationResourceId: resourceId,
  verdict: pathVerdict, reasonCodes: z.array(networkReasonCodeSchema).refine(unique),
  paths: z.array(z.strictObject({ verdict: pathVerdict, reasonCodes: z.array(networkReasonCodeSchema).refine(unique), hops: z.array(hop).min(1) })
    .refine(value => {
      const verdict = value.hops.some(h => h.verdict === "blocked") ? "blocked"
        : value.hops.some(h => h.verdict === "unknown") ? "unknown" : "allowed";
      return value.verdict === verdict && (verdict !== "unknown" || value.reasonCodes.length > 0);
    })),
}).refine(value => {
  if (!value.paths.length) return value.verdict === "unknown" && value.reasonCodes.length > 0;
  const verdict = value.paths.some(p => p.verdict === "allowed") ? "allowed"
    : value.paths.every(p => p.verdict === "blocked") ? "blocked" : "unknown";
  return value.verdict === verdict && (verdict !== "unknown" || value.reasonCodes.length > 0);
}, "경로별 결과와 전체 결과가 일치해야 합니다.");
export const networkDiagnosticSchema = z.strictObject({
  ...boundShape, query: networkQuerySchema, engine: networkEngineResultSchema,
}).refine(value => boundToScan(value) && value.query.sourceScanId === value.sourceScanId
  && value.query.sourceResourceId === value.engine.sourceResourceId
  && value.query.destinationResourceId === value.engine.destinationResourceId,
"질의·엔진 결과·기준 스캔이 일치해야 합니다.");

export const extensionInputSchema = z.strictObject({
  ...analysisInputSchema.shape, schemaVersion: version, workspaceId: uuid, sourceScanId: uuid,
});
const reuse = z.strictObject({ resourceId, componentId: identifier, reason: localized });
// App generation bound, not an Azure quota. Historical V1 rows retain absent cardinality.
export const extensionInstanceCountSchema = z.number().int().min(0).max(1000);
const newItem = z.strictObject({ componentId: identifier, quantity, instanceCount: extensionInstanceCountSchema.optional() });
const usageIncrease = z.strictObject({ resourceId, componentId: identifier, quantity });
const addressPrefixes = z.array(z.string().refine(value => {
    if (value !== value.trim() || !value.includes("/")) return false;
    const prefix = parsePrefix(value);
    const address = parsePrefix(value.split("/")[0]);
    return prefix !== null && address !== null && prefix.network === address.network;
  })).min(1).refine(unique);
export const subnetProposalSchema = z.strictObject({
  id: identifier, componentId: identifier, region: z.string().regex(/^[a-z][a-z0-9]+$/),
  parent: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("existing"), resourceId: resourceId.refine(id => /\/providers\/microsoft\.network\/virtualnetworks\/[^/]+$/.test(id)) }),
    z.strictObject({ kind: z.literal("new"), id: identifier, componentId: identifier, addressPrefixes }),
  ]),
  addressPrefixes,
  delegation: z.literal("Microsoft.App/environments").optional(),
});
export const extensionDeploymentBindingSchema = z.strictObject({
  role: z.enum(["gateway-subnet", "container-environment-subnet"]),
  target: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("new-subnet"), subnetProposalId: identifier }),
    z.strictObject({ kind: z.literal("reused-subnet"), resourceId: resourceId.refine(id => /\/providers\/microsoft\.network\/virtualnetworks\/[^/]+\/subnets\/[^/]+$/.test(id)) }),
  ]),
});
const planShape = {
  tier: tierSchema, referenceArchitectureId: identifier, title: localized,
  reusedResources: z.array(reuse).refine(values => unique(values.map(r => r.resourceId))),
  newItems: z.array(newItem).refine(values => unique(values.map(i => i.componentId))),
  usageIncreases: z.array(usageIncrease).refine(values => unique(values.map(i => `${i.resourceId}:${i.componentId}`))),
  subnetProposals: z.array(subnetProposalSchema).refine(values => unique(values.map(s => s.id))),
  deploymentBindings: z.array(extensionDeploymentBindingSchema).refine(values => unique(values.map(v => v.role))).optional(),
  pros: z.array(localized).min(1),
};
const tiers = <T extends z.ZodType<{ tier: "low" | "balanced" | "ha" }>>(plan: T) => z.array(plan).length(3)
  .refine(values => values.map(p => p.tier).join(",") === "low,balanced,ha", "세 안은 low, balanced, ha 순서입니다.");
const proposalPlan = z.strictObject(planShape).refine(value => {
  if (value.newItems.length + value.usageIncreases.length === 0
    || !value.usageIncreases.every(i => value.reusedResources.some(r => r.resourceId === i.resourceId && r.componentId === i.componentId))) return false;
  const parents = new Map<string, string>();
  for (const subnet of value.subnetProposals) {
    if (!value.newItems.some(i => i.componentId === subnet.componentId)) return false;
    const parent = subnet.parent;
    if (parent.kind === "existing") {
      if (!value.reusedResources.some(r => r.resourceId === parent.resourceId)) return false;
    } else {
      const identity = JSON.stringify([parent.componentId, subnet.region, [...parent.addressPrefixes].sort()]);
      if (!value.newItems.some(i => i.componentId === parent.componentId)
        || value.subnetProposals.some(s => s.id === parent.id)
        || (parents.has(parent.id) && parents.get(parent.id) !== identity)) return false;
      parents.set(parent.id, identity);
    }
  }
  return true;
});
export const extensionProposalSchema = z.strictObject({
  schemaVersion: version, requestTitle: localized, recommendedTier: tierSchema,
  recommendationReason: localized, plans: tiers(proposalPlan),
});
export const incrementalCostSchema = z.strictObject({
  currency: z.literal("CAD"), priceAsOf: z.iso.date(),
  lines: z.array(z.strictObject({ kind: z.enum(["new", "usage-increase"]), componentId: identifier,
    resourceId: resourceId.nullable(), quantity, amount })
    .refine(value => value.kind === "new" ? value.resourceId === null : value.resourceId !== null)),
  total: amount,
}).refine(value => Math.abs(value.total - value.lines.reduce((sum, line) => sum + line.amount, 0)) <= 1e-8,
"추가 비용 합계가 항목 합과 일치해야 합니다.");
export const deterministicCheckSchema = z.strictObject({
  kind: z.enum(["cidr", "region", "path", "capacity"]), verdict: findingVerdictSchema,
  reasonCodes: z.array(reasonCodeSchema).refine(unique), resourceIds, componentIds: catalogIds,
  evidence: z.array(evidenceSchema),
}).refine(value => value.verdict === "unknown" ? value.reasonCodes.length > 0 : value.evidence.length > 0);
export const extensionPlanSchema = proposalPlan.safeExtend({
  incrementalCost: componentSchema(incrementalCostSchema), checks: z.array(deterministicCheckSchema).min(1),
}).superRefine((value, ctx) => {
  const fail = (message: string) => ctx.addIssue({ code: "custom", message });
  if ("data" in value.incrementalCost) {
    const expected = [
      ...value.newItems.map(i => ({ ...i, kind: "new", resourceId: null })),
      ...value.usageIncreases.map(i => ({ ...i, kind: "usage-increase" })),
    ];
    const key = (i: { kind: string; componentId: string; resourceId: string | null }) => `${i.kind}:${i.componentId}:${i.resourceId}`;
    const lines = value.incrementalCost.data.lines;
    if (!unique(lines.map(key)) || lines.some(line => !expected.some(i => key(i) === key(line) && i.quantity === line.quantity))
      || (value.incrementalCost.state === "available" && lines.length !== expected.length)
      || (value.incrementalCost.state === "partial" && (lines.length === 0 || lines.length >= expected.length))) fail("추가 비용은 신규·증가 수량만 포함해야 합니다.");
  }
  const resources = new Set(value.reusedResources.map(r => r.resourceId));
  const components = new Set([...value.newItems, ...value.usageIncreases, ...value.reusedResources].map(i => i.componentId));
  if (value.checks.some(c => c.resourceIds.some(id => !resources.has(id)) || c.componentIds.some(id => !components.has(id)))) fail("검사는 해당 안의 항목을 인용해야 합니다.");
});
export const extensionResultSchema = z.strictObject({
  ...boundShape, input: extensionInputSchema, catalogVersion: text, reusePolicyVersion: text,
  contextCoverage: coverageSchema, requestTitle: localized, recommendedTier: tierSchema,
  recommendationReason: localized, plans: tiers(extensionPlanSchema),
}).refine(value => boundToScan(value) && value.input.workspaceId === value.workspaceId
  && value.input.sourceScanId === value.sourceScanId, "확장 입력과 저장 소속이 일치해야 합니다.");

const artifactKind = z.enum(["guide", "evaluation", "bicep"]);
export const extensionArtifactRequestSchema = z.strictObject({
  schemaVersion: version, extensionId: uuid, tier: tierSchema, kind: artifactKind,
});
const artifactShape = {
  schemaVersion: version, id: uuid, workspaceId: uuid, extensionId: uuid, sourceScanId: uuid,
  tier: tierSchema, createdAt: timestamp,
};
const guideContent = z.strictObject({
  overview: localized, prerequisites: z.array(localized).min(1), cautions: z.array(localized),
  steps: z.array(z.strictObject({ title: localized, goal: localized, instructions: z.array(localized).min(1),
    componentIds: catalogIds, reusedResourceIds: resourceIds, verification: localized })).min(1),
});
const evaluationContent = z.strictObject({
  summary: localized, axes: z.array(z.strictObject({ axis: pillarSchema, grade: z.enum(["high", "medium", "low"]),
    rationale: localized, improvement: localized })).length(5).refine(values => unique(values.map(a => a.axis))),
});
const bicepContent = z.strictObject({
  code: text.max(60000).refine(value => !/https?:\/\/|www\./i.test(value)),
  parameters: z.array(z.strictObject({ name: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/), description: localized }))
    .refine(values => unique(values.map(p => p.name))),
  deploymentNotes: z.array(localized).min(1), existingResourceIds: resourceIds, newComponentIds: catalogIds,
  unverifiedDraft: z.literal(true),
});
export const extensionArtifactSchema = z.discriminatedUnion("kind", [
  z.strictObject({ ...artifactShape, kind: z.literal("guide"), content: guideContent }),
  z.strictObject({ ...artifactShape, kind: z.literal("evaluation"), content: evaluationContent }),
  z.strictObject({ ...artifactShape, kind: z.literal("bicep"), content: bicepContent }),
]);
