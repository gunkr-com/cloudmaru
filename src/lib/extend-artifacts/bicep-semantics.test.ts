// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { processedFixture, fixture } from '@/lib/extend/proposal.test-data';
import { createExtensionRequestContext } from '@/lib/extend/validate-proposal';
import { summarizeInventory } from '@/lib/inventory/summarize';
import { getExtensionCoreVersions, processExtensionOutput } from '@/lib/extend/process';
import { ids } from '@/lib/completion/fixtures.test-data';
import { createBicepContext, bindBicepSource, validateBoundBicep, buildBicepRequest, validateBicepArtifactSource } from './bicep-semantics';
import { parseExtendBicep, emitExtendBicep } from './bicep-source';
import type { BicepObject } from './bicep-source';

function basis(items: {componentId:string;quantity:number}[] = []) {
  const f = fixture();
  for (const p of f.raw.plans) p.newItems = [...p.newItems.filter(i => !i.componentId.startsWith('postgres-flex-')),...(p.tier==='low'?items:[]).map(i=>({...i,instanceCount:i.componentId==='internet-egress'?0:i.quantity}))];
  const result = processExtensionOutput(f.raw,f.context,{id:ids.extension,createdAt:'2026-11-12T12:00:00.000Z'});
  if (!result.ok) throw Error(JSON.stringify(result));
  return {extension: result.value,catalogData:{catalog:f.context.catalog,support:f.context.support},inventory:f.context.inventory};
}
const binding = {id:ids.network,extensionId:ids.extension,workspaceId:ids.workspace,sourceScanId:ids.scan,tier:'low' as const,kind:'bicep' as const,createdAt:'2026-11-12T12:00:01.000Z'};
function ctx(tier: 'low'|'ha' = 'low') { const b = basis(); return createBicepContext({...binding,workspaceId:b.extension.workspaceId,sourceScanId:b.extension.sourceScanId,tier},b); }
function mutate(fn: (ast: ReturnType<typeof parseExtendBicep>) => void) { const c = ctx(); const ast = parseExtendBicep(c.payload.source); fn(ast); return () => bindBicepSource(emitExtendBicep(ast),c); }
const obj = (v: unknown) => v as BicepObject;

