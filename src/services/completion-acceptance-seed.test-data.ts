/** Offline operator fixture builder. No product route imports this test-only module. */
import 'server-only';
import {PGlite} from '@electric-sql/pglite';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {applyMigrations} from './db/migrate';
import {createWorkspacesStore} from './db/workspaces';
import {createScansDb} from './db/scans';
import {createAssessmentsDb} from './db/assessments';
import {createAssessmentRoadmapsDb} from './db/assessment-roadmaps';
import {createExtensionsDb} from './db/extensions';
import {createExtensionArtifactsDb} from './db/extension-artifacts';
import {createNetworkDiagnosticsDb} from './db/network-diagnostics';
import {createExtensionArtifactContextService} from './extension-artifact-context';
import {checkExtensionArtifactCompilerAvailability,validateExtensionArtifact} from './extension-artifact-compiler';
import {completeSnapshot,previousSnapshot,partialSnapshot} from '@/lib/completion/fixtures.test-data';
import {advisorCatalog} from '@/lib/assessment/advisor-catalog';
import {mapAdvisorRows} from '@/lib/assessment/advisor-parse';
import {BICEP_CLI_VERSION,BICEP_CLI_COMMIT} from '@/lib/extend-artifacts/compiled-template';
import {summarizeInventory} from '@/lib/inventory/summarize';
import {toCompletionSourceScan} from '@/lib/completion/source-scan';
import {evaluateAssessmentRules} from '@/lib/assessment/rules/engine';
import {compareScans} from '@/lib/inventory/diff';
import {buildRoadmapContext} from '@/lib/assessment/roadmap/context';
import {validateRoadmapOutput} from '@/lib/assessment/roadmap/model';
import {roadmapModelFixture} from '@/lib/assessment/roadmap/fixtures.test-data';
import {processedFixture} from '@/lib/extend/proposal.test-data';
import {createExtensionRequestContext} from '@/lib/extend/validate-proposal';
import {processExtensionOutput} from '@/lib/extend/process';
import {diagnosePath} from '@/lib/network';
import {networkResources} from '@/lib/network-diagnostics/validation';
import {SUBSCRIPTION,BASE,VNET_ID,SUBNET_ID,NSG_ID,VM_ID,NIC_ID,resource,nsgResource,allowRule,denyRule} from '@/lib/network/fixtures.test-data';
import type {AssessmentResult} from '@/types/assessment';
import type {ScanInventory} from '@/types/scan';
import type {StructuredLlmRequest} from '@/types/analysis';
const VERSION='cloudsight-completion-acceptance-v1';
function artifactResponse(request:StructuredLlmRequest) {
 const payload=JSON.parse(request.user);
 if(request.schemaName==='extension_bicep_source')return {code:payload.source};
 if(request.schemaName==='extension_evaluation_plan_v1')return {summary:'review-saved',axes:['reliability','security','cost','operations','performance'].map(axis=>({axis,grade:'medium',rationale:'capacity-unknown',improvement:'verify-isolated'}))};
 return {overview:'review-saved',prerequisites:['check-access'],cautions:['capacity-unknown','review-scope'],steps:[{title:'review-configuration',goal:'review-saved',instructions:['preserve-settings'],verification:'verify-isolated',
 componentIds:payload.components.map((c:{id:string})=>c.id),reusedResourceIds:payload.reusedResources.map((r:{alias:string})=>r.alias)}]};
}
/** No target option: only an exclusively allocated OS temporary directory can be opened.
 * Never loads dotenv, uses global getDb, stores keys or calls a remote transport.
 */
