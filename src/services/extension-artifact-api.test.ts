// @vitest-environment node
import {expect,it,vi} from 'vitest';
import {processedFixture} from '@/lib/extend/proposal.test-data';
import {referencePlan} from '@/lib/extend/deployment.test-data';
import {createExtensionArtifactApi} from './extension-artifact-api';
import {ExtensionArtifactCompilerError} from './extension-artifact-compiler';
const f=processedFixture();
function setup(){
 const deps={getExtension:vi.fn(async()=>({id:f.result.id,workspaceId:f.result.workspaceId,sourceScanId:f.result.sourceScanId,status:'succeeded',result:f.result})),
 getExtensionCoreData:vi.fn(async()=>({catalog:f.context.catalog,support:f.context.support})),getCurrentWorkspace:vi.fn(async()=>({id:f.result.workspaceId})),
 getExtensionSourceScan:vi.fn(async()=>({scan:f.context.scan,inventory:f.context.inventory,sourceScan:f.result.sourceScan})),
 checkCompilerAvailability:vi.fn(async()=>{}),hasCompletionClaudeKey:vi.fn(async()=>true),listExtensionArtifacts:vi.fn(async()=>[]),reserveExtensionArtifact:vi.fn(async()=>({id:'row',attemptId:'attempt',status:'pending',created:true})),
 failExtensionArtifact:vi.fn(async()=>true),schedule:vi.fn(),runJob:vi.fn(async()=>{}),now:()=>new Date()};
 return {deps,api:createExtensionArtifactApi(deps as never)};
}
const request=(extra={})=>new Request('http://localhost/api',{method:'POST',body:JSON.stringify({schemaVersion:1,extensionId:f.result.id,tier:'low',kind:'guide',...extra})});
it('checks current workspace and owning parent key before reserving, schedules new attempts only',async()=>{
 const {deps,api}=setup();const response=await api.post(request(),f.result.id);expect(response.status).toBe(202);
 expect(deps.hasCompletionClaudeKey).toHaveBeenCalledWith({source:'extension',sourceId:f.result.id});expect(deps.schedule).toHaveBeenCalledTimes(1);
 await deps.schedule.mock.calls[0][0]();expect(deps.runJob).toHaveBeenCalledWith('row','attempt');
 deps.reserveExtensionArtifact.mockResolvedValueOnce({id:'row',attemptId:'attempt',status:'pending',created:false});
 await api.post(request(),f.result.id);expect(deps.schedule).toHaveBeenCalledTimes(1);
});
it('rejects unknown IDs, forged parent/cost fields, other workspace and no key without reservation',async()=>{
 const {deps,api}=setup();expect((await api.post(request({total:0}),f.result.id)).status).toBe(400);
 expect((await api.post(request(),'bad-id')).status).toBe(404);
 deps.getCurrentWorkspace.mockResolvedValueOnce({id:'other'});expect((await api.post(request(),f.result.id)).status).toBe(409);
 deps.hasCompletionClaudeKey.mockResolvedValueOnce(false);expect((await api.post(request(),f.result.id)).status).toBe(409);
 expect(deps.reserveExtensionArtifact).not.toHaveBeenCalled();
});
it('returns saved ownership on GET without current-workspace/key or generation calls',async()=>{
 const {deps,api}=setup();const r=await api.get(f.result.id,'low');expect(r.status).toBe(200);
 expect((await r.json()).basis.sourceScanId).toBe(f.result.sourceScanId);
 expect(deps.getCurrentWorkspace).not.toHaveBeenCalled();expect(deps.hasCompletionClaudeKey).not.toHaveBeenCalled();expect(deps.runJob).not.toHaveBeenCalled();
});
it('marks scheduling failures with exact attempt, sanitizes DB errors and exposes no provider text',async()=>{
 const {deps,api}=setup();deps.schedule.mockImplementationOnce(()=>{throw Error('secret');});
 expect((await api.post(request(),f.result.id)).status).toBe(500);expect(deps.failExtensionArtifact).toHaveBeenCalledWith('row','attempt','internal',null);
 deps.getExtension.mockRejectedValueOnce(Error('database secret'));
 const r=await api.get(f.result.id,'low');expect(r.status).toBe(500);expect(JSON.stringify(await r.json())).not.toContain('secret');
});
it('reports conflicting true-child target groups before a paid Bicep reservation',async()=>{
 const {deps,api}=setup();const p=structuredClone(await deps.getExtension());
 const s=p.result.plans[0].subnetProposals[0];
 if(s.parent.kind!=='existing')throw Error();
 p.result.plans[0].subnetProposals.push({...s,id:'other-subnet',parent:{kind:'existing',resourceId:s.parent.resourceId.replace('/sample-rg/','/another-rg/')}});
 deps.getExtension.mockResolvedValue(p);
 const r=await api.post(request({kind:'bicep'}),f.result.id);expect(r.status).toBe(409);expect(await r.json()).toMatchObject({code:'deployment-target-conflict'});
 expect(deps.reserveExtensionArtifact).not.toHaveBeenCalled();
});
it('preflights missing pinned topology before key lookup, reservation or model scheduling',async()=>{
 const {deps,api}=setup(),data=structuredClone(await deps.getExtensionCoreData());
 delete data.catalog.architectures.find(a=>a.id===f.result.plans[0].referenceArchitectureId)!.tiers.low.deploymentIntent;
 deps.getExtensionCoreData.mockResolvedValue(data);
 const r=await api.post(request({kind:'bicep'}),f.result.id);
 expect(r.status).toBe(409);expect(await r.json()).toMatchObject({code:'deployment-mapping-missing'});
 expect(deps.hasCompletionClaudeKey).not.toHaveBeenCalled();expect(deps.reserveExtensionArtifact).not.toHaveBeenCalled();expect(deps.schedule).not.toHaveBeenCalled();
});
it.each(['missing-network','meter-count','missing-backend'] as const)('returns actionable %s preflight errors before key/reservation/model',async attack=>{
 const {deps,api}=setup(),parent=structuredClone(await deps.getExtension());
 Object.assign(parent.result.plans[0],referencePlan('app-service-zone-redundant','low'));
 const plan=parent.result.plans[0];
 if(attack==='missing-network')delete plan.deploymentBindings;
 if(attack==='meter-count')plan.newItems.find(i=>i.componentId==='application-gateway-v2-capacity')!.instanceCount=2;
 if(attack==='missing-backend')plan.newItems=plan.newItems.filter(i=>!i.componentId.startsWith('app-service-linux-'));
 plan.incrementalCost={state:'unavailable',reason:'price-unavailable'};
 plan.checks=[{kind:'capacity',verdict:'unknown',reasonCodes:['capacity-unverified'],resourceIds:[],componentIds:[],evidence:[]}];
 deps.getExtension.mockResolvedValue(parent);
 const r=await api.post(request({kind:'bicep'}),f.result.id);
 expect(r.status).toBe(409);expect(await r.json()).toMatchObject({code:attack==='meter-count'?'deployment-configuration-invalid':'deployment-network-binding-required'});
 expect(deps.hasCompletionClaudeKey).not.toHaveBeenCalled();expect(deps.reserveExtensionArtifact).not.toHaveBeenCalled();expect(deps.schedule).not.toHaveBeenCalled();
});
it('checks the exact succeeded source scan before key lookup or Bicep reservation',async()=>{
 for(const patch of [{id:'00000000-0000-4000-8000-000000000099'},{status:'pending'}]){
  const {deps,api}=setup(),source=structuredClone(await deps.getExtensionSourceScan());
  Object.assign(source.scan,patch);deps.getExtensionSourceScan.mockResolvedValue(source);
  const r=await api.post(request({kind:'bicep'}),f.result.id);expect(r.status).toBe(409);
  expect(await r.json()).toMatchObject({code:'deployment-configuration-invalid'});
  expect(deps.hasCompletionClaudeKey).not.toHaveBeenCalled();expect(deps.reserveExtensionArtifact).not.toHaveBeenCalled();expect(deps.schedule).not.toHaveBeenCalled();
 }
});
it.each(['configuration','compiler-unavailable','compiler-version','timeout','output-limit'] as const)('blocks %s before key/reservation/scheduling with sanitized compiler advice',async code=>{
 const {deps,api}=setup();deps.checkCompilerAvailability.mockRejectedValue(new ExtensionArtifactCompilerError(code));
 const r=await api.post(request({kind:'bicep'}),f.result.id);
 expect(r.status).toBe(409);expect(await r.json()).toEqual({code:'compiler-unavailable'});
 expect(deps.hasCompletionClaudeKey).not.toHaveBeenCalled();expect(deps.reserveExtensionArtifact).not.toHaveBeenCalled();expect(deps.schedule).not.toHaveBeenCalled();
});
it('checks compiler after pure source preflight and before key lookup, without touching text generation or cached Bicep',async()=>{
 const {deps,api}=setup();
 deps.hasCompletionClaudeKey.mockImplementation(async()=>{expect(deps.checkCompilerAvailability).toHaveBeenCalledTimes(1);return true;});
 expect((await api.post(request({kind:'bicep'}),f.result.id)).status).toBe(202);
 expect(deps.checkCompilerAvailability).toHaveBeenCalledTimes(1);
 deps.hasCompletionClaudeKey.mockResolvedValue(true);deps.checkCompilerAvailability.mockClear();
 await api.post(request(),f.result.id);await api.post(request({kind:'evaluation'}),f.result.id);
 for(const status of ['succeeded','pending']){
  deps.listExtensionArtifacts.mockResolvedValueOnce([{id:'cached',kind:'bicep',tier:'low',status,createdAt:new Date().toISOString()}] as never);
  expect((await api.post(request({kind:'bicep'}),f.result.id)).status).toBe(status==='succeeded'?200:202);
 }
 expect(deps.checkCompilerAvailability).not.toHaveBeenCalled();
});
it('rejects an invalid source before any compiler I/O and sanitizes unknown compiler errors',async()=>{
 const {deps,api}=setup();deps.getExtensionSourceScan.mockResolvedValueOnce(null as never);
 expect((await api.post(request({kind:'bicep'}),f.result.id)).status).toBe(409);
 expect(deps.checkCompilerAvailability).not.toHaveBeenCalled();
 deps.checkCompilerAvailability.mockRejectedValueOnce(Error('/private/company secret'));
 const r=await api.post(request({kind:'bicep'}),f.result.id);
 expect(r.status).toBe(500);expect(await r.json()).toEqual({code:'internal'});
 expect(deps.hasCompletionClaudeKey).not.toHaveBeenCalled();
});
