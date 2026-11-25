// 고정 합성 자료 전용. 회사 데이터·실제 키가 없으며 제품의 지원 범위를 뜻하지 않는다.
import type { InventoryResource } from "@/types/inventory";
import type { ScanInventory, ScanRecord } from "@/types/scan";
import type { SourceScan, Coverage, JsonValue } from "@/types/completion";
import type { ActualCost, AdvisorResult, AssessmentResult, CodeFinding, ScanDiff } from "@/types/assessment";
import type { ExtensionArtifact, ExtensionProposal, ExtensionResult } from "@/types/extension";
import type { NetworkDiagnostic } from "@/types/network-diagnostics";
import { summarizeInventory } from "@/lib/inventory/summarize";

export const ids = {
  workspace: "00000000-0000-4000-8000-00000000c001",
  otherWorkspace: "00000000-0000-4000-8000-00000000c002",
  subscription: "00000000-0000-4000-8000-00000000a001",
  otherSubscription: "00000000-0000-4000-8000-00000000a002",
  scan: "00000000-0000-4000-8000-00000000b002",
  oldScan: "00000000-0000-4000-8000-00000000b001",
  assessment: "00000000-0000-4000-8000-00000000d001",
  extension: "00000000-0000-4000-8000-00000000e001",
  network: "00000000-0000-4000-8000-00000000f001",
} as const;
const collectedAt = "2026-11-10T12:00:00Z";
const createdAt = "2026-11-11T12:00:00Z";
const base = `/subscriptions/${ids.subscription}/resourcegroups/rg-synthetic/providers`;
export const resourceIds = {
  vnet: `${base}/microsoft.network/virtualnetworks/vnet-synthetic`,
  subnet: `${base}/microsoft.network/virtualnetworks/vnet-synthetic/subnets/apps`,
  nsg: `${base}/microsoft.network/networksecuritygroups/nsg-synthetic`,
  routeTable: `${base}/microsoft.network/routetables/rt-synthetic`,
  nic: `${base}/microsoft.network/networkinterfaces/nic-synthetic`,
  vm: `${base}/microsoft.compute/virtualmachines/vm-synthetic`,
  storage: `${base}/microsoft.storage/storageaccounts/stsynthetic`,
};
const localized = { en: "Synthetic fixture", ko: "합성 픽스처" };
function resource(type: string, name: string, properties: InventoryResource["properties"], extra: Partial<InventoryResource> = {}): InventoryResource {
  return {
    id: `${base}/${type}/${name}`, name, type, subscriptionId: ids.subscription,
    resourceGroup: "rg-synthetic", location: "canadacentral", kind: null, sku: null,
    tags: { environment: "synthetic", owner: "fixture" }, zones: ["1"], managedBy: null,
    parentId: null, properties, ...extra,
  };
}
export const syntheticResources: InventoryResource[] = [
  resource("microsoft.network/virtualnetworks", "vnet-synthetic", {
    addressSpace: { addressPrefixes: ["10.40.0.0/16"] },
    subnets: [{ id: resourceIds.subnet, name: "apps", properties: { addressPrefix: "10.40.1.0/24" } }],
    virtualNetworkPeerings: [],
  }),
  resource("microsoft.network/virtualnetworks/subnets", "apps", {
    addressPrefix: "10.40.1.0/24", networkSecurityGroup: { id: resourceIds.nsg }, routeTable: { id: resourceIds.routeTable },
  }, { id: resourceIds.subnet, parentId: resourceIds.vnet }),
  resource("microsoft.network/networksecuritygroups", "nsg-synthetic", {
    securityRules: [{ name: "allow-https", properties: { access: "Allow", direction: "Inbound", priority: 100,
      protocol: "Tcp", sourceAddressPrefix: "10.40.0.0/16", destinationAddressPrefix: "*", sourcePortRange: "*", destinationPortRange: "443" } }],
    defaultSecurityRules: [], subnets: [{ id: resourceIds.subnet }],
  }),
  resource("microsoft.network/routetables", "rt-synthetic", {
    routes: [{ name: "unsupported-appliance", properties: { addressPrefix: "0.0.0.0/0", nextHopType: "VirtualAppliance", nextHopIpAddress: "10.40.2.4" } }],
  }),
  resource("microsoft.network/networkinterfaces", "nic-synthetic", {
    ipConfigurations: [{ name: "primary", properties: { privateIPAddress: "10.40.1.4", subnet: { id: resourceIds.subnet } } }],
  }),
  resource("microsoft.compute/virtualmachines", "vm-synthetic", {
    networkProfile: { networkInterfaces: [{ id: resourceIds.nic }] }, hardwareProfile: { vmSize: "Standard_B2s" },
  }),
  resource("microsoft.storage/storageaccounts", "stsynthetic", { supportsHttpsTrafficOnly: true, minimumTlsVersion: "TLS1_2", publicNetworkAccess: "Disabled" }),
  resource("microsoft.sql/servers", "sql-synthetic", { publicNetworkAccess: "Enabled", minimalTlsVersion: "1.2" }),
  resource("microsoft.keyvault/vaults", "kv-synthetic", { enableSoftDelete: true, enablePurgeProtection: false, publicNetworkAccess: "Disabled" }),
  resource("microsoft.documentdb/databaseaccounts", "cosmos-synthetic", { locations: [{ locationName: "Canada Central" }], publicNetworkAccess: "Disabled" }),
  resource("microsoft.synapse/workspaces", "synapse-synthetic", { publicNetworkAccess: "Enabled" }, { location: "westus2" }),
  resource("microsoft.hybridcompute/machines", "arc-synthetic", {}, { zones: [], tags: {}, location: "centralus" }),
  ...Array.from({ length: 20 }, (_, index) => resource("microsoft.web/sites", `app-synthetic-${index.toString().padStart(2, "0")}`,
    index % 3 === 2 ? {} : { httpsOnly: index % 3 === 0, siteConfig: { minTlsVersion: "1.2", ftpsState: "Disabled" } },
    { kind: "app", tags: index % 2 ? {} : { environment: "synthetic" }, zones: [] })),
];
const inventory: ScanInventory = {
  resources: syntheticResources,
  containers: [
    { id: `/subscriptions/${ids.subscription}`, kind: "subscription", name: "Synthetic subscription", subscriptionId: ids.subscription, location: null, tags: {} },
    { id: `/subscriptions/${ids.subscription}/resourcegroups/rg-synthetic`, kind: "resourceGroup", name: "rg-synthetic", subscriptionId: ids.subscription, location: "canadacentral", tags: {} },
  ],
  relations: [
    { sourceId: resourceIds.vm, targetId: resourceIds.nic, type: "connects_to", evidence: ["properties.networkProfile.networkInterfaces[0].id"] },
    { sourceId: resourceIds.nsg, targetId: resourceIds.subnet, type: "secures", evidence: ["properties.networkSecurityGroup.id"] },
  ], skippedRows: 0,
};
const sourceScan = {
  id: ids.scan, workspaceId: ids.workspace, status: "succeeded", source: "live", collectedAt,
  subscriptionIds: [ids.subscription], completeness: { state: "complete", reasons: [] },
} satisfies SourceScan;
const record = {
  id: ids.scan, workspaceId: ids.workspace, status: "succeeded", source: "live",
  subscriptionIds: [ids.subscription], summary: summarizeInventory(syntheticResources, inventory.containers),
  collectedAt, createdAt: collectedAt, completedAt: collectedAt, errorCode: null,
} satisfies ScanRecord;
export const completeSnapshot = { sourceScan, inventory, record };
export const partialSnapshot = {
  sourceScan: { ...sourceScan, completeness: { state: "partial", reasons: ["scope-not-collected", "collection-partial"] },
    subscriptionIds: [ids.subscription, ids.otherSubscription] } satisfies SourceScan,
  inventory: { ...inventory, resources: syntheticResources.slice(0, 25), skippedRows: 2 },
  record: { ...record, summary: summarizeInventory(syntheticResources.slice(0, 25), inventory.containers), subscriptionIds: [ids.subscription, ids.otherSubscription] },
};
// 기존 정규화가 누락을 빈 배열/객체로 만든 경우다. 완전성을 추측하지 않는다.
const legacyResources = syntheticResources.map(r => ({ ...r, tags: {}, zones: [], managedBy: null, properties: {} }));
const legacySummary = summarizeInventory(legacyResources, inventory.containers);
delete legacySummary.resourceGroupCount;
export const legacySnapshot = {
  sourceScan: { ...sourceScan, completeness: { state: "unknown", reasons: ["legacy-completeness-unknown"] } } satisfies SourceScan,
  inventory: { ...inventory, resources: legacyResources },
  record: { ...record, summary: legacySummary },
};
export const coverage = { total: 32, included: 30, excluded: 2, reasons: [{ code: "unsupported-type", count: 1 }, { code: "missing-data", count: 1 }] } satisfies Coverage;
export const findings: CodeFinding[] = syntheticResources.map((r, index) => {
  const [property, value] = Object.entries(r.properties)[0] ?? ["httpsOnly", null];
  return {
  id: `00000000-0000-4000-8000-${(index + 1).toString(16).padStart(12, "0")}`,
  ruleId: "synthetic-property-check", ruleVersion: "synthetic-v1", resourceId: r.id,
  pillar: "security", severity: "medium", verdict: index % 3 === 0 ? "pass" : index % 3 === 1 ? "violation" : "unknown",
  reasonCode: index % 3 === 2 ? "missing-data" : null,
  evidence: [{ resourceId: r.id, propertyPath: `/properties/${index % 3 === 2 ? "uncollectedField" : property}`,
    observation: index % 3 === 2 ? { state: "missing" } : { state: "present", value: value as JsonValue } }],
  };
});
export const advisor = {
  schemaVersion: 1, retrievedAt: createdAt, mappingVersion: "synthetic-v1",
  coverage: { total: 2, included: 1, excluded: 1, reasons: [{ code: "unmapped-advisor-type", count: 1 }] },
  recommendations: [{ recommendationId: "synthetic-advisor-1", recommendationTypeId: "00000000-0000-4000-8000-000000001001",
    resourceId: resourceIds.vm, ruleId: "synthetic-property-check", actionId: "synthetic-review" }],
} satisfies AdvisorResult;
export const actualCost = {
  schemaVersion: 1, retrievedAt: createdAt,
  period: { from: "2026-11-01T00:00:00Z", to: "2026-11-11T00:00:00Z", preset: "month-to-date" },
  scope: { kind: "subscriptions", requestedSubscriptionIds: [ids.subscription, ids.otherSubscription],
    availableSubscriptionIds: [ids.subscription, ids.otherSubscription], paginationComplete: true },
  rows: [
    { subscriptionId: ids.subscription, currency: "CAD", amount: 0,
      attribution: { kind: "resource", resourceId: resourceIds.vm } },
    { subscriptionId: ids.otherSubscription, currency: "USD", amount: 15,
      attribution: { kind: "unattributed", resourceId: `/subscriptions/${ids.otherSubscription}/resourcegroups/rg-synthetic/providers/microsoft.web/sites/deleted`, reason: "outside-inventory" } },
    { subscriptionId: ids.otherSubscription, currency: "USD", amount: -3,
      attribution: { kind: "unattributed", resourceId: null, reason: "invalid-resource-id" } },
    { subscriptionId: ids.otherSubscription, currency: "USD", amount: 0.34,
      attribution: { kind: "unattributed", resourceId: null, reason: "missing-resource-id" } },
  ],
  totals: [{ currency: "CAD", amount: 0, subscriptionIds: [ids.subscription] },
    { currency: "USD", amount: 12.34, subscriptionIds: [ids.otherSubscription] }],
} satisfies ActualCost;
export const diff = {
  schemaVersion: 1, workspaceId: ids.workspace,
  baselineScan: { ...sourceScan, id: ids.oldScan, collectedAt: "2026-11-09T12:00:00Z" },
  comparisonScan: sourceScan, comparedAt: createdAt,
  coverage: { total: 33, included: 32, excluded: 1, reasons: [{ code: "missing-data", count: 1 }] },
  counts: { added: 1, removed: 1, changed: 1, unknown: 1 },
  changes: [
    { kind: "added", resourceId: syntheticResources[31].id },
    { kind: "removed", resourceId: `${base}/microsoft.web/sites/app-removed` },
    { kind: "changed", resourceId: syntheticResources[12].id,
      properties: [{ path: "/properties/httpsOnly", before: { state: "present", value: false }, after: { state: "present", value: true } }] },
    { kind: "unknown", resourceId: syntheticResources[14].id, reasons: ["missing-data"] },
  ],
} satisfies ScanDiff;
export const previousSnapshot = {
  sourceScan: diff.baselineScan,
  inventory: { ...inventory, resources: [
    ...syntheticResources.slice(0, 31).map((r, index) => index === 12 ? { ...r, properties: { ...r.properties, httpsOnly: false } } : r),
    resource("microsoft.web/sites", "app-removed", { httpsOnly: true }),
  ] },
};
export const assessment = {
  schemaVersion: 1, id: ids.assessment, workspaceId: ids.workspace, sourceScanId: ids.scan, sourceScan, createdAt,
  local: { rulesVersion: "synthetic-v1", evaluatedAt: createdAt,
    coverage: { total: 32, included: 32, excluded: 0, reasons: [] }, findings },
  advisor: { state: "partial", data: advisor, reasons: ["unmapped-advisor-type"] },
  actualCost: { schemaVersion: 1, monthToDate: { state: "available", data: actualCost },
    trailing30Days: { state: "failed", reason: "timeout" } }, diff: { state: "available", data: diff },
  roadmap: { state: "failed", reason: "validation-failed" },
} satisfies AssessmentResult;
export const networkDiagnostic = {
  schemaVersion: 1, id: ids.network, workspaceId: ids.workspace, sourceScanId: ids.scan, sourceScan, createdAt,
  query: { sourceScanId: ids.scan, sourceResourceId: resourceIds.vm, destinationResourceId: resourceIds.storage,
    protocol: "tcp", sourcePort: null, destinationPort: 443 },
  engine: { engineVersion: "synthetic-v1", sourceResourceId: resourceIds.vm, destinationResourceId: resourceIds.storage,
    verdict: "unknown", reasonCodes: ["unsupported-path"], paths: [{ verdict: "unknown", reasonCodes: ["unsupported-path"],
      hops: [{ resourceId: resourceIds.routeTable, hopType: "route_table", verdict: "unknown", reasonCodes: ["unsupported-path"],
        evidence: [{ resourceId: resourceIds.routeTable, propertyPath: "/properties/routes/0/properties/nextHopType", observation: { state: "present", value: "VirtualAppliance" } }] }] }] },
} satisfies NetworkDiagnostic;
const plans = (["low", "balanced", "ha"] as const).map(tier => ({
  tier, referenceArchitectureId: "synthetic-web", title: localized,
  reusedResources: [{ resourceId: resourceIds.vnet, componentId: "synthetic-vnet", reason: localized }],
  newItems: [{ componentId: "synthetic-compute", quantity: tier === "ha" ? 2 : 1 }], usageIncreases: [], subnetProposals: [], pros: [localized],
}));
export const extensionProposal = { schemaVersion: 1, requestTitle: localized, recommendedTier: "balanced",
  recommendationReason: localized, plans } satisfies ExtensionProposal;
