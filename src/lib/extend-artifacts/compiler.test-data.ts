import { processedFixture } from '@/lib/extend/proposal.test-data';
import { processExtensionOutput } from '@/lib/extend/process';
import { ids } from '@/lib/completion/fixtures.test-data';
import { createExtensionRequestContext } from '@/lib/extend/validate-proposal';
import { summarizeInventory } from '@/lib/inventory/summarize';
import { bindBicepSource, createBicepContext } from './bicep-semantics';
import type { ArtifactBinding } from './storage-validation';

/** Real17 validation with synthetic input and pinned reviewed catalogs, never a production import. */
export function compilerFixture(tier: 'low' | 'ha' = 'ha') {
  const f = processedFixture();
  for (const plan of f.raw.plans) {
    plan.newItems = plan.newItems.filter(i => !i.componentId.startsWith('postgres-flex-'));
    plan.newItems.push({ componentId: plan.tier==='ha'?'app-service-linux-p0v3':'app-service-linux-b1', quantity: 2, instanceCount: 2 }, { componentId: 'public-ipv4-standard', quantity: 2, instanceCount: 2 });
  }
  const result = processExtensionOutput(f.raw, f.context, { id: ids.extension, createdAt: f.result.createdAt });
  if (!result.ok) throw Error(JSON.stringify(result));
  const basis = { extension: result.value, inventory: f.context.inventory, catalogData: { catalog: f.context.catalog, support: f.context.support } };
  const binding = { id: ids.network, extensionId: ids.extension, workspaceId: result.value.workspaceId, sourceScanId: result.value.sourceScanId,
    createdAt: '2026-11-12T12:00:01.000Z', tier, kind: 'bicep' } satisfies ArtifactBinding;
  const context = createBicepContext(binding, basis), bound = bindBicepSource(context.payload.source, context);
  const artifact = { schemaVersion: 1 as const, ...binding, kind: 'bicep' as const, content: {
    code: bound.code, parameters: [], deploymentNotes: [{ en: 'Review the saved checks before deployment.', ko: '배포 전에 저장된 검사를 검토합니다.' }],
    existingResourceIds: bound.existingResourceIds, newComponentIds: bound.newComponentIds, unverifiedDraft: true as const,
  } };
  return { f, basis, binding, context, bound, artifact };
}

export function existingChildCompilerFixture() {
  const f = processedFixture(), inventory = structuredClone(f.context.inventory);
  const parent = inventory.resources[0];
  parent.resourceGroup = 'other-rg';
  parent.id = parent.id.replace('/sample-rg/', '/other-rg/');
  parent.subscriptionId = ids.otherSubscription;
  parent.id = parent.id.replace(ids.subscription, ids.otherSubscription);
  const child = { ...structuredClone(parent), id: parent.id + '/subnets/saved-child', name: 'sample-vnet/saved-child',
    type: 'microsoft.network/virtualnetworks/subnets', parentId: parent.id, properties: { addressPrefix: '10.1.2.0/24', delegations: [] } };
  inventory.resources.push(child);
  const scan = { ...f.context.scan, subscriptionIds: [...f.context.scan.subscriptionIds, ids.otherSubscription], summary: summarizeInventory(inventory.resources, []) };
  const request = createExtensionRequestContext(f.context.input, scan, inventory, f.context.catalog, { support: f.context.support });
  const alias = [...request.model.aliasToResourceId].find(([, id]) => id === child.id)![0];
  for (const p of f.raw.plans) {
    p.reusedResources = [{ resourceId: alias, componentId: 'virtual-network-subnet', reason: { en: 'Reuse the saved subnet', ko: '저장된 서브넷을 재사용합니다.' } }];
    p.newItems = [{ componentId: 'public-ipv4-standard', quantity: 1, instanceCount: 1 }]; p.usageIncreases = []; p.subnetProposals = [];
  }
  const result = processExtensionOutput(f.raw, request, { id: ids.extension, createdAt: f.result.createdAt });
  if (!result.ok) throw Error(JSON.stringify(result));
  const basis = { extension: result.value, inventory, catalogData: { catalog: request.catalog, support: request.support } };
  const binding = { id: ids.network, extensionId: ids.extension, workspaceId: result.value.workspaceId, sourceScanId: result.value.sourceScanId,
    createdAt: '2026-11-12T12:00:01.000Z', tier: 'ha' as const, kind: 'bicep' as const };
  const context = createBicepContext(binding, basis), bound = bindBicepSource(context.payload.source, context);
  return { context, bound };
}
