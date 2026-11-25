import { processExtensionOutput } from "./process";
import { createExtensionRequestContext } from "./validate-proposal";
// 테스트 전용: 실제 카탈로그 ID + 합성 저장 스캔. phase21은 savedProposal을 재사용한다.
import { loadCatalog } from "@/lib/catalog/load";
import { loadExtensionSupportCatalog } from "@/lib/catalog/extension-support";
import { completeSnapshot, ids } from "@/lib/completion/fixtures.test-data";
import { summarizeInventory } from "@/lib/inventory/summarize";
import type { InventoryResource } from "@/types/inventory";
import type { ExtensionInput, ExtensionProposal } from "@/types/extension";

export const proposalCatalog = loadCatalog();
export const proposalSupport = loadExtensionSupportCatalog();
const root = `/subscriptions/${ids.subscription}/resourcegroups/sample-rg/providers`;
function resource(type: string, name: string, properties = {}, sku: InventoryResource["sku"] = null): InventoryResource {
  return { id: `${root}/${type}/${name}`, type, name, properties, sku, location: "canadacentral",
    subscriptionId: ids.subscription, resourceGroup: "sample-rg", parentId: null, kind: null,
    tags: {}, zones: [], managedBy: null, observedFields: ["properties", "location", "sku"] };
}
export const proposalResources = [
  resource("microsoft.network/virtualnetworks", "sample-vnet", { addressSpace: { addressPrefixes: ["10.1.0.0/16"] } }),
  resource("microsoft.web/serverfarms", "sample-plan", { reserved: true }, { name: "P1v3" }),
  resource("microsoft.keyvault/vaults", "sample-vault"),
  resource("microsoft.operationalinsights/workspaces", "sample-logs"),
];
export const proposalInventory = { resources: proposalResources, containers: [], relations: [], skippedRows: 0 };
export const proposalScan = { ...completeSnapshot.record, summary: summarizeInventory(proposalResources, []) };
export const proposalInput: ExtensionInput = { schemaVersion: 1, workspaceId: proposalScan.workspaceId,
  sourceScanId: proposalScan.id, description: "Add a reservation web service with a database.",
  region: "canadacentral", monthlyBudget: 300, availability: "medium", expectedUsers: "under-10k" };
const text = { en: "Extend the saved workload", ko: "저장된 워크로드를 확장합니다." };
const proposal: ExtensionProposal = {
  schemaVersion: 1, requestTitle: text, recommendedTier: "balanced", recommendationReason: text,
  plans: (["low", "balanced", "ha"] as const).map(tier => ({
    tier, referenceArchitectureId: "app-service-basic-web-app", title: text, pros: [text],
    reusedResources: proposalResources.map((r, i) => ({ resourceId: r.id, componentId: [
      "virtual-network", "app-service-linux-p1v3", "key-vault-operations", "log-analytics-ingestion",
    ][i], reason: text })),
    newItems: [{ componentId: tier === "ha" ? "postgres-flex-gp-2vcore" : "postgres-flex-b1ms", quantity: tier === "ha" ? 2 : 1, instanceCount: tier === "ha" ? 2 : 1 }, { componentId: "virtual-network-subnet", quantity: 1, instanceCount: 1 },
      ...(tier === "ha" ? [{ componentId: "virtual-network", quantity: 1, instanceCount: 1 }] : []),
      { componentId: "postgres-flex-storage", quantity: tier === "ha" ? 64 : 32, instanceCount: tier === "ha" ? 2 : 1 }],
    usageIncreases: [
      { resourceId: proposalResources[2].id, componentId: "key-vault-operations", quantity: 10 },
      { resourceId: proposalResources[3].id, componentId: "log-analytics-ingestion", quantity: 5 },
    ],
    subnetProposals: [{ id: "workload-subnet", componentId: "virtual-network-subnet", region: "canadacentral",
      addressPrefixes: [tier === "ha" ? "10.2.1.0/24" : "10.1.1.0/24"],
      parent: tier === "ha" ? { kind: "new" as const, id: "workload-vnet", componentId: "virtual-network", addressPrefixes: ["10.2.0.0/16"] }
        : { kind: "existing" as const, resourceId: proposalResources[0].id } }],
  })),
};

// 설명 객체 공유로 한 필드 변형이 다른 안까지 바꾸지 않도록 독립 복사한다.
export const savedProposal: ExtensionProposal = JSON.parse(JSON.stringify(proposal));

export function fixture() {
  const context = createExtensionRequestContext(proposalInput, proposalScan, proposalInventory, proposalCatalog, { support: proposalSupport });
  const byId = new Map([...context.model.aliasToResourceId].map(([alias, id]) => [id, alias]));
  const raw = structuredClone(savedProposal);
  for (const plan of raw.plans) {
    for (const item of [...plan.reusedResources, ...plan.usageIncreases]) item.resourceId = byId.get(item.resourceId)!;
    for (const subnet of plan.subnetProposals) if (subnet.parent.kind === "existing") subnet.parent.resourceId = byId.get(subnet.parent.resourceId)!;
  }
  return { context, raw };
}

/** phase21용 검증·계산 완료 결과. 모델/제품 코드에서 이 test-only 모듈을 불러오지 않는다. */
export function processedFixture() {
  const f = fixture();
  const processed = processExtensionOutput(f.raw, f.context, {
    id: ids.extension, createdAt: "2026-11-12T12:00:00.000Z",
  });
  if (!processed.ok) throw new Error("invalid-extension-fixture");
  return { ...f, result: processed.value };
}