describe('private alias source to exact saved Bicep identities', () => {
  it('binds selected existing identities, metered reuse and proposed subnet without leaking source to the model', () => {
    const c=ctx(); const request=buildBicepRequest(c); const payload=JSON.stringify(c);
    for(const v of ['/subscriptions/','sample-rg','sample-plan','sample-vnet','10.1.','aliasToResourceId',ids.workspace,ids.extension]) expect(payload+request.user).not.toContain(v);
    const out=bindBicepSource(c.payload.source,c);
    expect(out.code).toContain('// Unverified draft');
    expect(out.code).toContain("name: 'sample-plan'");
    expect(out.code).toContain("resourceGroup(");
    expect(out.code).toContain("'10.1.1.0/24'");
    expect(out.program.resources.filter(r=>r.type.startsWith('Microsoft.KeyVault') && !r.existing)).toHaveLength(0);
    expect(out.usageAssumptions.map(u=>u.quantity)).toEqual([10,5]);
    expect(out.existingResourceIds).toHaveLength(4);
    expect(()=>validateBoundBicep(out.code,c)).not.toThrow();
    expect(()=>bindBicepSource(out.code,c)).toThrow();
    expect(()=>bindBicepSource(c.payload.source,{payload:c.payload})).toThrow();
  });
  it('binds proposed new parent VNet and subnet CIDRs exactly',()=>{
    const c=ctx('ha'); const result=bindBicepSource(c.payload.source,c);
    expect(result.code).toContain("'10.2.0.0/16'"); expect(result.code).toContain("'10.2.1.0/24'");
    expect(result.program.resources.filter(r=>!r.existing&&r.type.startsWith('Microsoft.Network/virtualNetworks'))).toHaveLength(2);
  });
  it('adds one approved site and telemetry helper tied to each exact selected host, never another billed host',()=>{
    const c=ctx(); const out=bindBicepSource(c.payload.source,c);
    const site=out.program.resources.find(r=>r.type.startsWith('Microsoft.Web/sites'))!;
    expect(site).toBeDefined(); expect(obj(site.body.properties.properties).properties.serverFarmId).toEqual({kind:'reference',symbol:expect.any(String),property:'id'});
    expect(out.program.resources.filter(r=>!r.existing&&r.type.startsWith('Microsoft.Web/serverfarms'))).toHaveLength(0);
    expect(out.program.resources.filter(r=>!r.existing&&r.type.startsWith('Microsoft.Insights/components'))).toHaveLength(1);
  });
  it.each([
    (ast: ReturnType<typeof parseExtendBicep>)=>{ast.resources[0].existing=false;},
    (ast: ReturnType<typeof parseExtendBicep>)=>{ast.resources[0].body.properties.properties={kind:'object',properties:{reserved:false}};},
    (ast: ReturnType<typeof parseExtendBicep>)=>{ast.resources[0].body.properties.scope={kind:'call',name:'resourceGroup',arguments:['foreign','same-name']};},
    (ast: ReturnType<typeof parseExtendBicep>)=>{ast.resources[0].body.properties.name='sample-vnet';},
    (ast: ReturnType<typeof parseExtendBicep>)=>{ast.resources.push({...ast.resources[0],symbol:'foreign'});},
    (ast: ReturnType<typeof parseExtendBicep>)=>{ast.resources.find(r=>r.type.startsWith('Microsoft.Web/sites'))!.body.properties.properties={kind:'object',properties:{serverFarmId:{kind:'reference',symbol:'foreign',property:'id'}}};},
    (ast: ReturnType<typeof parseExtendBicep>)=>{obj(ast.resources.find(r=>r.type.includes('/subnets'))!.body.properties.properties).properties.addressPrefixes=['10.9.0.0/24'];},
    (ast: ReturnType<typeof parseExtendBicep>)=>{ast.resources.find(r=>r.type.includes('/subnets'))!.body.properties.parent={kind:'reference',symbol:'foreign'};},
  ])('rejects modified identity, mutable existing state, foreign refs and changed topology',fn=>expect(mutate(fn)).toThrow());
  it('ignores malicious comment/string declaration lookalikes and rejects hidden real declarations',()=>{
    const c=ctx(); expect(()=>bindBicepSource('// module attacker\n'+c.payload.source+'\n/* resource hidden */',c)).not.toThrow();
    expect(()=>bindBicepSource(c.payload.source+"\nresource foreign 'Microsoft.KeyVault/vaults@2023-07-01' = {}",c)).toThrow();
  });
  it('supports ordinary new compute with exact catalog SKU and capacity, and distinct IP resource count',()=>{
    const b=basis([{componentId:'app-service-linux-b1',quantity:2},{componentId:'public-ipv4-standard',quantity:2}]);
    const c=createBicepContext({...binding,workspaceId:b.extension.workspaceId,sourceScanId:b.extension.sourceScanId},b);
    const out=bindBicepSource(c.payload.source,c);
    const host=out.program.resources.find(r=>!r.existing&&r.type.startsWith('Microsoft.Web/serverfarms'))!;
    expect(obj(host.body.properties.sku).properties).toEqual({name:'B1',tier:'Basic',capacity:2});
    expect(out.program.resources.filter(r=>!r.existing&&r.type.startsWith('Microsoft.Web/serverfarms'))).toHaveLength(1);
    expect(out.program.resources.filter(r=>!r.existing&&r.type.startsWith('Microsoft.Network/publicIPAddresses'))).toHaveLength(2);
    for(const [key,value] of [['capacity',10],['name','P2v3']] as const){
      const ast=parseExtendBicep(c.payload.source);const h=ast.resources.find(r=>!r.existing&&r.type.startsWith('Microsoft.Web/serverfarms'))!;
      obj(h.body.properties.sku).properties[key]=value;
      expect(()=>bindBicepSource(emitExtendBicep(ast),c)).toThrow();
    }
  });
  it('rejects a different billing product or meter even when its SKU label looks identical',()=>{
    const b=basis([{componentId:'app-service-linux-b1',quantity:2}]);
    const changed=structuredClone(b);const component=changed.catalogData.catalog.components.find(c=>c.id==='app-service-linux-b1')!;
    if(component.pricing.kind!=='metered')throw Error();component.pricing.productName='Unrelated billable product';
    Object.assign(changed.extension,getExtensionCoreVersions(changed.catalogData.catalog,changed.catalogData.support));
    expect(()=>createBicepContext({...binding,workspaceId:b.extension.workspaceId,sourceScanId:b.extension.sourceScanId},changed)).toThrow();
  });
  it.each(['b1','b2','p0v3','p1v3','p2v3'])('accepts the pinned retail SKU/meter spelling for new %s hosts',sku=>{
    const f=fixture();
    for(const p of f.raw.plans){
      if(p.tier!=='low')continue;
      p.reusedResources=p.reusedResources.filter(r=>!r.componentId.startsWith('app-service-linux-'));
      p.newItems=[{componentId:`app-service-linux-${sku}`,quantity:2,instanceCount:2}];p.subnetProposals=[];
    }
    const result=processExtensionOutput(f.raw,f.context,{id:ids.extension,createdAt:binding.createdAt});
    if(!result.ok)throw Error(JSON.stringify(result));
    const b={extension:result.value,catalogData:{catalog:f.context.catalog,support:f.context.support},inventory:f.context.inventory};
    const c=createBicepContext({...binding,workspaceId:b.extension.workspaceId,sourceScanId:b.extension.sourceScanId},b);
    const hosts=bindBicepSource(c.payload.source,c).program.resources.filter(r=>!r.existing&&r.type.startsWith('Microsoft.Web/serverfarms'));
    expect(hosts).toHaveLength(1);
    expect(obj(hosts[0].body.properties.sku).properties).toEqual({name:sku.toUpperCase().replace('V3','v3'),tier:sku.startsWith('b')?'Basic':'PremiumV3',capacity:2});
    for(const mutate of [
      (p:Record<string,unknown>)=>{p.meterName='P1 v3 App unrelated';},
      (p:Record<string,unknown>)=>{p.unitOfMeasure='1 GB';},
      (p:Record<string,unknown>)=>{p.meterUnitsPerQuantity=1;},
      (p:Record<string,unknown>)=>{p.productName='Unrelated product';},
    ]){
      const changed=structuredClone(b),component=changed.catalogData.catalog.components.find(c=>c.id===`app-service-linux-${sku}`)!;
      mutate(component.pricing as unknown as Record<string,unknown>);
      Object.assign(changed.extension,getExtensionCoreVersions(changed.catalogData.catalog,changed.catalogData.support));
      expect(()=>createBicepContext({...binding,workspaceId:b.extension.workspaceId,sourceScanId:b.extension.sourceScanId},changed)).toThrow();
    }
  });
  it('includes required saved ancestors for an existing child across a different exact resource-group scope',()=>{
    const f=fixture();const inventory=structuredClone(f.context.inventory);
    const parent=inventory.resources[0];parent.resourceGroup='other-rg';parent.id=parent.id.replace('/sample-rg/','/other-rg/');
    const child={...structuredClone(parent),id:parent.id+'/subnets/saved-child',name:'sample-vnet/saved-child',type:'microsoft.network/virtualnetworks/subnets',parentId:parent.id,properties:{addressPrefix:'10.1.2.0/24',delegations:[]}};
    inventory.resources.push(child);
    const scan={...f.context.scan,summary:summarizeInventory(inventory.resources,[])};
    const request=createExtensionRequestContext(f.context.input,scan,inventory,f.context.catalog,{support:f.context.support});
    const raw=structuredClone(f.raw);const aliasToId=new Map(request.model.aliasToResourceId);
    const alias=(id:string)=>[...aliasToId].find(([,v])=>v===id)![0];
    for(const p of raw.plans){
      p.reusedResources=[{resourceId:alias(child.id),componentId:'virtual-network-subnet',reason:{en:'Reuse saved subnet',ko:'저장된 서브넷 재사용'}}];
      p.newItems=[{componentId:'public-ipv4-standard',quantity:1,instanceCount:1}];p.usageIncreases=[];p.subnetProposals=[];
    }
    const result=processExtensionOutput(raw,request,{id:ids.extension,createdAt:binding.createdAt});if(!result.ok)throw Error(JSON.stringify(result));
    const b={extension:result.value,catalogData:{catalog:request.catalog,support:request.support},inventory};
    const c=createBicepContext({...binding,workspaceId:b.extension.workspaceId,sourceScanId:b.extension.sourceScanId},b);
    expect(c.payload.source).not.toContain('other-rg');
    const out=bindBicepSource(c.payload.source,c);
    const childResource=out.program.resources.find(r=>r.type.includes('/subnets'))!;
    expect(childResource.existing).toBe(true);expect(childResource.body.properties.name).toBe('saved-child');
    expect(childResource.body.properties.parent).toEqual({kind:'reference',symbol:expect.stringMatching(/^a/)});
    expect(out.code).toContain("'other-rg'");expect(out.existingResourceIds).toEqual([child.id]);
    const ast=parseExtendBicep(out.code);obj(ast.resources.find(r=>r.symbol.startsWith('a'))!.body).properties.scope={kind:'call',name:'resourceGroup',arguments:[ids.subscription,'sample-rg']};
    expect(()=>validateBoundBicep(emitExtendBicep(ast),c)).toThrow();
    const missing=structuredClone(b);missing.inventory.resources=missing.inventory.resources.filter(r=>r.id!==parent.id);
    expect(()=>createBicepContext({...binding,workspaceId:b.extension.workspaceId,sourceScanId:b.extension.sourceScanId},missing)).toThrow('existing-ancestor-not-in-scan');
  });
  it('returns only server draft metadata and checks full saved artifact membership plus exact code',()=>{
    const c=ctx();const result=bindBicepSource(c.payload.source,c);
    expect(result.unverifiedDraft).toBe(true);
    const b=basis();const outer={...binding,workspaceId:b.extension.workspaceId,sourceScanId:b.extension.sourceScanId};
    const artifact={schemaVersion:1,...outer,content:{code:result.code,parameters:[],existingResourceIds:result.existingResourceIds,newComponentIds:result.newComponentIds,unverifiedDraft:true,deploymentNotes:[{en:'Review the saved checks before deployment.',ko:'배포 전에 저장된 검사를 검토합니다.'}]}};
    expect(()=>validateBicepArtifactSource(artifact,c)).not.toThrow();
    for(const patch of [{code:result.code.replace("'sample-plan'","'different-plan'")},{existingResourceIds:[]},{newComponentIds:[]},{parameters:[{name:'credential',description:{en:'Password',ko:'비밀번호'}}]},{unverifiedDraft:false}])expect(()=>validateBicepArtifactSource({...artifact,content:{...artifact.content,...patch}},c)).toThrow();
    expect(()=>validateBicepArtifactSource({...artifact,workspaceId:ids.otherWorkspace},c)).toThrow();
  });
  it('retains metered egress assumptions without creating a fictitious resource per GB',()=>{
    const b=basis([{componentId:'internet-egress',quantity:100}]);
    const c=createBicepContext({...binding,workspaceId:b.extension.workspaceId,sourceScanId:b.extension.sourceScanId},b);
    const out=bindBicepSource(c.payload.source,c);
    expect(out.usageAssumptions).toContainEqual({componentId:'internet-egress',quantity:100,kind:'new'});
    expect(out.program.resources.filter(r=>!r.existing)).toHaveLength(3);
    expect(c.payload.freeGrantAssumption).toBe('unverified-shared-free-grants-not-deducted');
  });
  it('refuses ten operation units as an invented new host count',()=>{
    const f=fixture();
    for(const p of f.raw.plans){
      p.newItems=p.newItems.filter(i=>!i.componentId.startsWith('postgres-flex-'));p.newItems.push({componentId:'key-vault-operations',quantity:10,instanceCount:1});
      p.reusedResources=p.reusedResources.filter(r=>r.componentId!=='key-vault-operations');p.usageIncreases=p.usageIncreases.filter(r=>r.componentId!=='key-vault-operations');
    }
    const result=processExtensionOutput(f.raw,f.context,{id:ids.extension,createdAt:binding.createdAt});if(!result.ok)throw Error(JSON.stringify(result));
    const b={extension:result.value,catalogData:{catalog:f.context.catalog,support:f.context.support},inventory:f.context.inventory};
    for (const p of b.extension.plans) for (const i of p.newItems) if(i.componentId==='key-vault-operations')delete i.instanceCount;
    expect(()=>createBicepContext({...binding,workspaceId:b.extension.workspaceId,sourceScanId:b.extension.sourceScanId},b)).toThrow('new-metered-host-identity-count-contract-required');
  });
  it('snapshots pinned input and rejects wrong-region code, changed parents and colliding new identities',()=>{
    const b=basis();const c=createBicepContext({...binding,workspaceId:b.extension.workspaceId,sourceScanId:b.extension.sourceScanId},b);
    b.inventory.resources[0].name='tampered';b.extension.plans[0].subnetProposals[0].addressPrefixes=['10.99.0.0/24'];
    expect(bindBicepSource(c.payload.source,c).code).toContain("'10.1.1.0/24'");
    const ast=parseExtendBicep(c.payload.source);ast.resources.find(r=>!r.existing&&r.body.properties.location)!.body.properties.location='westus2';
    expect(()=>bindBicepSource(emitExtendBicep(ast),c)).toThrow();
    const collision=basis();const source=collision.inventory.resources[1];const generated='cs'+binding.id.replaceAll('-','').slice(0,16)+'n0001';
    source.name=generated;source.id=source.id.slice(0,source.id.lastIndexOf('/')+1)+generated;
    const selected=collision.extension.plans.flatMap(p=>p.reusedResources).filter(r=>r.componentId==='app-service-linux-p1v3');for(const r of selected)r.resourceId=source.id;
    expect(()=>createBicepContext({...binding,workspaceId:collision.extension.workspaceId,sourceScanId:collision.extension.sourceScanId},collision)).toThrow();
  });
  it('reports concrete missing billing basis instead of unchecked compute or inventing metered host count',()=>{
    const f=processedFixture(); const b={extension:f.result,catalogData:{catalog:f.context.catalog,support:f.context.support},inventory:f.context.inventory};
    for(const component of b.catalogData.catalog.components)delete component.bicepDeployment;
    Object.assign(b.extension,getExtensionCoreVersions(b.catalogData.catalog,b.catalogData.support));
    expect(()=>createBicepContext({...binding,workspaceId:f.result.workspaceId,sourceScanId:f.result.sourceScanId},b)).toThrow('postgres-pinned-deployment-mapping-required');
  });
});

