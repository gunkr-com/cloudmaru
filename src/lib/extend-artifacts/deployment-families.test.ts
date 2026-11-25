// @vitest-environment node
import {expect,it} from 'vitest';
import {fixture} from '@/lib/extend/proposal.test-data';
import {referencePlan} from '@/lib/extend/deployment.test-data';
import {processExtensionOutput,getExtensionCoreVersions} from '@/lib/extend/process';
import {createExtensionRequestContext} from '@/lib/extend/validate-proposal';
import {summarizeInventory} from '@/lib/inventory/summarize';
import {ids} from '@/lib/completion/fixtures.test-data';
import {createExtensionArtifactCompiler} from '@/services/extension-artifact-compiler';
import {createBicepContext,bindBicepSource} from './bicep-semantics';
import {emitExtendBicep,parseExtendBicep} from './bicep-source';
import type {BicepObject} from './bicep-source';
import type {Tier} from '@/types/catalog';
// Real-compiler contract (docs/SELF_HOSTING.md#native-bicep-compiler): CLOUDSIGHT_TEST_BICEP_PATH names the pinned CLI; unset skips explicitly, a wrong path fails.
const executable=process.env.CLOUDSIGHT_TEST_BICEP_PATH??'';
const refs=['app-service-basic-web-app','app-service-zone-redundant','container-apps-web-api','serverless-static-web-app'];
const tiers=['low','balanced','ha'] as const;
const obj=(v:unknown)=>(v as BicepObject).properties;
function contextFor(basis:ReturnType<typeof prepared>['basis'],tier:Tier){return createBicepContext({id:ids.network,extensionId:ids.extension,workspaceId:basis.extension.workspaceId,sourceScanId:basis.extension.sourceScanId,tier,kind:'bicep',createdAt:'2026-11-12T12:00:01.000Z'},basis);}
function prepared(referenceId:string,tier:Tier,extra?:string,change?:(f:ReturnType<typeof fixture>)=>void){
 const f=fixture();f.raw.plans=tiers.map(t=>referencePlan(referenceId,t));
 if(extra){const p=f.raw.plans[0];p.newItems=[{componentId:extra,quantity:1,instanceCount:1}];p.subnetProposals=[];delete p.deploymentBindings;
  if(extra.startsWith('postgres-flex-'))p.newItems.push({componentId:'postgres-flex-storage',quantity:32,instanceCount:1});
 }
 change?.(f);
 const result=processExtensionOutput(f.raw,f.context,{id:ids.extension,createdAt:'2026-11-12T12:00:00.000Z'});if(!result.ok)throw Error(JSON.stringify(result));
 const basis={extension:result.value,catalogData:{catalog:f.context.catalog,support:f.context.support},inventory:f.context.inventory};
 const context=createBicepContext({id:ids.network,extensionId:ids.extension,workspaceId:basis.extension.workspaceId,sourceScanId:basis.extension.sourceScanId,tier,kind:'bicep',createdAt:'2026-11-12T12:00:01.000Z'},basis);
 return {context,bound:bindBicepSource(context.payload.source,context),basis};
}
it.skipIf(!executable).each(refs.flatMap(r=>tiers.map(t=>[r,t] as const)))('compiles actual processing of %s/%s through exact source and ARM',async(reference,tier)=>{
 const {context,bound}=prepared(reference,tier);
 const fresh=bound.program.resources.filter(r=>!r.existing),count=(type:string)=>fresh.filter(r=>r.type.split('@')[0]===type).length;
 expect(fresh.every(r=>r.guarded===(bound.program.zoneInputGuard?'deploymentEnabled':true))).toBe(true);
 expect(await createExtensionArtifactCompiler({executable}).compile(bound.code,context)).toMatchObject({policyVersion:'extend-bicep-source-arm-v1'});
 if(reference==='container-apps-web-api'){
  expect(count('Microsoft.App/managedEnvironments')).toBe(1);expect(count('Microsoft.App/containerApps')).toBe(1);
  const app=fresh.find(r=>r.type.startsWith('Microsoft.App/containerApps@'))!;
  const template=obj(obj(app.body.properties.properties).template),container=obj((template.containers as unknown[])[0]);
  expect(obj(container.resources).cpu).toEqual({kind:'container-cpu',value:0.25});expect(obj(container.resources).memory).toBe('0.5Gi');
  expect(obj(template.scale).minReplicas).toBe(tier==='ha'?3:tier==='balanced'?2:1);
 }
 if(reference==='serverless-static-web-app'){
  expect(count('Microsoft.Web/serverfarms')).toBe(1);expect(count('Microsoft.Web/sites')).toBe(1);
  expect(count('Microsoft.Web/staticSites/linkedBackends')).toBe(1);expect(count('Microsoft.Storage/storageAccounts')).toBe(1);
  expect(bound.code).toContain('param functionStorageConnection string');expect(bound.code).not.toContain('listKeys');
  expect(bound.code).toContain('param staticWebAppLocation string');expect(bound.code).not.toContain("location: 'eastus2'");
 }
 if(reference==='app-service-zone-redundant'){
  expect(count('Microsoft.Network/applicationGateways')).toBe(1);expect(count('Microsoft.Network/publicIPAddresses')).toBe(1);
  const gateway=fresh.find(r=>r.type.startsWith('Microsoft.Network/applicationGateways@'))!;
  expect(obj(obj(gateway.body.properties.properties).sku).capacity).toBe(tier==='ha'?3:tier==='balanced'?2:1);
  expect(bound.code).not.toContain('azurewebsites.net');expect(bound.code).toContain('!.properties.defaultHostName');
 }
 // Whole model and bound AST equality also covers children, roles and guard tampering.
 const ast=parseExtendBicep(context.payload.source);ast.resources.find(r=>!r.existing)!.guarded=undefined;
 expect(()=>bindBicepSource(emitExtendBicep(ast),context)).toThrow();
},30000);
const extra=['app-service-linux-b2','app-service-linux-p2v3','postgres-flex-b2s','postgres-flex-gp-4vcore','static-web-apps-free','managed-redis-b0','managed-redis-b1','cosmos-db-serverless-ru','front-door-standard-base'];
it.skipIf(!executable).each(extra)('compiles the additionally offered %s with exact host count and ARM',async id=>{
 const {context,bound}=prepared('app-service-basic-web-app','low',id);
 expect(await createExtensionArtifactCompiler({executable}).compile(bound.code,context)).toMatchObject({policyVersion:'extend-bicep-source-arm-v1'});
 if(id.startsWith('managed-redis'))expect(bound.program.resources.filter(r=>r.type.startsWith('Microsoft.Cache/redisEnterprise/databases@'))).toHaveLength(1);
 if(id==='front-door-standard-base')expect(bound.program.resources.every(r=>r.body.properties.location==='global')).toBe(true);
},30000);
it('covers every currently offered component rather than silently narrowing the catalog',()=>{
 const f=fixture();const covered=new Set([...refs.flatMap(r=>tiers.flatMap(t=>referencePlan(r,t).newItems.map(i=>i.componentId))),...extra]);
 expect(f.context.catalog.components.filter(c=>!covered.has(c.id)).map(c=>c.id)).toEqual([]);
 expect(covered.size).toBe(f.context.catalog.components.length);
});
it.each(['functions-consumption-executions','functions-dedicated-p1v3','static-web-apps-standard','blob-hot-lrs'] as const)('rejects pinned %s facts inconsistent with its reviewed meter and location basis',id=>{
 const tier=id==='functions-dedicated-p1v3'?'ha':'low';
 for(const attack of ['sku','location'] as const){
  const {basis}=prepared(id==='blob-hot-lrs'?'app-service-basic-web-app':'serverless-static-web-app',id==='blob-hot-lrs'?'balanced':tier);
  const component=basis.catalogData.catalog.components.find(c=>c.id===id)!;
  if(attack==='location')component.extensionDeployment!.locationBasis='global';
  else Object.assign(component.extensionDeployment!,{skuName:id==='functions-dedicated-p1v3'?'Y1':id.startsWith('functions-')?'P1v3':id==='blob-hot-lrs'?'Standard_ZRS':'Free'});
  Object.assign(basis.extension,getExtensionCoreVersions(basis.catalogData.catalog,basis.catalogData.support));
  expect(()=>contextFor(basis,id==='blob-hot-lrs'?'balanced':tier)).toThrow();
 }
});
it.each([
 ['container-apps-web-api','memory-count'],['container-apps-web-api','missing-meter'],['container-apps-web-api','invalid-profile'],
 ['app-service-zone-redundant','gateway-count'],['app-service-zone-redundant','missing-backend'],['app-service-zone-redundant','missing-binding'],
 ['serverless-static-web-app','function-count'],['serverless-static-web-app','missing-storage'],
] as const)('preflights inconsistent %s/%s without emitting partial resources', (reference,attack)=>{
 const {basis}=prepared(reference,'low'),plan=basis.extension.plans[0];
 if(attack==='memory-count')plan.newItems.find(i=>i.componentId==='container-apps-memory')!.instanceCount=2;
 if(attack==='missing-meter')plan.newItems=plan.newItems.filter(i=>i.componentId!=='container-apps-requests');
 if(attack==='invalid-profile')plan.newItems.find(i=>i.componentId==='container-apps-memory')!.quantity=3;
 if(attack==='gateway-count')plan.newItems.find(i=>i.componentId==='application-gateway-v2-capacity')!.instanceCount=2;
 if(attack==='missing-backend')plan.newItems=plan.newItems.filter(i=>!i.componentId.startsWith('app-service-linux-'));
 if(attack==='missing-binding')delete plan.deploymentBindings;
 if(attack==='function-count')plan.newItems.find(i=>i.componentId==='functions-consumption-duration')!.instanceCount=2;
 if(attack==='missing-storage')plan.newItems=plan.newItems.filter(i=>!i.componentId.startsWith('blob-hot-'));
 // Keep structural saved-cost/check membership coherent so this reaches the
 // deployment validator rather than failing the unrelated result envelope.
 plan.incrementalCost={state:'unavailable',reason:'price-unavailable'};
 plan.checks=[{kind:'capacity',verdict:'unknown',reasonCodes:['capacity-unverified'],resourceIds:[],componentIds:[],evidence:[]}];
 expect(()=>contextFor(basis,'low')).toThrow(/bicep:0:/);
});
it('requires no zones, images, location or secret inputs for an incremental vault-only or usage-only HA option',()=>{
 const {context,bound}=prepared('app-service-zone-redundant','ha',undefined,f=>{
  const plan=f.raw.plans[2];plan.newItems=[{componentId:'key-vault-operations',quantity:10,instanceCount:1}];plan.subnetProposals=[];delete plan.deploymentBindings;
 });
 expect(bound.parameters).toEqual([]);expect(bound.program.zoneInputGuard).toBeUndefined();
 expect(bound.program.resources.filter(r=>!r.existing)).toHaveLength(1);
 expect(context.payload.source).not.toContain('deploymentZones');
 const usage=prepared('app-service-zone-redundant','ha',undefined,f=>{
  const vault=f.context.inventory.resources.find(r=>r.type==='microsoft.keyvault/vaults')!;
  const alias=[...f.context.model.aliasToResourceId].find(([,id])=>id===vault.id)![0];
  const plan=f.raw.plans[2];plan.newItems=[];plan.subnetProposals=[];delete plan.deploymentBindings;
  plan.reusedResources=[{componentId:'key-vault-operations',resourceId:alias,reason:{en:'Reuse the saved resource',ko:'저장된 리소스를 재사용합니다.'}}];
  plan.usageIncreases=[{componentId:'key-vault-operations',resourceId:alias,quantity:10}];
 });
 expect(usage.bound.parameters).toEqual([]);expect(usage.bound.program.resources.every(r=>r.existing)).toBe(true);
});
it.skipIf(!executable)('uses host counts rather than GB, RU, operations or ingestion units across multiple metered roots and children',async()=>{
 const {context,bound}=prepared('app-service-basic-web-app','low',undefined,f=>{
  const p=f.raw.plans[0];p.newItems=[{componentId:'blob-hot-lrs',quantity:100,instanceCount:2},{componentId:'cosmos-db-serverless-ru',quantity:50,instanceCount:3},
   {componentId:'key-vault-operations',quantity:100,instanceCount:2},{componentId:'log-analytics-ingestion',quantity:25,instanceCount:1}];p.subnetProposals=[];
 });
 const count=(type:string)=>bound.program.resources.filter(r=>!r.existing&&r.type.split('@')[0]===type).length;
 expect(count('Microsoft.Storage/storageAccounts')).toBe(2);expect(count('Microsoft.Storage/storageAccounts/blobServices')).toBe(2);
 expect(count('Microsoft.DocumentDB/databaseAccounts')).toBe(3);expect(count('Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers')).toBe(3);
 expect(count('Microsoft.KeyVault/vaults')).toBe(2);expect(count('Microsoft.OperationalInsights/workspaces')).toBe(1);
 expect(await createExtensionArtifactCompiler({executable}).compile(bound.code,context)).toMatchObject({policyVersion:'extend-bicep-source-arm-v1'});
},30000);
it.skipIf(!executable).each(['app-service-zone-redundant','container-apps-web-api'])('honors conservative %s existing subnet eligibility and exact immutable ancestors',async reference=>{
 const f=fixture(),inventory=structuredClone(f.context.inventory),parent=inventory.resources[0];
 const delegation=reference==='container-apps-web-api'?[{name:'container-environment',properties:{serviceName:'Microsoft.App/environments'}}]:[];
 const subnet={...structuredClone(parent),id:parent.id+'/subnets/bound-subnet',name:'sample-vnet/bound-subnet',type:'microsoft.network/virtualnetworks/subnets',parentId:parent.id,
  properties:{addressPrefixes:['10.1.2.0/24'],delegations:delegation,ipConfigurations:[],applicationGatewayIPConfigurations:[],privateEndpoints:[],serviceAssociationLinks:[]}};
 inventory.resources.push(subnet);
 const scan={...f.context.scan,summary:summarizeInventory(inventory.resources,[])};
 f.context=createExtensionRequestContext(f.context.input,scan,inventory,f.context.catalog,{support:f.context.support});
 f.raw.plans=tiers.map(t=>referencePlan(reference,t));
 const plan=f.raw.plans[2],alias=[...f.context.model.aliasToResourceId].find(([,id])=>id===subnet.id)![0];
 plan.newItems=plan.newItems.filter(i=>!['virtual-network','virtual-network-subnet'].includes(i.componentId));plan.subnetProposals=[];
 plan.reusedResources=[{componentId:'virtual-network-subnet',resourceId:alias,reason:{en:'Reuse the selected subnet',ko:'선택한 서브넷을 재사용합니다.'}}];
 plan.deploymentBindings=[{role:reference==='container-apps-web-api'?'container-environment-subnet':'gateway-subnet',target:{kind:'reused-subnet',resourceId:alias}}];
 const result=processExtensionOutput(f.raw,f.context,{id:ids.extension,createdAt:'2026-11-12T12:00:00.000Z'});
 if(reference==='container-apps-web-api'){
  // Generic pinned reuse policy deliberately accepts empty delegation only.
  // The reference matrix above proves the supported NEW delegated subnet path.
  expect(result).toEqual({ok:false,errors:['plans.2.reusedResources.0: reuse-not-eligible']});return;
 }
 if(!result.ok)throw Error(JSON.stringify(result));
 const basis={extension:result.value,catalogData:{catalog:f.context.catalog,support:f.context.support},inventory};
 const context=contextFor(basis,'ha'),bound=bindBicepSource(context.payload.source,context);
 expect(context.payload.source).not.toContain('bound-subnet');expect(context.payload.source).not.toContain('10.1.2.0/24');
 expect(bound.program.resources.filter(r=>r.existing)).toHaveLength(2);
 expect(bound.program.resources.filter(r=>!r.existing&&r.type.startsWith('Microsoft.Network/virtualNetworks'))).toHaveLength(0);
 expect(bound.code).toContain("name: 'bound-subnet'");expect(bound.existingResourceIds).toEqual([subnet.id]);
 expect(await createExtensionArtifactCompiler({executable}).compile(bound.code,context)).toMatchObject({policyVersion:'extend-bicep-source-arm-v1'});
},30000);
