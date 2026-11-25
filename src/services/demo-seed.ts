/** Installable offline examples. This module is CLI-only, never a product route. */
import 'server-only';
import { PGlite } from '@electric-sql/pglite';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { applyMigrations } from './db/migrate';
import { createWorkspacesStore } from './db/workspaces';
import { createScansDb } from './db/scans';
import { createAnalysesDb } from './db/analyses';
import { createAssessmentsDb } from './db/assessments';
import { createAssessmentRoadmapsDb } from './db/assessment-roadmaps';
import { createExtensionsDb } from './db/extensions';
import { createNetworkDiagnosticsDb } from './db/network-diagnostics';
import { loadExtensionSupportCatalog } from '@/lib/catalog/extension-support';
import { loadCatalog } from '@/lib/catalog/load';
import { buildAnalysisResult } from '@/lib/analysis/build-result';
import { buildExplicitRelations } from '@/lib/inventory/relations';
import { summarizeInventory } from '@/lib/inventory/summarize';
import { toCompletionSourceScan } from '@/lib/completion/source-scan';
import { evaluateAssessmentRules } from '@/lib/assessment/rules/engine';
import { compareScans } from '@/lib/inventory/diff';
import { buildRoadmapContext } from '@/lib/assessment/roadmap/context';
import { composeExplanation } from '@/lib/assessment/roadmap/explanation';
import { validateRoadmapOutput } from '@/lib/assessment/roadmap/model';
import { createExtensionRequestContext } from '@/lib/extend/validate-proposal';
import { processExtensionOutput } from '@/lib/extend/process';
import { diagnosePath } from '@/lib/network';
import { networkResources } from '@/lib/network-diagnostics/validation';
import type { AnalysisInput } from '@/types/analysis';
import type { AssessmentResult } from '@/types/assessment';
import type { ExtensionProposal } from '@/types/extension';
import type { InventoryResource } from '@/types/inventory';
import type { ScanInventory } from '@/types/scan';

const VERSION = 'cloudsight-offline-demo-v1';
const SUBSCRIPTION = '00000000-0000-4000-8000-00000000a001';
const BASE = `/subscriptions/${SUBSCRIPTION}/resourcegroups/rg-synthetic-demo/providers`;
const VNET = `${BASE}/microsoft.network/virtualnetworks/demo-vnet`;
const SUBNET = `${VNET}/subnets/demo-apps`;
const NSG = `${BASE}/microsoft.network/networksecuritygroups/demo-nsg`;
const VM = `${BASE}/microsoft.compute/virtualmachines/demo-source`;
const DESTINATION = `${BASE}/microsoft.compute/virtualmachines/demo-destination`;
const NIC = `${BASE}/microsoft.network/networkinterfaces/demo-source`;
const DESTINATION_NIC = `${BASE}/microsoft.network/networkinterfaces/demo-destination`;
const PLAN = `${BASE}/microsoft.web/serverfarms/demo-plan`;
const TIERS = ['low', 'balanced', 'ha'] as const;
const observedAt = '2026-11-11T12:00:00Z';
// Network and Extend examples use separate small scans. Collect them earlier so Overview's latest scan stays the assessed one.
const exampleObservedAt = '2026-11-11T11:00:00Z';
function resource(id: string, type: string, properties: InventoryResource['properties'], extra: Partial<InventoryResource> = {}): InventoryResource {
  return { id, type, name: id.split('/').at(-1)!, properties, subscriptionId: SUBSCRIPTION,
    resourceGroup: 'rg-synthetic-demo', location: 'canadacentral', kind: null, sku: null,
    tags: { environment: 'synthetic-demo' }, zones: [], managedBy: null, parentId: null,
    observedFields: ['properties', 'location', 'sku'], ...extra };
}
const inventory = (resources: InventoryResource[]): ScanInventory => ({ resources, containers: [], relations: buildExplicitRelations(resources), skippedRows: 0 });
const text = { en: 'Extend the saved workload', ko: '저장된 워크로드를 확장합니다.' };

/** No target option and no global getDb: the only DB opened is inside mkdtemp.
 * Does not load dotenv, initialize an Azure/Claude client or invoke a compiler.
 * Empty args are the public npm command; --new is an optional explicit spelling.
 */
