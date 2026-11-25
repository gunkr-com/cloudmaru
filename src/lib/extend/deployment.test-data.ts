import { loadCatalog } from "@/lib/catalog/load";
import { getExtensionDeploymentIntent } from "@/lib/catalog/extension-deployment";
import { fixture } from "./proposal.test-data";
import type { ExtensionProposal } from "@/types/extension";
const catalog = loadCatalog();
export function referencePlan(referenceId: string, tier: "low" | "balanced" | "ha"): ExtensionProposal["plans"][number] {
  const reference = catalog.architectures.find(a => a.id === referenceId)!.tiers[tier];
  const intent = getExtensionDeploymentIntent(catalog, referenceId, tier)!;
  const plan = structuredClone(fixture().raw.plans[0]);
  plan.tier = tier; plan.referenceArchitectureId = referenceId;
  plan.reusedResources = []; plan.usageIncreases = []; plan.subnetProposals = [];
  plan.newItems = reference.items.map(item => ({ ...item, instanceCount: item.componentId === "internet-egress" ? 0
    : item.componentId.startsWith("container-apps-") ? intent.containerApps!.minimumReplicas
    : item.componentId === "postgres-flex-storage" ? reference.items.find(i => i.componentId.startsWith("postgres-flex-") && i.componentId !== "postgres-flex-storage")!.quantity
    : catalog.components.find(c => c.id === item.componentId)!.usage ? 1 : item.quantity }));
  if (intent.networkRequirements.length) {
    plan.newItems.push({componentId: "virtual-network", quantity: 1, instanceCount: 1}, {componentId: "virtual-network-subnet", quantity: intent.networkRequirements.length, instanceCount: intent.networkRequirements.length});
    plan.deploymentBindings = intent.networkRequirements.map((n, i) => ({ role: n.role, target: { kind: "new-subnet", subnetProposalId: `network-role-${i}` } }));
    plan.subnetProposals = intent.networkRequirements.map((n, i) => ({id: `network-role-${i}`, componentId: "virtual-network-subnet", region: "canadacentral", addressPrefixes: [`10.2.${i}.0/24`],
      parent: {kind: "new", id: "new-vnet", componentId: "virtual-network", addressPrefixes: ["10.2.0.0/16"]},
      ...(n.delegation === "Microsoft.App/environments" ? {delegation: n.delegation} : {}),
    }));
  }
  return plan;
}