export async function seedCompletionAcceptanceV1(args:readonly string[]) {
 if(args.length!==1||args[0]!=='--new')throw Error('acceptance-seed-new-only');
 if(process.env.CLOUDSIGHT_DATA_DIR)throw Error('acceptance-seed-existing-environment');
 await checkExtensionArtifactCompilerAvailability();
 const directory=await mkdtemp(join(tmpdir(),VERSION+'-'));
 const dataDirectory=join(directory,'data');
 const db=new PGlite(dataDirectory),deps={db:async()=>db};
 try{
  await applyMigrations(db);
  const workspace=(await createWorkspacesStore(deps).createWorkspace({name:'Completion acceptance v1 (synthetic)',companyName:'Synthetic only',defaultRegion:'canadacentral'})).id;
  const otherWorkspace=(await createWorkspacesStore(deps).createWorkspace({name:'Other synthetic workspace',companyName:null,defaultRegion:'westus2'})).id;
  const scans=createScansDb(deps),assessments=createAssessmentsDb(deps),roadmaps=createAssessmentRoadmapsDb(deps);
  const live=async(inventory:ScanInventory,collectedAt:string)=>{
   const pending=await scans.reserveLiveScan({workspaceId:workspace,subscriptionIds:completeSnapshot.record.subscriptionIds,staleBefore:new Date(0)});
   await scans.completeScan(pending.id,{inventory,summary:summarizeInventory(inventory.resources,inventory.containers),subscriptionIds:completeSnapshot.record.subscriptionIds,collectedAt});
   return (await assessments.loadSnapshot(pending.id))!;
  };
  const previous=await live(previousSnapshot.inventory,'2026-11-10T10:00:00Z');
  const source=await live(completeSnapshot.inventory,'2026-11-11T10:00:00Z');
  const incomplete=await live(partialSnapshot.inventory,'2026-11-11T11:00:00Z');
  const createAssessment=async(insights=false,snapshot=source)=>{
   const input={schemaVersion:1 as const,workspaceId:workspace,sourceScanId:snapshot.scan.id,previousScanId:previous.scan.id};
   const row=(await assessments.reserveAssessment(input))!;
   const createdAt=(await assessments.getAssessment(row.id))!.createdAt,now=new Date().toISOString();
   const result:AssessmentResult={schemaVersion:1,id:row.id,workspaceId:workspace,sourceScanId:snapshot.scan.id,sourceScan:toCompletionSourceScan(snapshot.scan,snapshot.inventory),createdAt,
    local:evaluateAssessmentRules(snapshot.inventory.resources,now),advisor:{state:'unavailable',reason:'forbidden'},
    actualCost:{schemaVersion:1,monthToDate:{state:'unavailable',reason:'no-data'},trailing30Days:{state:'unavailable',reason:'forbidden'}},
    diff:{state:'available',data:compareScans(previous,snapshot,now)},roadmap:{state:'not-requested'}};
   if(snapshot===incomplete){
    result.diff={state:'partial',data:compareScans(previous,snapshot,now),reasons:['collection-partial']};
    const entry=advisorCatalog.entries.find(e=>snapshot.inventory.resources.some(r=>e.resourceTypes.includes(r.type)));
    const resource=entry&&snapshot.inventory.resources.find(r=>entry.resourceTypes.includes(r.type));
    if(!entry||!resource)throw Error('fixture-advisor-member');
    result.advisor={state:'partial',reasons:['unmapped-advisor-type'],data:mapAdvisorRows([
     {subscriptionId:resource.subscriptionId,value:{id:`/subscriptions/${resource.subscriptionId}/providers/microsoft.advisor/recommendations/synthetic-mapped`,
      properties:{recommendationTypeId:entry.recommendationTypeId,resourceMetadata:{resourceId:resource.id}}}},
     {subscriptionId:resource.subscriptionId,value:{id:`/subscriptions/${resource.subscriptionId}/providers/microsoft.advisor/recommendations/synthetic-unmapped`,
      properties:{recommendationTypeId:'00000000-0000-4000-8000-000000000099',resourceMetadata:{resourceId:resource.id}}}},
    ],snapshot.inventory.resources.map(r=>r.id),now)};
   }
   if(insights){
    const subscriptionId=source.scan.subscriptionIds[0];
    result.actualCost.monthToDate={state:'available',data:{schemaVersion:1,retrievedAt:now,period:{from:'2026-11-01T00:00:00Z',to:'2026-11-12T00:00:00Z',preset:'month-to-date'},
     scope:{kind:'subscriptions',requestedSubscriptionIds:source.scan.subscriptionIds,availableSubscriptionIds:source.scan.subscriptionIds,paginationComplete:true},
     rows:[{subscriptionId,currency:'CAD',amount:0,attribution:{kind:'unattributed',resourceId:null,reason:'missing-resource-id'}},
      {subscriptionId,currency:'USD',amount:5,attribution:{kind:'unattributed',resourceId:null,reason:'missing-resource-id'}},
      {subscriptionId,currency:'USD',amount:-2,attribution:{kind:'unattributed',resourceId:null,reason:'missing-resource-id'}}],
     totals:[{currency:'CAD',amount:0,subscriptionIds:[subscriptionId]},{currency:'USD',amount:3,subscriptionIds:[subscriptionId]}]}};
   }
   await assessments.completeAssessment(row.id,result);return row.id;
  };
  const assessment=await createAssessment(),insights=await createAssessment(true),roadmapFailed=await createAssessment(),partialAssessment=await createAssessment(false,incomplete);
  const reservation=(await roadmaps.reserveAssessmentRoadmap(assessment,new Date(0)))!;
  const parent=(await roadmaps.getAssessmentRoadmap(assessment))!;
  const basis=buildRoadmapContext(parent.result!,(await roadmaps.getAssessmentRoadmapCatalogData(assessment))!);
  if(basis.state!=='ready')throw Error('fixture-roadmap-context');
  const output=validateRoadmapOutput(roadmapModelFixture(basis.payload),basis,new Date().toISOString());
  if(!output.ok)throw Error('fixture-roadmap-validation');
  await roadmaps.completeAssessmentRoadmap(assessment,reservation.attemptId,output.value,null);
  const failed=(await roadmaps.reserveAssessmentRoadmap(roadmapFailed,new Date(0)))!;
  await roadmaps.failAssessmentRoadmap(roadmapFailed,failed.attemptId,'validation-failed',null);

  const network={} as Record<'allowed'|'blocked'|'unknown',string>;
  const diagnostics=createNetworkDiagnosticsDb(deps);
  const destinationVm=`${BASE}/microsoft.compute/virtualmachines/destination`,destinationNic=`${BASE}/microsoft.network/networkinterfaces/destination`;
  for(const verdict of ['allowed','blocked','unknown'] as const){
   const resources=[resource(VNET_ID,'microsoft.network/virtualnetworks',{addressSpace:{addressPrefixes:['10.0.0.0/16']}}),
    resource(SUBNET_ID,'microsoft.network/virtualnetworks/subnets',{networkSecurityGroup:{id:NSG_ID},routeTable:null}),
    nsgResource(NSG_ID,{securityRules:verdict==='blocked'?[denyRule('deny',{priority:100,direction:'outbound'}),allowRule('in')]
     :verdict==='unknown'?[allowRule('in'),denyRule('tag',{direction:'outbound',destPrefix:'AzureMonitor'})]:[allowRule('in'),allowRule('out',{direction:'outbound'})]}),
    ...[[VM_ID,NIC_ID,'10.0.1.4'],[destinationVm,destinationNic,'10.0.1.5']].flatMap(([vm,nic,ip])=>[
     resource(vm,'microsoft.compute/virtualmachines',{networkProfile:{networkInterfaces:[{id:nic}]}}),
     resource(nic,'microsoft.network/networkinterfaces',{networkSecurityGroup:null,ipConfigurations:[{properties:{privateIPAddress:ip,subnet:{id:SUBNET_ID}}}]})])];
   const inventory={resources,containers:[],relations:[],skippedRows:0};
   const sourceScanId=await scans.createImportScan({workspaceId:workspace,subscriptionIds:[SUBSCRIPTION],inventory,summary:summarizeInventory(resources,[]),collectedAt:'2026-11-11T12:00:00Z'});
   const query={sourceScanId,sourceResourceId:VM_ID,destinationResourceId:destinationVm,protocol:'tcp' as const,sourcePort:null,destinationPort:443};
   const row=(await diagnostics.reserveNetworkDiagnostic({schemaVersion:1,workspaceId:workspace,sourceScanId,query}))!;
   const saved=(await diagnostics.getNetworkSourceScan(sourceScanId))!;
   const engine=diagnosePath(networkResources(resources),query,toCompletionSourceScan(saved.scan,inventory));
   if(engine.verdict!==verdict)throw Error('fixture-network-verdict');
   await diagnostics.completeNetworkDiagnostic(row.id,engine);network[verdict]=row.id;
  }
  const f=processedFixture(),extensions=createExtensionsDb(deps);
  const sourceScanId=await scans.createImportScan({workspaceId:workspace,subscriptionIds:f.context.scan.subscriptionIds,inventory:f.context.inventory,summary:f.context.scan.summary!,collectedAt:f.context.scan.collectedAt!});
  const input={...f.result.input,workspaceId:workspace,sourceScanId};
  const pending=(await extensions.reserveExtension(input))!,saved=(await extensions.getExtensionSourceScan(sourceScanId))!,row=(await extensions.getExtension(pending.id))!;
  const context=createExtensionRequestContext(input,saved.scan,saved.inventory,f.context.catalog,{support:f.context.support});
  const result=processExtensionOutput(f.raw,context,{id:row.id,createdAt:row.createdAt});
  if(!result.ok)throw Error('fixture-extension-validation');
  await extensions.completeExtension(row.id,result.value);
  const constraintsInventory=structuredClone(f.context.inventory);
  const vnet=constraintsInventory.resources.find(r=>r.type==='microsoft.network/virtualnetworks')!;
  vnet.properties.subnets=[{id:`${vnet.id}/subnets/occupied`,name:'occupied',properties:{addressPrefix:'10.1.1.0/24'}}];
  const constraintsScanId=await scans.createImportScan({workspaceId:workspace,subscriptionIds:f.context.scan.subscriptionIds,inventory:constraintsInventory,
   summary:summarizeInventory(constraintsInventory.resources,[]),collectedAt:f.context.scan.collectedAt!});
  const constraintsInput={...input,sourceScanId:constraintsScanId};
  const constraintsSaved=(await extensions.getExtensionSourceScan(constraintsScanId))!;
  const constraintsContext=createExtensionRequestContext(constraintsInput,constraintsSaved.scan,constraintsSaved.inventory,f.context.catalog,{support:f.context.support});
  const constraintsPending=(await extensions.reserveExtension(constraintsInput))!;
  const constraintsRow=(await extensions.getExtension(constraintsPending.id))!;
  const constrained=structuredClone(f.raw);
  const constraintsAliases=new Map([...constraintsContext.model.aliasToResourceId].map(([alias,id])=>[id,alias]));
  const rebind=(alias:string)=>{
   const id=f.context.model.aliasToResourceId.get(alias),next=id&&constraintsAliases.get(id);
   if(!next)throw Error('fixture-constraints-alias');return next;
  };
  for(const plan of constrained.plans){
   for(const item of [...plan.reusedResources,...plan.usageIncreases])item.resourceId=rebind(item.resourceId);
   for(const subnet of plan.subnetProposals)if(subnet.parent.kind==='existing')subnet.parent.resourceId=rebind(subnet.parent.resourceId);
  }
  constrained.plans[0].subnetProposals[0].addressPrefixes=['10.9.1.0/24'];
  const constraintsResult=processExtensionOutput(constrained,constraintsContext,{id:constraintsRow.id,createdAt:constraintsRow.createdAt});
  if(!constraintsResult.ok)throw Error('fixture-constraints-validation');
  await extensions.completeExtension(constraintsRow.id,constraintsResult.value);
  // Current writes reject proposed overlap/region mismatch before a successful
  // result exists. Exercise that exact process and persist ordinary failed rows.
  const extensionFailures={} as Record<'overlap'|'region',string>;
  for(const kind of ['overlap','region'] as const){
   const pending=(await extensions.reserveExtension(input))!,failedRow=(await extensions.getExtension(pending.id))!;
   const invalid=structuredClone(f.raw);
   if(kind==='region')invalid.plans[2].subnetProposals[0].region='westus2';
   else{
    const plan=invalid.plans[1];plan.subnetProposals.push({...structuredClone(plan.subnetProposals[0]),id:'overlap-subnet'});
    const item=plan.newItems.find(i=>i.componentId==='virtual-network-subnet')!;item.quantity=2;item.instanceCount=2;
   }
   const rejected=processExtensionOutput(invalid,context,{id:failedRow.id,createdAt:failedRow.createdAt});
   if(rejected.ok||!rejected.errors.some(error=>error.endsWith(kind==='region'?'region-mismatch':'proposed-subnet-overlap')))throw Error('fixture-expected-rejection');
   await extensions.failExtension(failedRow.id,'validation-failed',null);extensionFailures[kind]=failedRow.id;
  }
  const artifacts=createExtensionArtifactsDb({...deps,validateArtifact:validateExtensionArtifact});
  const preparation=createExtensionArtifactContextService({...extensions,...artifacts});
  for(const tier of ['low','balanced','ha'] as const)for(const kind of ['guide','evaluation','bicep'] as const){
   const reserved=(await artifacts.reserveExtensionArtifact({schemaVersion:1,extensionId:row.id,tier,kind},{staleBefore:new Date(0)}))!;
   const prepared=(await preparation.prepareExtensionArtifactRequest(reserved.id))!;
   const validated=prepared.validate(artifactResponse(prepared.request));
   if(!validated.ok)throw Error('fixture-artifact-validation');
   await artifacts.completeExtensionArtifact(reserved.id,reserved.attemptId,validated.value,null);
  }
  const ids={workspace,otherWorkspace,sourceScan:source.scan.id,previousScan:previous.scan.id,assessment,insights,roadmapFailed,partialAssessment,network,extension:row.id,constraintsExtension:constraintsRow.id,extensionFailures};
  const manifest={fixtureVersion:VERSION,directory,dataDirectory,compilerVersion:`${BICEP_CLI_VERSION} (${BICEP_CLI_COMMIT})`,ids,
   urls:{workspaces:'/workspaces',assessment:`/assessments/${assessment}`,insights:`/assessments/${insights}`,roadmapFailed:`/assessments/${roadmapFailed}`,
    report:`/assessments/${assessment}/report`,reportDownload:`/api/assessments/${assessment}/report`,partialAssessment:`/assessments/${partialAssessment}`,
    network:Object.fromEntries(Object.entries(network).map(([verdict,id])=>[verdict,`/network/${id}`])),extension:`/extensions/${row.id}?tier=low`,
    artifactDownload:`/api/extensions/${row.id}/artifacts/download?tier=low&kind=bicep`,constraintsExtension:`/extensions/${constraintsRow.id}?tier=low`,
    extensionFailures:Object.fromEntries(Object.entries(extensionFailures).map(([kind,id])=>[kind,`/extensions/${id}`]))}};
  await writeFile(join(directory,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{mode:0o600,flag:'wx'});
  return manifest;
 }finally{await db.close();}
}