export async function seedDemo(args: readonly string[] = []) {
  if (args.length > 1 || args.length === 1 && args[0] !== '--new') throw Error('demo-seed-new-only');
  if (process.env.CLOUDSIGHT_DATA_DIR) throw Error('demo-seed-existing-environment');
  const directory = await mkdtemp(join(tmpdir(), VERSION + '-'));
  const dataDirectory = join(directory, 'data');
  const db = new PGlite(dataDirectory), deps = { db: async () => db };
  try {
    await applyMigrations(db, fileURLToPath(new URL('../../db/migrations/', import.meta.url)));
    const workspace = (await createWorkspacesStore(deps).createWorkspace({
      name: 'Synthetic offline demo', companyName: 'Synthetic examples only · 합성 예제 전용', defaultRegion: 'canadacentral',
    })).id;
    const catalog = loadCatalog(), analyses = createAnalysesDb(deps), scans = createScansDb(deps);
    const architecture = catalog.architectures.find(a => a.id === 'app-service-basic-web-app')!;
    const input: AnalysisInput = { description: 'Synthetic demo: a reservation web service. 합성 데모 예약 웹 서비스.',
      expectedUsers: 'under-10k', monthlyBudget: 300, availability: 'medium', region: 'canadacentral' };
    const built = buildAnalysisResult({
      requestTitle: { en: 'Synthetic reservation service', ko: '합성 예약 서비스' },
      outOfScope: false, recommendedTier: 'balanced',
      recommendationReason: { en: 'A saved synthetic example for comparing catalog configurations and snapshot estimates. Review workload requirements before use.',
        ko: '카탈로그 구성과 스냅샷 예상 비용을 비교하는 저장된 합성 예제입니다. 사용 전에 워크로드 요구사항을 검토하세요.' },
      plans: TIERS.map(tier => ({ tier, referenceArchitectureId: architecture.id,
        title: { en: `Synthetic ${tier} configuration`, ko: `합성 ${tier} 구성` },
        items: architecture.tiers[tier].items, connections: architecture.tiers[tier].connections,
        pros: [{ en: 'Explore the saved catalog configuration and its assumptions.', ko: '저장된 카탈로그 구성과 가정을 확인합니다.' }],
      })),
    }, input, catalog);
    if (!built.ok) throw Error('demo-seed-build-validation');
    const build = await analyses.createAnalysis({ workspaceId: workspace, input, sourceAnalysisId: null });
    await analyses.completeAnalysis(build, built.result, null);

    const saveScan = async (data: ScanInventory, collectedAt = observedAt) => scans.createImportScan({
      workspaceId: workspace, subscriptionIds: [SUBSCRIPTION], inventory: data,
      summary: summarizeInventory(data.resources, data.containers), collectedAt,
    });
    const storageId = `${BASE}/microsoft.storage/storageaccounts/demostorage`;
    const resources = [
      resource(storageId, 'microsoft.storage/storageaccounts',
        { supportsHttpsTrafficOnly: true, minimumTlsVersion: 'TLS1_2', publicNetworkAccess: 'Disabled' }),
      resource(`${BASE}/microsoft.keyvault/vaults/demo-vault`, 'microsoft.keyvault/vaults',
        { enableSoftDelete: true, enablePurgeProtection: false, publicNetworkAccess: 'Disabled' }),
      resource(VNET, 'microsoft.network/virtualnetworks', { subnets: [{ id: SUBNET }] }),
      resource(SUBNET, 'microsoft.network/virtualnetworks/subnets', { networkSecurityGroup: { id: NSG } }, { parentId: VNET }),
      resource(NSG, 'microsoft.network/networksecuritygroups', { securityRules: [{
        name: 'demo-management-allow', properties: { direction: 'Inbound', protocol: 'Tcp', access: 'Allow', priority: 100,
          sourcePortRange: '*', destinationPortRange: '22', sourceAddressPrefix: '*', destinationAddressPrefix: '*' },
      }] }),
      resource(`${BASE}/microsoft.network/privateendpoints/demo-storage-endpoint`, 'microsoft.network/privateendpoints',
        { subnet: { id: SUBNET }, privateLinkServiceConnections: [{ properties: { privateLinkServiceId: storageId } }] }),
      resource(PLAN, 'microsoft.web/serverfarms', { reserved: true }, { sku: { name: 'P1v3' } }),
      ...Array.from({ length: 9 }, (_, i) => resource(`${BASE}/microsoft.web/sites/demo-app-${i}`, 'microsoft.web/sites',
        { serverFarmId: PLAN, ...i % 3 === 2 ? {} : { httpsOnly: i % 3 === 0, siteConfig: { minTlsVersion: '1.2', ftpsState: 'Disabled' } } }, { kind: 'app' })),
    ];
    const previousInventory = inventory(structuredClone(resources.slice(0, -1)));
    previousInventory.resources.find(item => item.name === 'demo-app-0')!.properties.httpsOnly = false;
    const previousScan = await saveScan(previousInventory, '2026-11-10T12:00:00Z');
    const sourceScan = await saveScan(inventory(resources));
    const assessments = createAssessmentsDb(deps), roadmaps = createAssessmentRoadmapsDb(deps);
    const previous = (await assessments.loadSnapshot(previousScan))!, source = (await assessments.loadSnapshot(sourceScan))!;
    const pending = (await assessments.reserveAssessment({ schemaVersion: 1, workspaceId: workspace, sourceScanId: sourceScan, previousScanId: previousScan }))!;
    const assessmentRow = (await assessments.getAssessment(pending.id))!, now = new Date().toISOString();
    const result: AssessmentResult = { schemaVersion: 1, id: pending.id, workspaceId: workspace, sourceScanId: sourceScan,
      sourceScan: toCompletionSourceScan(source.scan, source.inventory), createdAt: assessmentRow.createdAt,
      local: evaluateAssessmentRules(source.inventory.resources, now), advisor: { state: 'unavailable', reason: 'not-supported' },
      actualCost: { schemaVersion: 1, monthToDate: { state: 'unavailable', reason: 'not-supported' }, trailing30Days: { state: 'unavailable', reason: 'not-supported' } },
      diff: { state: 'available', data: compareScans(previous, source, now) }, roadmap: { state: 'not-requested' } };
    await assessments.completeAssessment(pending.id, result);
    const roadmapReservation = (await roadmaps.reserveAssessmentRoadmap(pending.id, new Date(0)))!;
    const basis = buildRoadmapContext(result, (await roadmaps.getAssessmentRoadmapCatalogData(pending.id))!);
    if (basis.state !== 'ready') throw Error('demo-seed-roadmap-context');
    const { payload } = basis;
    const roadmap = validateRoadmapOutput({
      summary: composeExplanation({ relation: 'review', actions: [payload.actions[0].alias], focus: 'review' }, payload),
      phases: payload.actions.map(a => ({
        title: composeExplanation({ relation: 'review', actions: [a.alias], focus: 'review' }, payload, 'before', true),
        findingAliases: [...a.findingAliases], actionAliases: [a.alias],
      })),
    }, basis, new Date().toISOString());
    if (!roadmap.ok) throw Error('demo-seed-roadmap-validation');
    await roadmaps.completeAssessmentRoadmap(pending.id, roadmapReservation.attemptId, roadmap.value, null);

    const diagnostics = createNetworkDiagnosticsDb(deps), network = {} as Record<'allowed' | 'blocked' | 'unknown', string>;
    for (const verdict of ['allowed', 'blocked', 'unknown'] as const) {
      const rule = (direction: string, access = 'Allow', destinationAddressPrefix = '*') => ({ name: `demo-${direction}`, properties: {
        direction, access, priority: 100, sourceAddressPrefix: '*', destinationAddressPrefix,
        sourcePortRange: '*', destinationPortRange: '*', protocol: 'Tcp',
      } });
      const networkInventory = inventory([
        resource(VNET, 'microsoft.network/virtualnetworks', { addressSpace: { addressPrefixes: ['10.0.0.0/16'] } }),
        resource(SUBNET, 'microsoft.network/virtualnetworks/subnets', { networkSecurityGroup: { id: NSG }, routeTable: null }),
        resource(NSG, 'microsoft.network/networksecuritygroups', { defaultSecurityRules: [], securityRules: [rule('inbound'),
          rule('outbound', verdict === 'allowed' ? 'Allow' : 'Deny', verdict === 'unknown' ? 'AzureMonitor' : '*')] }),
        ...[[VM, NIC, '10.0.1.4'], [DESTINATION, DESTINATION_NIC, '10.0.1.5']].flatMap(([vm, nic, ip]) => [
          resource(vm, 'microsoft.compute/virtualmachines', { networkProfile: { networkInterfaces: [{ id: nic }] } }),
          resource(nic, 'microsoft.network/networkinterfaces', { networkSecurityGroup: null,
            ipConfigurations: [{ properties: { privateIPAddress: ip, subnet: { id: SUBNET } } }] }),
        ]),
      ]);
      const sourceScanId = await saveScan(networkInventory, exampleObservedAt);
      const query = { sourceScanId, sourceResourceId: VM, destinationResourceId: DESTINATION,
        protocol: 'tcp' as const, sourcePort: null, destinationPort: 443 };
      const reservation = (await diagnostics.reserveNetworkDiagnostic({ schemaVersion: 1, workspaceId: workspace, sourceScanId, query }))!;
      const saved = (await diagnostics.getNetworkSourceScan(sourceScanId))!;
      const engine = diagnosePath(networkResources(networkInventory.resources), query, toCompletionSourceScan(saved.scan, networkInventory));
      if (engine.verdict !== verdict) throw Error('demo-seed-network-validation');
      await diagnostics.completeNetworkDiagnostic(reservation.id, engine); network[verdict] = reservation.id;
    }

    const extensionResources = [
      resource(VNET, 'microsoft.network/virtualnetworks', { addressSpace: { addressPrefixes: ['10.1.0.0/16'] } }),
      resource(PLAN, 'microsoft.web/serverfarms', { reserved: true }, { sku: { name: 'P1v3' } }),
      resource(`${BASE}/microsoft.keyvault/vaults/demo-vault`, 'microsoft.keyvault/vaults', {}),
      resource(`${BASE}/microsoft.operationalinsights/workspaces/demo-logs`, 'microsoft.operationalinsights/workspaces', {}),
    ];
    const extensionSourceScan = await saveScan(inventory(extensionResources), exampleObservedAt), extensions = createExtensionsDb({ ...deps, coreData: { catalog, support: loadExtensionSupportCatalog(catalog) } });
    const extensionInput = { schemaVersion: 1 as const, workspaceId: workspace, sourceScanId: extensionSourceScan,
      description: 'Synthetic demo: add a reservation web service with a database. 합성 확장 예제.',
      expectedUsers: 'under-10k' as const, monthlyBudget: 300, region: 'canadacentral', availability: 'medium' as const };
    const extensionReservation = (await extensions.reserveExtension(extensionInput))!;
    const extensionRow = (await extensions.getExtension(extensionReservation.id))!;
    const extensionSnapshot = (await extensions.getExtensionSourceScan(extensionSourceScan))!;
    const context = createExtensionRequestContext(extensionInput, extensionSnapshot.scan, extensionSnapshot.inventory, catalog);
    const aliases = new Map([...context.model.aliasToResourceId].map(([alias, id]) => [id, alias]));
    const proposal: ExtensionProposal = { schemaVersion: 1, requestTitle: text, recommendationReason: text, recommendedTier: 'balanced',
      plans: TIERS.map(tier => ({ tier, referenceArchitectureId: architecture.id, title: text, pros: [text],
        reusedResources: extensionResources.map((r, i) => ({ resourceId: aliases.get(r.id)!, componentId: [
          'virtual-network', 'app-service-linux-p1v3', 'key-vault-operations', 'log-analytics-ingestion',
        ][i], reason: text })),
        newItems: [{ componentId: tier === 'ha' ? 'postgres-flex-gp-2vcore' : 'postgres-flex-b1ms', quantity: tier === 'ha' ? 2 : 1, instanceCount: tier === 'ha' ? 2 : 1 },
          { componentId: 'virtual-network-subnet', quantity: 1, instanceCount: 1 },
          ...(tier === 'ha' ? [{ componentId: 'virtual-network', quantity: 1, instanceCount: 1 }] : []),
          { componentId: 'postgres-flex-storage', quantity: tier === 'ha' ? 64 : 32, instanceCount: tier === 'ha' ? 2 : 1 }],
        usageIncreases: [{ resourceId: aliases.get(extensionResources[2].id)!, componentId: 'key-vault-operations', quantity: 10 },
          { resourceId: aliases.get(extensionResources[3].id)!, componentId: 'log-analytics-ingestion', quantity: 5 }],
        subnetProposals: [{ id: 'workload-subnet', componentId: 'virtual-network-subnet', region: 'canadacentral',
          addressPrefixes: [tier === 'ha' ? '10.2.1.0/24' : '10.1.1.0/24'],
          parent: tier === 'ha' ? { kind: 'new' as const, id: 'workload-vnet', componentId: 'virtual-network', addressPrefixes: ['10.2.0.0/16'] }
            : { kind: 'existing' as const, resourceId: aliases.get(VNET)! } }],
      })),
    };
    const extension = processExtensionOutput(proposal, context, { id: extensionRow.id, createdAt: extensionRow.createdAt });
    if (!extension.ok) throw Error('demo-seed-extension-validation');
    await extensions.completeExtension(extensionRow.id, extension.value);

    const ids = { workspace, build, sourceScan, previousScan, assessment: pending.id, extension: extensionRow.id, network };
    const manifest = { demoVersion: VERSION, synthetic: true as const, directory, dataDirectory,
      notice: { en: 'Synthetic offline examples. No Azure collection, Claude request or Bicep compilation was performed.',
        ko: '합성 오프라인 예제입니다. Azure 수집, Claude 요청, Bicep 컴파일을 수행하지 않았습니다.' },
      artifacts: { bicep: 'not-generated', reason: 'No compiler or model is required for this demo.' }, ids,
      urls: { workspaces: '/workspaces', build: `/analyses/${build}`, assessment: `/assessments/${pending.id}`,
        report: `/assessments/${pending.id}/report`, reportDownload: `/api/assessments/${pending.id}/report`,
        extension: `/extensions/${extensionRow.id}?tier=balanced`,
        network: Object.fromEntries(Object.entries(network).map(([verdict, id]) => [verdict, `/network/${id}`])) },
    };
    await writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    return manifest;
  } finally { await db.close(); }
}