it('guards every new declaration and pins a true child to its saved parent deployment group', () => {
  const c = ctx('low'), out = bindBicepSource(c.payload.source, c);
  expect(out.code).toContain("var deploymentTargetMatches = toLower(resourceGroup().id) == '/subscriptions/");
  expect(out.code).toContain("/resourcegroups/sample-rg'");
  expect(out.code.match(/= if \(deploymentTargetMatches\)/g)).toHaveLength(out.program.resources.filter(r => !r.existing).length);
  expect(out.code).toContain('output deploymentTargetMatched bool = deploymentTargetMatches');
  const parent = out.program.resources.find(r => r.existing && r.type.startsWith('Microsoft.Network/virtualNetworks@'))!;
  expect(parent.body.properties.scope).toBeUndefined();
  expect(() => validateBoundBicep(out.code.replace('if (deploymentTargetMatches)', 'if (true)'), c)).toThrow();
  expect(() => validateBoundBicep(out.code.replace('toLower(resourceGroup().id)', 'resourceGroup().id'), c)).toThrow();
  expect(() => validateBoundBicep(out.code.replace('httpsOnly: true', 'httpsOnly: reference(\'unsafe\')'), c)).toThrow();
});
it('uses declared metered host counts rather than ingestion or operations quantity',()=>{
 const f=fixture();for(const p of f.raw.plans){
  p.newItems=p.newItems.filter(i=>!i.componentId.startsWith('postgres-flex-'));
  p.reusedResources=p.reusedResources.filter(r=>!['key-vault-operations','log-analytics-ingestion'].includes(r.componentId));p.usageIncreases=[];
  p.newItems.push({componentId:'key-vault-operations',quantity:10,instanceCount:2},{componentId:'log-analytics-ingestion',quantity:25,instanceCount:1});
 }
 const result=processExtensionOutput(f.raw,f.context,{id:ids.extension,createdAt:binding.createdAt});if(!result.ok)throw Error(JSON.stringify(result));
 const b={extension:result.value,catalogData:{catalog:f.context.catalog,support:f.context.support},inventory:f.context.inventory};
 const c=createBicepContext({...binding,workspaceId:b.extension.workspaceId,sourceScanId:b.extension.sourceScanId},b),out=bindBicepSource(c.payload.source,c);
 expect(out.program.resources.filter(r=>!r.existing&&r.type.startsWith('Microsoft.KeyVault/vaults'))).toHaveLength(2);
 expect(out.program.resources.filter(r=>!r.existing&&r.type.startsWith('Microsoft.OperationalInsights/workspaces'))).toHaveLength(1);
 expect(out.usageAssumptions).toContainEqual({componentId:'key-vault-operations',quantity:10,kind:'new'});
});
it('keeps a property-linked host in its exact other group while true child alone fixes the target',()=>{
 const b=basis();const host=b.inventory.resources.find(r=>r.type==='microsoft.web/serverfarms')!;
 const old=host.id,changed=old.replace('/sample-rg/','/other-host-rg/');
 const updated=JSON.parse(JSON.stringify(b).replaceAll(old,changed)) as typeof b;
 const saved=updated.inventory.resources.find(r=>r.id===changed)!;saved.resourceGroup='other-host-rg';
 const c=createBicepContext({...binding,workspaceId:b.extension.workspaceId,sourceScanId:b.extension.sourceScanId},updated);
 const out=bindBicepSource(c.payload.source,c);
 expect(out.deploymentTarget).toContain('/resourcegroups/sample-rg');
 expect(out.program.resources.find(r=>r.existing&&r.type.startsWith('Microsoft.Web/serverfarms'))!.body.properties.scope).toMatchObject({kind:'call',arguments:[saved.subscriptionId,'other-host-rg']});
});
it('fails conflicting true-child target groups instead of fabricating cross-scope child support',()=>{
 const b=basis(),vnet=b.inventory.resources.find(r=>r.type==='microsoft.network/virtualnetworks')!;
 const another={...structuredClone(vnet),id:vnet.id.replace('/sample-rg/','/other-rg/'),resourceGroup:'other-rg'};b.inventory.resources.push(another);
 const p=b.extension.plans[0],s=p.subnetProposals[0];
 p.reusedResources.push({resourceId:another.id,componentId:'virtual-network',reason:{en:'Reuse saved network',ko:'저장된 네트워크 재사용'}});
 p.subnetProposals.push({...structuredClone(s),id:'second-subnet',parent:{kind:'existing',resourceId:another.id},addressPrefixes:['10.1.2.0/24']});
 const item=p.newItems.find(i=>i.componentId==='virtual-network-subnet')!;item.quantity=2;item.instanceCount=2;
 // This is a context-only conflict fixture; keep its structural saved cost membership consistent.
 if(p.incrementalCost.state==='available') {const line=p.incrementalCost.data.lines.find(i=>i.componentId==='virtual-network-subnet')!;line.quantity=2;}
 expect(()=>createBicepContext({...binding,workspaceId:b.extension.workspaceId,sourceScanId:b.extension.sourceScanId},b)).toThrow('single-deployment-target-conflict');
});
it('emits PostgreSQL from pinned machine mapping with allocated storage, exact counts and secure credentials',()=>{
 const f=processedFixture(),b={extension:f.result,catalogData:{catalog:f.context.catalog,support:f.context.support},inventory:f.context.inventory};
 const c=createBicepContext({...binding,workspaceId:f.result.workspaceId,sourceScanId:f.result.sourceScanId},b),out=bindBicepSource(c.payload.source,c);
 const db=out.program.resources.find(r=>r.type.startsWith('Microsoft.DBforPostgreSQL/flexibleServers'))!;
 expect(obj(db.body.properties.sku).properties).toEqual({name:'Standard_B1ms',tier:'Burstable'});
 expect(obj(obj(db.body.properties.properties).properties.storage).properties).toEqual({storageSizeGB:32,type:'Premium_LRS'});
 expect(out.code).toContain('@secure()');expect(out.code).not.toContain('postgresPassword string =');
 expect(out.postgresMappings[0]).toMatchObject({skuName:'Standard_B1ms',mappingBasis:'official-example',capabilityStatus:'unverified'});
 const legacy=structuredClone(b);for(const component of legacy.catalogData.catalog.components)delete component.bicepDeployment;
 Object.assign(legacy.extension,getExtensionCoreVersions(legacy.catalogData.catalog,legacy.catalogData.support));
 expect(()=>createBicepContext({...binding,workspaceId:f.result.workspaceId,sourceScanId:f.result.sourceScanId},legacy)).toThrow('postgres-pinned-deployment-mapping-required');
});