// CIDR 검증기에서 재사용할 구조화 제안. 카탈로그 지원이나 대역 안전성을 승인한 자료가 아니다.
export const subnetExtensionProposal = { ...extensionProposal, plans: plans.map((plan, index) => ({
  ...plan,
  newItems: [...plan.newItems, { componentId: "synthetic-subnet", quantity: 1 },
    ...(index === 1 ? [{ componentId: "synthetic-new-vnet", quantity: 1 }] : [])],
  subnetProposals: [{ id: "apps-subnet", componentId: "synthetic-subnet", region: "canadacentral",
    parent: index === 1 ? { kind: "new" as const, id: "workload-vnet", componentId: "synthetic-new-vnet", addressPrefixes: ["10.40.0.0/16"] }
      : { kind: "existing" as const, resourceId: resourceIds.vnet },
    addressPrefixes: ["10.40.2.0/24"],
  }],
})) } satisfies ExtensionProposal;
export const extension = {
  ...extensionProposal, id: ids.extension, workspaceId: ids.workspace, sourceScanId: ids.scan, sourceScan, createdAt,
  input: { schemaVersion: 1, workspaceId: ids.workspace, sourceScanId: ids.scan, description: "Add a synthetic web API to the existing network.",
    expectedUsers: "under-100", monthlyBudget: 300, region: "canadacentral", availability: "medium" },
  catalogVersion: "synthetic-v1", reusePolicyVersion: "synthetic-v1", contextCoverage: coverage,
  plans: plans.map(p => ({ ...p, incrementalCost: { state: "available", data: {
    currency: "CAD", priceAsOf: "2026-11-01", total: p.newItems[0].quantity * 10,
    lines: [{ kind: "new", componentId: "synthetic-compute", resourceId: null, quantity: p.newItems[0].quantity, amount: p.newItems[0].quantity * 10 }],
  } }, checks: [{ kind: "capacity", verdict: "unknown", reasonCodes: ["capacity-unverified"], resourceIds: [resourceIds.vnet], componentIds: ["synthetic-vnet"], evidence: [] }] })),
} satisfies ExtensionResult;
const artifactBase = { schemaVersion: 1, id: "00000000-0000-4000-8000-000000002001", workspaceId: ids.workspace,
  extensionId: ids.extension, sourceScanId: ids.scan, tier: "balanced", createdAt } as const;
export const extensionArtifacts = [
  { ...artifactBase, kind: "guide", content: { overview: localized, prerequisites: [localized], cautions: [localized],
    steps: [{ title: localized, goal: localized, instructions: [localized], componentIds: ["synthetic-compute"], reusedResourceIds: [resourceIds.vnet], verification: localized }] } },
  { ...artifactBase, id: "00000000-0000-4000-8000-000000002002", kind: "evaluation", content: { summary: localized,
    axes: (["reliability", "security", "cost", "operations", "performance"] as const).map(axis => ({ axis, grade: "medium", rationale: localized, improvement: localized })) } },
  { ...artifactBase, id: "00000000-0000-4000-8000-000000002003", kind: "bicep", content: {
    code: "resource vnet 'Microsoft.Network/virtualNetworks@2024-05-01' existing = {\n  name: 'vnet-synthetic'\n}", parameters: [], deploymentNotes: [localized],
    existingResourceIds: [resourceIds.vnet], newComponentIds: ["synthetic-compute"], unverifiedDraft: true } },
] satisfies ExtensionArtifact[];
