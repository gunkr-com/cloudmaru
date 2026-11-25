import 'server-only';
import { getPostgresDeploymentMapping,getComponentBicepDeployment,getExtensionDeploymentIntent } from '@/lib/catalog/extension-deployment';
import {validateExtensionDeploymentPlan} from '@/lib/extend/deployment-validation';
import { createArtifactTextContext } from './guide-evaluation';
import { validateArtifactMembers } from './storage-validation';
import { isCanonicalArmResourceId } from '@/lib/inventory/normalize';
import { ExtendBicepError, emitExtendBicep, parseExtendBicep } from './bicep-source';
import type { ArtifactBinding, ArtifactStorageContext } from './storage-validation';
import type { BicepObject, BicepProgram, BicepValue, BicepParameter } from './bicep-source';
import type {Component} from '@/types/catalog';

export const BICEP_SEMANTIC_POLICY = 'extend-bicep-closed-source-v1';
const fail = (code: string): never => { throw new ExtendBicepError(code); };
const object = (properties: Record<string,BicepValue>): BicepObject => ({kind:'object',properties});
const ref = (symbol: string, property?: 'id'|'name'): BicepValue => ({kind:'reference',symbol,...(property?{property}:{})});
// Reviewed retail identities. A usage quantity never supplies a host count.
const meters:Record<string,[string,string,string,string,number]>={
 'blob-hot-lrs':['General Block Blob v2','Hot LRS','Hot LRS Data Stored','1 GB/Month',1],
 'blob-hot-zrs':['General Block Blob v2','Hot ZRS','Hot ZRS Data Stored','1 GB/Month',1],
 'container-apps-vcpu':['Azure Container Apps','Standard','Standard vCPU Active Usage','1 Second',2628000],
 'container-apps-memory':['Azure Container Apps','Standard','Standard Memory Active Usage','1 GiB Second',2628000],
 'container-apps-requests':['Azure Container Apps','Standard','Standard Requests','1M',1],
 'functions-consumption-executions':['Functions','Standard','Standard Total Executions','10',0.1],
 'functions-consumption-duration':['Functions','Standard','Standard Execution Time','1 GB Second',1],
 'functions-dedicated-p1v3':['Azure App Service Premium v3 Plan - Linux','P1 v3','P1 v3 App','1 Hour',730],
 'application-gateway-v2-fixed':['Application Gateway Standard v2','Standard','Standard Fixed Cost','1/Hour',730],
 'application-gateway-v2-capacity':['Application Gateway Standard v2','Standard','Standard Capacity Units','1/Hour',730],
 'static-web-apps-standard':['Static Web Apps','Standard','Standard App','1/Month',1],
 'managed-redis-b0':['Azure Managed Redis - Balanced','B0','B0 Cache Instance','1 Hour',730],
 'managed-redis-b1':['Azure Managed Redis - Balanced','B1','B1 Cache Instance','1 Hour',730],
 'cosmos-db-serverless-ru':['Azure Cosmos DB serverless','RUs','1M RUs','1M',1],
 'front-door-standard-base':['Azure Front Door','Standard','Standard Base Fees','1/Month',1],
};
function reviewedMeter(c:Component){
 const expected=meters[c.id];if(!expected)return;
 if(c.pricing.kind!=='metered'||canonical([c.pricing.productName,c.pricing.skuName,c.pricing.meterName,c.pricing.unitOfMeasure,c.pricing.meterUnitsPerQuantity])!==canonical(expected))fail('catalog-sku-billing-basis-mismatch');
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return '['+value.map(canonical).join(',')+']';
  if (value !== null && typeof value === 'object') return '{'+Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>JSON.stringify(k)+':'+canonical(v)).join(',')+'}';
  return JSON.stringify(value);
}
function normalized(program: BicepProgram) {
  return {deploymentTarget:program.deploymentTarget,targetOutput:program.targetOutput,zoneInputGuard:program.zoneInputGuard,parameters:[...program.parameters].sort((a,b)=>a.name.localeCompare(b.name)),resources:[...program.resources].sort((a,b)=>a.symbol.localeCompare(b.symbol))};
}
const sameProgram = (a:BicepProgram,b:BicepProgram) => canonical(normalized(a))===canonical(normalized(b));
function freeze<T>(v:T):T { if(v!==null&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v; }
export type BicepContext = {readonly payload: {schemaVersion:1;source:string;usageAssumptions:{componentId:string;quantity:number;kind:'new'|'usage-increase';resourceAlias?:string}[];freeGrantAssumption:'unverified-shared-free-grants-not-deducted'}};
type PostgresMapping = Omit<Extract<NonNullable<ReturnType<typeof getPostgresDeploymentMapping>>,{kind:'postgres-flex-compute'}>,'highAvailabilityMode'>
 & {highAvailabilityMode:'Disabled'|'ZoneRedundant';storageType:string;billingInstancesPerRoot:1|2;logicalServerCount:number;physicalInstanceCount:number};
type Private = {postgresMappings:PostgresMapping[];binding: ArtifactBinding; basis:ArtifactStorageContext; model:BicepProgram; bound:BicepProgram};
const privateContexts = new WeakMap<BicepContext,Private>();
const state = (c:BicepContext) => privateContexts.get(c)??fail('untrusted-context');

/** 저장 안에서 닫힌 소스 계약을 만든다. 이름·주소·scope 원문은 공개 payload에 넣지 않는다. */
export function createBicepContext(binding:ArtifactBinding & {kind:'bicep'}, input:ArtifactStorageContext):BicepContext {
  const basis=structuredClone(input); const b=structuredClone(binding);
  // 저장 사본·소속·스캔·선택 membership 투영을 재사용하고 현재 엔진은 재실행하지 않는다.
  createArtifactTextContext({...b,kind:'guide'},basis);
  if(binding.kind!=='bicep') fail('bicep-kind-required');
  const plan=basis.extension.plans.find(p=>p.tier===b.tier)??fail('selected-option-required');
  const intent=getExtensionDeploymentIntent(basis.catalogData.catalog,plan.referenceArchitectureId,b.tier)??fail('deployment-intent-required');
  for(const item of plan.newItems){
    const component=basis.catalogData.catalog.components.find(c=>c.id===item.componentId)??fail('component-not-in-pinned-catalog');
    if(!getComponentBicepDeployment(component))fail(`newItems.${item.componentId}: component-deployment-mapping-required`);
    reviewedMeter(component);
  }
  const deploymentErrors=validateExtensionDeploymentPlan(plan,{catalog:basis.catalogData.catalog,resources:basis.inventory.resources,region:basis.extension.input.region});
  if(deploymentErrors.length)fail(deploymentErrors[0]);
  const region=basis.extension.input.region;
  const postgresMappings:PostgresMapping[]=[];
  const model:BicepProgram={parameters:[],resources:[]}; const bound:BicepProgram={parameters:[],resources:[]};
  const byId=new Map(basis.inventory.resources.map(r=>[r.id,r]));
  if(byId.size!==basis.inventory.resources.length) fail('duplicate-source-identity');
  // 미선택 부모를 포함한 저장 인벤토리 전체의 정렬 순위로 별칭을 고정한다.
  const allIds=[...byId.keys()].sort();
  const alias=(id:string)=>'r'+String(allIds.indexOf(id)+1).padStart(6,'0');
  const selected=new Set(plan.reusedResources.map(r=>r.resourceId)); const existingSymbols=new Map<string,string>();
  const knownNames=new Set(basis.inventory.resources.flatMap(r=>[r.name.toLowerCase().split('/').at(-1)!,r.id.split('/').at(-1)!]));
  const newNames=new Set<string>();
  const name=(symbol:string)=>{
    const value=`cs${b.id.replaceAll('-','').slice(0,16)}${symbol}`.toLowerCase();
    if(knownNames.has(value)||newNames.has(value)) fail('new-name-collides-with-source'); newNames.add(value); return value;
  };
  const add=(symbol:string,type:string,existing:boolean,modelProps:Record<string,BicepValue>,boundProps:Record<string,BicepValue>)=>{
    if(model.resources.some(r=>r.symbol===symbol)||model.resources.length>=200) fail('resource-limit-or-duplicate');
    model.resources.push({symbol,type,existing,body:object(modelProps)}); bound.resources.push({symbol,type,existing,body:object(boundProps)});
  };
  function existing(id:string):string {
    const prior=existingSymbols.get(id); if(prior)return prior;
    const r=byId.get(id)??fail('existing-ancestor-not-in-scan');
    if(!isCanonicalArmResourceId(id)) fail('source-identity-invalid');
    const segments=id.split('/');
    // extension provider scope에는 별도의 검토된 바인딩 계약이 필요하다.
    if(segments.length<9||segments[1]!=='subscriptions'||segments[3]!=='resourcegroups'||segments[5]!=='providers'||segments.slice(6).includes('providers')) fail('source-scope-not-supported');
    const namespace=segments[6]; const parts=segments.slice(7); if(parts.length%2!==0) fail('source-identity-invalid');
    const expectedType=[namespace,...parts.filter((_,i)=>i%2===0)].join('/'); const leaf=parts.at(-1)!;
    if(r.type!==expectedType||r.subscriptionId!==segments[2]||r.resourceGroup.toLowerCase()!==segments[4]
      ||![leaf,parts.filter((_,i)=>i%2===1).join('/')].includes(r.name.toLowerCase())) fail('source-type-name-scope-mismatch');
    const symbol=selected.has(id)?alias(id):'a'+String(allIds.indexOf(id)+1).padStart(6,'0');
    existingSymbols.set(id,symbol);
    const parentId=parts.length>2?segments.slice(0,-2).join('/'):null;
    if(r.parentId!==parentId) fail('source-parent-mismatch');
    const parent=parentId?existing(parentId):null;
    const component=basis.catalogData.catalog.components.find(c=>c.bicepResourceTypes.some(t=>t.toLowerCase()===r.type));
    const versions:Record<string,string>={'microsoft.network/virtualnetworks':'2024-05-01','microsoft.network/virtualnetworks/subnets':'2024-05-01','microsoft.web/serverfarms':'2024-04-01','microsoft.keyvault/vaults':'2023-07-01','microsoft.operationalinsights/workspaces':'2023-09-01'};
    const version=versions[r.type]??fail('existing-type-binding-contract-required');
    const type=(component?.bicepResourceTypes.find(t=>t.toLowerCase()===r.type)??fail('existing-type-not-in-pinned-catalog'))+'@'+version;
    const savedName=r.name.split('/').at(-1)!;
    add(symbol,type,true,{name:symbol,...(parent?{parent:ref(parent)}:{scope:'scope_'+symbol})},
      {name:savedName,...(parent?{parent:ref(parent)}:{scope:{kind:'call',name:'resourceGroup',arguments:[segments[2],r.resourceGroup]}})});
    return symbol;
  }
  for(const r of [...plan.reusedResources].sort((a,b)=>a.resourceId<b.resourceId?-1:1))existing(r.resourceId);
  const components=basis.catalogData.catalog.components;
  const quantities=new Map(plan.newItems.map(i=>[i.componentId,i.quantity]));
  let sequence=0;
  const next=()=>`n${String(++sequence).padStart(4,'0')}`;
  const deployed=new Map<string,string[]>();
  const addNew=(componentId:string,type:string,properties:Record<string,BicepValue>,boundProperties=properties,symbol=next(),fixedName?:string)=>{
    const c=components.find(c=>c.id===componentId)??fail('component-not-in-pinned-catalog');
    if(!c.bicepResourceTypes.includes(type.split('@')[0]))fail('component-type-not-approved');
    const actualName=fixedName??name(symbol);
    add(symbol,type,false,{name:fixedName??symbol,...properties},{name:actualName,...boundProperties});
    deployed.set(componentId,[...(deployed.get(componentId)??[]),symbol]);return symbol;
  };
  const parameter=(p:BicepParameter)=>{for(const program of [model,bound])if(!program.parameters.some(v=>v.name===p.name))program.parameters.push(p);};
  const zones=()=>{parameter({name:'deploymentZones',type:'array',minLength:2,maxLength:3,allowed:['1','2','3']});model.zoneInputGuard=true;bound.zoneInputGuard=true;return ref('deploymentZones');};
  const hosts=(componentId:string,type:string)=>(deployed.get(componentId)??[]).filter(symbol=>model.resources.find(r=>r.symbol===symbol)!.type.split('@')[0]===type);
  const boundBinding=(role:'function-storage'|'static-backend'|'gateway-backend'|'gateway-public-ip',type:string)=>{
    const binding=intent.bindings.find(b=>b.role===role)??fail(`${role}-binding-required`);
    const symbols=hosts(binding.toComponentId,type);if(!symbols.length)fail(`${role}-binding-required`);return symbols;
  };
  const quantity=(id:string)=>{const n=quantities.get(id)??fail('missing-selected-component');if(!Number.isSafeInteger(n)||n<1||n>1000)fail('resource-quantity-not-supported');return n;};
  // v1의 명시적 네트워크 제안으로 identity·개수·주소를 결합한다. 설명에서 추측하지 않는다.
  const newParents=new Map<string,string>(),subnets=new Map<string,string>();
  for(const s of plan.subnetProposals){
    let parent:string;
    if(s.region!==region)fail('proposed-region-mismatch');
    if(s.parent.kind==='existing')parent=existingSymbols.get(s.parent.resourceId)??fail('subnet-parent-not-selected');
    else {
      parent=newParents.get(s.parent.id)??'';
      if(!parent){
        const p=s.parent; const symbol=next();
        parent=addNew(p.componentId,'Microsoft.Network/virtualNetworks@2024-05-01',
          {location:region,properties:object({addressSpace:object({addressPrefixes:p.addressPrefixes.map((_,j)=>`cidr_${symbol}_${j}`)})})},
          {location:region,properties:object({addressSpace:object({addressPrefixes:p.addressPrefixes})})},symbol);
        newParents.set(p.id,parent);
      }
    }
    const symbol=next();
    const delegation:Record<string,BicepValue>=s.delegation?{delegations:[object({name:'container-environment',properties:object({serviceName:s.delegation})})]}:{};
    subnets.set(s.id,addNew(s.componentId,'Microsoft.Network/virtualNetworks/subnets@2024-05-01',
      {parent:ref(parent),properties:object({addressPrefixes:s.addressPrefixes.map((_,j)=>`cidr_${symbol}_${j}`),...delegation})},
      {parent:ref(parent),properties:object({addressPrefixes:s.addressPrefixes,...delegation})},symbol));
  }
  if(quantities.has('virtual-network')&&quantity('virtual-network')!==newParents.size)fail('vnet-proposal-count-mismatch');
  if(quantities.has('virtual-network-subnet')&&quantity('virtual-network-subnet')!==plan.subnetProposals.length)fail('subnet-proposal-count-mismatch');
  const subnetFor=(role:'gateway-subnet'|'container-environment-subnet')=>{
    const target=plan.deploymentBindings?.find(b=>b.role===role)?.target??fail('required-subnet-binding-missing');
    const symbol=(target.kind==='new-subnet'?subnets.get(target.subnetProposalId):existingSymbols.get(target.resourceId))??fail('selected-subnet-binding-required');
    return ref(symbol,'id');
  };
  // 정확한 승인 호스트 하나에 웹앱/telemetry 하나만 붙이고 별도 과금 호스트는 만들지 않는다.
  for(const r of plan.reusedResources){
    const host=existingSymbols.get(r.resourceId)!;
    if(r.componentId.startsWith('app-service-linux-'))addNew(r.componentId,'Microsoft.Web/sites@2024-04-01',
      {location:region,kind:'app,linux',properties:object({serverFarmId:ref(host,'id'),httpsOnly:true})});
    if(r.componentId==='log-analytics-ingestion')addNew(r.componentId,'Microsoft.Insights/components@2020-02-02',
      {location:region,kind:'web',properties:object({Application_Type:'web',WorkspaceResourceId:ref(host,'id')})});
  }
  const handled=new Set<string>();
  const usage:BicepContext['payload']['usageAssumptions']=[];
  for(const i of plan.usageIncreases)usage.push({componentId:i.componentId,quantity:i.quantity,kind:'usage-increase',resourceAlias:alias(i.resourceId)});
  for(const i of plan.newItems)if(components.find(c=>c.id===i.componentId)?.usage)usage.push({componentId:i.componentId,quantity:i.quantity,kind:'new'});
  // Explicit bindings are resolved in topological order; request/model order has no semantics.
  const priority=(id:string)=>{const kind=components.find(c=>c.id===id)?.extensionDeployment?.kind;return kind==='blob-storage'?0:kind==='functions'?2:kind==='static-web-app'?3:kind==='application-gateway'?4:1;};
  for(const i of [...plan.newItems].sort((a,b)=>priority(a.componentId)-priority(b.componentId))){
    const c=components.find(c=>c.id===i.componentId)??fail('component-not-in-pinned-catalog');
    if(handled.has(i.componentId))continue;
    if(c.id==='internet-egress'){handled.add(c.id);continue;}
    if(c.id==='virtual-network'||c.id==='virtual-network-subnet')continue;
    const deployment=getComponentBicepDeployment(c)!;
    if(deployment.kind==='blob-storage'){
      if(deployment.skuName!==(c.id==='blob-hot-lrs'?'Standard_LRS':'Standard_ZRS'))fail('catalog-sku-billing-basis-mismatch');
      const count=i.instanceCount??fail('deployment-count-required');
      for(let j=0;j<count;j++){
        const account=addNew(c.id,'Microsoft.Storage/storageAccounts@2023-05-01',{location:region,kind:deployment.accountKind,sku:object({name:deployment.skuName}),properties:object({accessTier:deployment.accessTier,minimumTlsVersion:'TLS1_2',supportsHttpsTrafficOnly:true,allowBlobPublicAccess:false})});
        const blob=addNew(c.id,'Microsoft.Storage/storageAccounts/blobServices@2023-05-01',{parent:ref(account),properties:object({})},undefined,next(),'default');
        addNew(c.id,'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01',{parent:ref(blob),properties:object({publicAccess:'None'})});
      }
      handled.add(c.id);continue;
    }
    if(deployment.kind==='functions'){
      const topology=intent.functions??fail('functions-hosting-intent-required');
      const members=plan.newItems.filter(item=>components.find(c=>c.id===item.componentId)?.extensionDeployment?.kind==='functions');
      const count=i.instanceCount??fail('deployment-count-required');
      boundBinding('function-storage','Microsoft.Storage/storageAccounts');
      parameter({name:'functionStorageConnection',secure:true});
      const host=addNew(c.id,'Microsoft.Web/serverfarms@2024-04-01',{location:region,kind:'linux',sku:object({name:deployment.skuName,tier:deployment.skuTier,...(topology.hosting==='Dedicated'?{capacity:count}:{})}),properties:object({reserved:true,...(topology.hosting==='Dedicated'?{zoneRedundant:topology.zoneRedundant}:{})})});
      addNew(c.id,'Microsoft.Web/sites@2024-04-01',{location:region,kind:'functionapp,linux',properties:object({serverFarmId:ref(host,'id'),httpsOnly:true,siteConfig:object({linuxFxVersion:'NODE|22',alwaysOn:topology.hosting==='Dedicated',appSettings:[object({name:'AzureWebJobsStorage',value:ref('functionStorageConnection')}),object({name:'FUNCTIONS_EXTENSION_VERSION',value:'~4'}),object({name:'FUNCTIONS_WORKER_RUNTIME',value:'node'})]})})});
      for(const m of members)handled.add(m.componentId);continue;
    }
    if(deployment.kind==='static-web-app'){
      if(c.id==='static-web-apps-free'&&c.pricing.kind!=='free')fail('catalog-sku-billing-basis-mismatch');
      parameter({name:'staticWebAppLocation',type:'string',minLength:1,maxLength:80});
      const count=i.instanceCount??fail('deployment-count-required');
      for(let j=0;j<count;j++){
        const site=addNew(c.id,'Microsoft.Web/staticSites@2023-12-01',{location:ref('staticWebAppLocation'),sku:object({name:deployment.skuName,tier:deployment.skuTier}),properties:object({})});
        if(intent.bindings.some(b=>b.role==='static-backend'&&b.fromComponentId===c.id)){
          if(!deployment.linkedBackendAllowed)fail('static-backend-not-in-pinned-mapping');
          const backend=boundBinding('static-backend','Microsoft.Web/sites');if(backend.length!==1)fail('static-backend-binding-required');
          addNew(c.id,'Microsoft.Web/staticSites/linkedBackends@2023-12-01',{parent:ref(site),properties:object({backendResourceId:ref(backend[0],'id'),region})});
        }
      }
      handled.add(c.id);continue;
    }
    if(deployment.kind==='container-apps'){
      const topology=intent.containerApps??fail('container-topology-required');
      const cpu=plan.newItems.find(i=>i.componentId==='container-apps-vcpu')??fail('container-coupled-meter-basis-required');
      const memory=plan.newItems.find(i=>i.componentId==='container-apps-memory')??fail('container-coupled-meter-basis-required');
      const count=cpu.instanceCount??fail('deployment-count-required');
      parameter({name:'containerImage',secure:true});parameter({name:'containerTargetPort',type:'int',minimum:1,maximum:65535});
      const environment=addNew(c.id,'Microsoft.App/managedEnvironments@2024-03-01',{location:region,properties:object({zoneRedundant:topology.zoneRedundant,appLogsConfiguration:object({destination:'none'}),workloadProfiles:[object({name:deployment.workloadProfileName,workloadProfileType:'Consumption'})],...(topology.subnetRequired?{vnetConfiguration:object({infrastructureSubnetId:subnetFor('container-environment-subnet'),internal:false})}:{})})});
      addNew(c.id,'Microsoft.App/containerApps@2024-03-01',{location:region,properties:object({managedEnvironmentId:ref(environment,'id'),workloadProfileName:deployment.workloadProfileName,configuration:object({activeRevisionsMode:'Single',ingress:object({external:true,targetPort:ref('containerTargetPort'),transport:'auto',allowInsecure:false})}),template:object({containers:[object({name:'workload',image:ref('containerImage'),resources:object({cpu:{kind:'container-cpu',value:cpu.quantity/count},memory:`${memory.quantity/count}Gi`})})],scale:object({minReplicas:count,maxReplicas:count})})})});
      for(const id of ['container-apps-vcpu','container-apps-memory','container-apps-requests'])handled.add(id);continue;
    }
    if(deployment.kind==='managed-redis'){
      if(deployment.skuName!==(c.id==='managed-redis-b0'?'Balanced_B0':'Balanced_B1'))fail('catalog-sku-billing-basis-mismatch');
      for(let j=0;j<quantity(c.id);j++){
        const cache=addNew(c.id,'Microsoft.Cache/redisEnterprise@2025-04-01',{location:region,sku:object({name:deployment.skuName}),properties:object({highAvailability:'Enabled',minimumTlsVersion:'1.2',encryption:object({})})});
        addNew(c.id,'Microsoft.Cache/redisEnterprise/databases@2025-04-01',{parent:ref(cache),properties:object({clientProtocol:'Encrypted',clusteringPolicy:'OSSCluster',evictionPolicy:'VolatileLRU',port:10000,modules:[]})},undefined,next(),'default');
      }
      handled.add(c.id);continue;
    }
    if(deployment.kind==='cosmos-serverless'){
      const count=i.instanceCount??fail('deployment-count-required');
      for(let j=0;j<count;j++){
        const account=addNew(c.id,'Microsoft.DocumentDB/databaseAccounts@2024-05-15',{location:region,kind:deployment.kindName,properties:object({databaseAccountOfferType:'Standard',capabilities:[object({name:deployment.capability})],locations:[object({locationName:region,failoverPriority:0,isZoneRedundant:false})],consistencyPolicy:object({defaultConsistencyLevel:'Session'}),disableLocalAuth:true})});
        const database=addNew(c.id,'Microsoft.DocumentDB/databaseAccounts/sqlDatabases@2024-05-15',{parent:ref(account),properties:object({resource:object({id:'workload'})})},undefined,next(),'workload');
        addNew(c.id,'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-05-15',{parent:ref(database),properties:object({resource:object({id:'items',partitionKey:object({paths:['/id'],kind:'Hash'})})})},undefined,next(),'items');
      }
      handled.add(c.id);continue;
    }
    if(deployment.kind==='front-door'){
      // A base profile buys the selected base meter; no unselected origin/route is invented.
      for(let j=0;j<quantity(c.id);j++)addNew(c.id,'Microsoft.Cdn/profiles@2024-02-01',{location:'global',sku:object({name:deployment.skuName}),properties:object({originResponseTimeoutSeconds:60})});
      handled.add(c.id);continue;
    }
    if(deployment.kind==='application-gateway'){
      const topology=intent.applicationGateway??fail('gateway-topology-required');
      const backend=boundBinding('gateway-backend','Microsoft.Web/sites');
      const ips=boundBinding('gateway-public-ip','Microsoft.Network/publicIPAddresses');if(ips.length!==1)fail('gateway-public-ip-binding-required');
      parameter({name:'gatewayCertificateData',secure:true});parameter({name:'gatewayCertificatePassword',secure:true});
      const gateway=addNew(c.id,'Microsoft.Network/applicationGateways@2024-05-01',{location:region,...(topology.zonesBasis==='deployment-input'?{zones:zones()}:{})});
      for(const program of [model,bound]){
        const r=program.resources.find(r=>r.symbol===gateway)!;
        const child=(type:string,childName:string):BicepValue=>({kind:'gateway-child-id',type:`Microsoft.Network/applicationGateways/${type}`,gatewayName:r.body.properties.name as string,childName});
        const hostname=(symbol:string):BicepValue=>({kind:'guarded-new-site-hostname',symbol,...(bound.zoneInputGuard?{guard:'deploymentEnabled' as const}:{})});
        r.body.properties.properties=object({
          sku:object({name:deployment.skuName,tier:deployment.skuTier,capacity:topology.minimumCapacity}),
          gatewayIPConfigurations:[object({name:'subnet',properties:object({subnet:object({id:subnetFor('gateway-subnet')})})})],
          frontendIPConfigurations:[object({name:'frontend',properties:object({publicIPAddress:object({id:ref(ips[0],'id')})})})],
          frontendPorts:[object({name:'https',properties:object({port:443})})],
          sslCertificates:[object({name:'certificate',properties:object({data:ref('gatewayCertificateData'),password:ref('gatewayCertificatePassword')})})],
          backendAddressPools:[object({name:'backend',properties:object({backendAddresses:backend.map(symbol=>object({fqdn:hostname(symbol)}))})})],
          backendHttpSettingsCollection:[object({name:'settings',properties:object({port:443,protocol:'Https',cookieBasedAffinity:'Disabled',pickHostNameFromBackendAddress:true,requestTimeout:30})})],
          httpListeners:[object({name:'listener',properties:object({frontendIPConfiguration:object({id:child('frontendIPConfigurations','frontend')}),frontendPort:object({id:child('frontendPorts','https')}),protocol:'Https',sslCertificate:object({id:child('sslCertificates','certificate')})})})],
          requestRoutingRules:[object({name:'routing',properties:object({ruleType:'Basic',priority:100,httpListener:object({id:child('httpListeners','listener')}),backendAddressPool:object({id:child('backendAddressPools','backend')}),backendHttpSettings:object({id:child('backendHttpSettingsCollection','settings')})})})],
        });
      }
      for(const id of ['application-gateway-v2-fixed','application-gateway-v2-capacity'])handled.add(id);continue;
    }
    if(/^app-service-linux-(?:b[12]|p[012]v3)$/.test(c.id)){
      const deployment=getComponentBicepDeployment(c);
      if(deployment?.kind!=='app-service-plan')return fail('component-deployment-mapping-required');
      const sku=deployment.skuName;
      // Retail Premium v3 names use both P0v3 and P1 v3/P2 v3 spellings.
      // Accept only those exact representations of this reviewed ARM SKU.
      const retailNames=[sku,sku.replace(/v3$/,' v3')];
      const retailMeters=retailNames.map(name=>sku.startsWith('B')?name:`${name} App`);
      if(c.pricing.kind!=='metered'||!retailNames.includes(c.pricing.skuName)||c.usage
        ||c.pricing.productName!==(sku.startsWith('B')?'Azure App Service Basic Plan - Linux':'Azure App Service Premium v3 Plan - Linux')
        ||!retailMeters.includes(c.pricing.meterName)||c.pricing.unitOfMeasure!=='1 Hour'||c.pricing.meterUnitsPerQuantity!==730)fail('catalog-sku-billing-basis-mismatch');
      const count=i.instanceCount??fail('deployment-count-required'),topology=intent.appService??fail('app-service-topology-required');
      if(count!==quantity(c.id)||count<topology.minimumCapacity)fail('instance-quantity-or-topology-mismatch');
      if(topology.zoneRedundant&&!deployment.supportsZoneRedundancy)fail('zone-redundancy-not-in-pinned-mapping');
      const host=addNew(c.id,'Microsoft.Web/serverfarms@2024-04-01',{location:region,kind:'linux',sku:object({name:sku,tier:deployment.skuTier,capacity:count}),properties:object({reserved:true,zoneRedundant:topology.zoneRedundant})});
      addNew(c.id,'Microsoft.Web/sites@2024-04-01',{location:region,kind:'app,linux',properties:object({serverFarmId:ref(host,'id'),httpsOnly:true})});
      handled.add(c.id);continue;
    }
    if(c.id==='public-ipv4-standard'){
      if(c.pricing.kind!=='metered'||c.pricing.skuName!=='Standard'||c.usage||c.pricing.productName!=='IP Addresses'
        ||c.pricing.meterName!=='Standard IPv4 Static Public IP'||c.pricing.unitOfMeasure!=='1 Hour'||c.pricing.meterUnitsPerQuantity!==730)fail('catalog-sku-billing-basis-mismatch');
      for(let j=0;j<quantity(c.id);j++)addNew(c.id,'Microsoft.Network/publicIPAddresses@2024-05-01',{location:region,sku:object({name:'Standard'}),...(intent.publicIp?.zonesBasis==='deployment-input'?{zones:zones()}:{}),properties:object({publicIPAllocationMethod:'Static',publicIPAddressVersion:'IPv4'})});
      handled.add(c.id);continue;
    }
    if(c.id==='key-vault-operations'||c.id==='log-analytics-ingestion'){
      const n=i.instanceCount??fail(`newItems.${c.id}: new-metered-host-identity-count-contract-required`);
      if(!Number.isSafeInteger(n)||!n||n<1||n>100)fail(`newItems.${c.id}: new-metered-host-identity-count-contract-required`);
      if(c.pricing.kind!=='metered')return fail('catalog-sku-billing-basis-mismatch');
      if(!c.usage||c.pricing.meterUnitsPerQuantity!==1)fail('catalog-sku-billing-basis-mismatch');
      if(c.id==='key-vault-operations'&&(c.pricing.productName!=='Key Vault'||c.pricing.skuName!=='Standard'||c.pricing.meterName!=='Operations'||c.pricing.unitOfMeasure!=='10K'))fail('catalog-sku-billing-basis-mismatch');
      if(c.id==='log-analytics-ingestion'&&(c.pricing.productName!=='Log Analytics'||c.pricing.skuName!=='Analytics Logs'||c.pricing.meterName!=='Analytics Logs Data Ingestion'||c.pricing.unitOfMeasure!=='1 GB'))fail('catalog-sku-billing-basis-mismatch');
      for(let j=0;j<n;j++){
        if(c.id==='key-vault-operations')addNew(c.id,'Microsoft.KeyVault/vaults@2023-07-01',{location:region,properties:object({tenantId:{kind:'tenant-id'},sku:object({family:'A',name:'standard'}),enableRbacAuthorization:true,enableSoftDelete:true,enablePurgeProtection:true})});
        else {const host=addNew(c.id,'Microsoft.OperationalInsights/workspaces@2023-09-01',{location:region,properties:object({sku:object({name:'PerGB2018'})})});
          addNew(c.id,'Microsoft.Insights/components@2020-02-02',{location:region,kind:'web',properties:object({Application_Type:'web',WorkspaceResourceId:ref(host,'id')})});}
      }
      handled.add(c.id);continue;
    }
    if(c.id==='postgres-flex-storage')continue;
    if(c.id.startsWith('postgres-flex-')){
      const mapping=getPostgresDeploymentMapping(c);
      if(!mapping||mapping.kind!=='postgres-flex-compute')return fail('postgres-pinned-deployment-mapping-required');
      const storage=plan.newItems.find(item=>item.componentId===mapping.storageComponentId)??fail('postgres-storage-basis-required');
      const storageComponent=components.find(item=>item.id===storage.componentId)??fail('postgres-storage-basis-required');
      const storageMapping=getPostgresDeploymentMapping(storageComponent);
      if(!storageMapping||storageMapping.kind!=='postgres-flex-storage')return fail('postgres-pinned-deployment-mapping-required');
      const count=i.instanceCount??fail('postgres-deployment-count-required');
      const perHost=storage.quantity/count;
      if(count!==quantity(c.id)||storage.instanceCount!==count||!storageMapping.storageSizesGB.includes(perHost))fail('postgres-storage-allocation-mismatch');
      const topology=intent.postgres;
      if(topology.highAvailabilityMode==='ZoneRedundant'&&(mapping.tier!=='GeneralPurpose'
        ||!mapping.allowedHighAvailabilityModes?.includes('ZoneRedundant')
        ||mapping.highAvailabilityBilling?.billingInstancesPerRoot!==topology.billingInstancesPerRoot))fail('postgres-ha-not-in-pinned-mapping');
      const logicalCount=count/topology.billingInstancesPerRoot;
      if(!Number.isSafeInteger(logicalCount)||logicalCount<1)fail('postgres-physical-logical-count-mismatch');
      if(!model.parameters.some(p=>p.name==='postgresPassword'))for(const program of [model,bound])program.parameters.push({name:'postgresPassword',secure:true});
      if(topology.highAvailabilityMode==='ZoneRedundant')zones();
      for(let j=0;j<logicalCount;j++)addNew(c.id,'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01',{location:region,
        sku:object({name:mapping.skuName,tier:mapping.tier}),properties:object({version:mapping.engineVersion,
          administratorLogin:'cloudsightAdmin',administratorLoginPassword:ref('postgresPassword'),
          storage:object({storageSizeGB:perHost,type:storageMapping.storageType}),
          ...(topology.highAvailabilityMode==='ZoneRedundant'?{availabilityZone:{kind:'deployment-zone',index:0} as BicepValue}:{}),
          highAvailability:object({mode:topology.highAvailabilityMode,...(topology.highAvailabilityMode==='ZoneRedundant'?{standbyAvailabilityZone:{kind:'deployment-zone',index:1} as BicepValue}:{})}),network:object({publicNetworkAccess:'Disabled'})})});
      postgresMappings.push({...mapping,highAvailabilityMode:topology.highAvailabilityMode,storageType:storageMapping.storageType,
        billingInstancesPerRoot:topology.billingInstancesPerRoot,logicalServerCount:logicalCount,physicalInstanceCount:count});
      handled.add(c.id);handled.add(storage.componentId);continue;
    }
    fail(`newItems.${c.id}: component-bicep-configuration-contract-required`);
  }
  // Only true ARM children inherit scope. Property links retain explicit saved cross-scope IDs.
  const requiredTargets = new Set(plan.subnetProposals.flatMap(s => s.parent.kind === 'existing' ? [s.parent.resourceId.split('/').slice(0,5).join('/')] : []));
  if (requiredTargets.size > 1) fail('single-deployment-target-conflict: existing child parents require different resource groups');
  const target = [...requiredTargets][0] ?? [...selected].sort()[0]?.split('/').slice(0,5).join('/')
    ?? allIds[0]?.split('/').slice(0,5).join('/');
  if (!target || !/^\/subscriptions\/[0-9a-f-]+\/resourcegroups\/[^/]+$/.test(target)) fail('saved-deployment-target-required');
  bound.deploymentTarget=target.toLowerCase(); model.deploymentTarget='deployment_target';
  bound.targetOutput=true; model.targetOutput=true;
  for (const program of [model,bound]) for (const r of program.resources) if (!r.existing) r.guarded=program.zoneInputGuard?'deploymentEnabled':true;
  for (const s of plan.subnetProposals) if (s.parent.kind === 'existing') {
    const symbol=existingSymbols.get(s.parent.resourceId)!;
    // Default scope is safe only under the exact target predicate on EVERY new declaration.
    delete bound.resources.find(r=>r.symbol===symbol)!.body.properties.scope;
    delete model.resources.find(r=>r.symbol===symbol)!.body.properties.scope;
  }
  const payload=freeze({schemaVersion:1 as const,source:emitExtendBicep(model),usageAssumptions:usage,
    freeGrantAssumption:'unverified-shared-free-grants-not-deducted' as const});
  const context=freeze({payload}); privateContexts.set(context,{binding:b,basis,model,bound,postgresMappings});return context;
}
export function buildBicepRequest(context:BicepContext){
  state(context);
  return {schemaName:'extension_bicep_source',system:'Return the supplied source contract verbatim in the code field. Symbols, scope and CIDR markers are private placeholders bound by the server. Do not invent names, addresses, resources, parameters, quantities, references, modules, functions or outputs. Meter quantities are usage assumptions, never resource counts. The server adds the unverified draft notice.',
    user:JSON.stringify(context.payload),jsonSchema:{type:'object',additionalProperties:false,required:['code'],properties:{code:{type:'string',minLength:1,maxLength:60000}}}};
}
export function bindBicepSource(source:string,context:BicepContext){
  const s=state(context);const program=parseExtendBicep(source);
  if(!sameProgram(program,s.model))fail('source-does-not-match-selected-contract');
  const code='// Unverified draft — Bicep code generated by CloudMaru.\n'+emitExtendBicep(s.bound);
  // 모델 주석·사용하지 않는 문자열은 바인딩 결과에 남기지 않는다.
  validateBoundBicep(code,context);
  const p=s.basis.extension.plans.find(p=>p.tier===s.binding.tier)!;
  return {code,unverifiedDraft:true as const,program:structuredClone(s.bound),existingResourceIds:p.reusedResources.map(r=>r.resourceId),newComponentIds:p.newItems.map(i=>i.componentId),deploymentTarget:s.bound.deploymentTarget!,postgresMappings:structuredClone(s.postgresMappings),parameters:s.bound.parameters.map(p=>({name:p.name})),usageAssumptions:structuredClone(context.payload.usageAssumptions),policyVersion:BICEP_SEMANTIC_POLICY};
}
/** 쓰기 전용 검사다. 컴파일러 단계는 이 정확한 프로그램의 컴파일과 ARM 대조도 수행해야 한다. */
export function validateBoundBicep(source:string,context:BicepContext):BicepProgram{
  const s=state(context);const program=parseExtendBicep(source);
  if(!sameProgram(program,s.bound))fail('bound-source-does-not-match-saved-identities-and-configuration');
  return program;
}
/** 외피·membership과 코드 계약을 검사한다. 컴파일 성공 증거를 만들지는 않는다. */
export function validateBicepArtifactSource(raw:unknown,context:BicepContext){
  const s=state(context);const artifact=validateArtifactMembers(raw,s.binding,s.basis);
  if(artifact.kind!=='bicep')fail('bicep-kind-required');
  if(artifact.kind==='bicep'){
    const p=s.basis.extension.plans.find(p=>p.tier===s.binding.tier)!;
    if(canonical([...artifact.content.existingResourceIds].sort())!==canonical(p.reusedResources.map(r=>r.resourceId).sort())
      ||canonical([...artifact.content.newComponentIds].sort())!==canonical(p.newItems.map(i=>i.componentId).sort())||canonical(artifact.content.parameters.map(p=>p.name).sort())!==canonical(s.bound.parameters.map(p=>p.name).sort()))fail('artifact-identity-or-parameter-list-mismatch');
    validateBoundBicep(artifact.content.code,context);
  }
  return artifact;
}
