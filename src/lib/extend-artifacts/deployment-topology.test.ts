// @vitest-environment node
import {expect,it} from 'vitest';
import {fixture} from '@/lib/extend/proposal.test-data';
import {processExtensionOutput,getExtensionCoreVersions} from '@/lib/extend/process';
import {ids} from '@/lib/completion/fixtures.test-data';
import {createBicepContext,bindBicepSource} from './bicep-semantics';
import type {BicepObject} from './bicep-source';
import {createExtensionArtifactCompiler} from '@/services/extension-artifact-compiler';
const object=(value:unknown)=>(value as BicepObject).properties;
function topology(){
 const f=fixture();
 for(const p of f.raw.plans){
  p.reusedResources=p.reusedResources.filter(r=>!r.componentId.startsWith('app-service-linux-'));
  p.newItems=[{componentId:'app-service-linux-p1v3',quantity:2,instanceCount:2},{componentId:'postgres-flex-gp-2vcore',quantity:2,instanceCount:2},{componentId:'postgres-flex-storage',quantity:64,instanceCount:2}];
  p.subnetProposals=[];
 }
 const result=processExtensionOutput(f.raw,f.context,{id:ids.extension,createdAt:'2026-11-12T12:00:00.000Z'});
 if(!result.ok)throw Error(JSON.stringify(result));
 return {extension:result.value,catalogData:{catalog:f.context.catalog,support:f.context.support},inventory:f.context.inventory};
}
function compileContext(b=topology(),tier:'low'|'ha'='ha'){
 const context=createBicepContext({id:ids.network,extensionId:ids.extension,workspaceId:b.extension.workspaceId,sourceScanId:b.extension.sourceScanId,tier,kind:'bicep',createdAt:'2026-11-12T12:00:01.000Z'},b);
 return {context,bound:bindBicepSource(context.payload.source,context)};
}
it('uses explicit pinned HA intent for one native primary/standby logical server and a grouped zone-redundant plan',()=>{
 const {bound}=compileContext();
 const dbs=bound.program.resources.filter(r=>!r.existing&&r.type.startsWith('Microsoft.DBforPostgreSQL/flexibleServers'));
 expect(dbs).toHaveLength(1);
 expect(object(dbs[0].body.properties.properties).highAvailability).toEqual({kind:'object',properties:{mode:'ZoneRedundant',standbyAvailabilityZone:{kind:'deployment-zone',index:1}}});
 expect(object(dbs[0].body.properties.properties).availabilityZone).toEqual({kind:'deployment-zone',index:0});
 expect(bound.program.zoneInputGuard).toBe(true);
 expect(bound.program.resources.filter(r=>!r.existing).every(r=>r.guarded==='deploymentEnabled')).toBe(true);
 expect(object(object(dbs[0].body.properties.properties).storage).storageSizeGB).toBe(32);
 const hosts=bound.program.resources.filter(r=>!r.existing&&r.type.startsWith('Microsoft.Web/serverfarms'));
 expect(hosts).toHaveLength(1);expect(object(hosts[0].body.properties.sku).capacity).toBe(2);
 expect(object(hosts[0].body.properties.properties).zoneRedundant).toBe(true);
 expect(bound.postgresMappings[0].highAvailabilityMode).toBe('ZoneRedundant');
});
it('requires pinned machine intent and deployment roles rather than filling legacy omissions from current files',()=>{
 const b=topology();delete b.catalogData.catalog.architectures.find(a=>a.id==='app-service-basic-web-app')!.tiers.ha.deploymentIntent;
 Object.assign(b.extension,getExtensionCoreVersions(b.catalogData.catalog,b.catalogData.support));
 expect(()=>compileContext(b)).toThrow('deployment-intent-required');
 const c=topology();delete c.catalogData.catalog.components.find(c=>c.id==='app-service-linux-p1v3')!.extensionDeployment;
 Object.assign(c.extension,getExtensionCoreVersions(c.catalogData.catalog,c.catalogData.support));
 expect(()=>compileContext(c)).toThrow();
});
it('never derives native HA or zone settings from a tier label',()=>{
 const b=topology(),intent=b.catalogData.catalog.architectures.find(a=>a.id==='app-service-basic-web-app')!.tiers.ha.deploymentIntent!;
 intent.postgres={highAvailabilityMode:'Disabled',billingInstancesPerRoot:1};intent.appService={zoneRedundant:false,minimumCapacity:1};
 Object.assign(b.extension,getExtensionCoreVersions(b.catalogData.catalog,b.catalogData.support));
 const {bound}=compileContext(b);
 const dbs=bound.program.resources.filter(r=>!r.existing&&r.type.startsWith('Microsoft.DBforPostgreSQL/flexibleServers'));
 expect(dbs).toHaveLength(2);
 for(const db of dbs)expect(object(object(db.body.properties.properties).highAvailability).mode).toBe('Disabled');
 const host=bound.program.resources.find(r=>!r.existing&&r.type.startsWith('Microsoft.Web/serverfarms'))!;
 expect(object(host.body.properties.properties).zoneRedundant).toBe(false);
});
// Real-compiler contract (docs/SELF_HOSTING.md#native-bicep-compiler): CLOUDSIGHT_TEST_BICEP_PATH names the pinned CLI; unset skips explicitly, a wrong path fails.
const executable=process.env.CLOUDSIGHT_TEST_BICEP_PATH??'';
it.skipIf(!executable)('compiles native HA, per-physical storage and grouped zone-redundant App Service with real ARM crosschecks',async()=>{
 const {context,bound}=compileContext();
 expect(await createExtensionArtifactCompiler({executable}).compile(bound.code,context)).toMatchObject({policyVersion:'extend-bicep-source-arm-v1'});
},30000);
