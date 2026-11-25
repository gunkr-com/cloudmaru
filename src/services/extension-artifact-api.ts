import 'server-only';
import {z} from 'zod';
import {extensionArtifactRequestSchema,sourceScanSchema} from '@/lib/completion/schema';
import {getPostgresDeploymentMapping,getComponentBicepDeployment,getExtensionDeploymentIntent} from '@/lib/catalog/extension-deployment';
import {createBicepContext} from '@/lib/extend-artifacts/bicep-semantics';
import {ExtendBicepError} from '@/lib/extend-artifacts/bicep-source';
import {tierSchema} from '@/lib/catalog/schema';
import {getStaleBefore,isJobStale} from '@/lib/jobs/timing';
import {artifactDisplayBasis,renderExtensionArtifactFile} from '@/lib/extend-artifacts/render-file';
import {runExtensionArtifactJob} from '@/lib/extend-artifacts/artifact-job';
import {getExtension,getExtensionCoreData,getExtensionSourceScan} from './db/extensions';
import {listExtensionArtifacts,reserveExtensionArtifact,completeExtensionArtifact,failExtensionArtifact} from './db/extension-artifacts';
import {getCurrentWorkspace} from './current-workspace';
import {hasCompletionClaudeKey,requestCompletionStructuredOutput} from './workspace-claude';
import {checkExtensionArtifactCompilerAvailability,isCompilerEnvironmentError} from './extension-artifact-compiler';
import {prepareExtensionArtifactRequest} from './extension-artifact-context';
import {logExtensionArtifactValidation} from './extension-artifact-validation-log';
import type {Locale} from '@/types/i18n';
import type {Tier} from '@/types/catalog';
import type {ExtensionArtifactRecord} from './db/extension-artifacts';
const headers={'Cache-Control':'private, no-store',Vary:'Cookie','X-Content-Type-Options':'nosniff'};
const error=(status:number,code:string,workspaceId?:string)=>Response.json({code,...(workspaceId?{workspaceId}:{})},{status,headers});
function view(row:ExtensionArtifactRecord,now:Date){
 const stale=row.status==='pending'&&isJobStale(row.createdAt,now);
 return {id:row.id,extensionId:row.extensionId,workspaceId:row.workspaceId,sourceScanId:row.sourceScanId,tier:row.tier,kind:row.kind,
   status:stale?'failed' as const:row.status,content:row.content,error:stale?'interrupted':row.error?.code??null,createdAt:row.createdAt};
}
type Dependencies={getExtension:typeof getExtension;getExtensionCoreData:typeof getExtensionCoreData;
 getExtensionSourceScan:typeof getExtensionSourceScan;
 getCurrentWorkspace:()=>Promise<{id:string}>;hasCompletionClaudeKey:typeof hasCompletionClaudeKey;
 listExtensionArtifacts:typeof listExtensionArtifacts;reserveExtensionArtifact:typeof reserveExtensionArtifact;failExtensionArtifact:typeof failExtensionArtifact;
 checkCompilerAvailability:()=>Promise<void>;
 schedule:(task:()=>Promise<void>)=>void;runJob:(id:string,attemptId:string)=>Promise<void>;now:()=>Date};
export function createExtensionArtifactApi(deps:Dependencies){
 async function parent(id:string){return z.uuid().safeParse(id).success?deps.getExtension(id):null;}
 async function basis(id:string,tier:Tier){
  const p=await parent(id);if(!p?.result||p.status!=='succeeded')return null;
  const data=await deps.getExtensionCoreData(id);if(!data)throw Error('saved-basis-missing');
  return artifactDisplayBasis(p.result,data,tier);
 }
 return {
  async post(request:Request,id:string):Promise<Response>{
   try{
    if(!z.uuid().safeParse(id).success)return error(404,'extension-missing');
    let raw:unknown;try{raw=await request.json();}catch{return error(400,'invalid-request');}
    const parsed=extensionArtifactRequestSchema.safeParse(raw);
    if(!parsed.success||parsed.data.extensionId!==id)return error(400,'invalid-request');
    const p=await parent(id);if(!p)return error(404,'extension-missing');
    if(p.status!=='succeeded'||!p.result)return error(409,'extension-not-succeeded');
    if((await deps.getCurrentWorkspace()).id!==p.workspaceId)return error(409,'workspace-changed',p.workspaceId);
    const input=parsed.data,now=deps.now();
    const old=(await deps.listExtensionArtifacts(id,{tier:input.tier})).find(a=>a.kind===input.kind);
    if(old&&(old.status==='succeeded'||old.status==='pending'&&!isJobStale(old.createdAt,now)))
      return Response.json({artifact:view(old,now)},{status:old.status==='succeeded'?200:202,headers});
    if(input.kind==='bicep') {
      const plan=p.result.plans.find(plan=>plan.tier===input.tier);
      if(!plan)return error(409,'option-missing');
      const groups=new Set(plan.subnetProposals.flatMap(s=>s.parent.kind==='existing'?[s.parent.resourceId.split('/').slice(0,5).join('/')]:[]));
      if(groups.size>1)return error(409,'deployment-target-conflict');
      const catalog=await deps.getExtensionCoreData(id);
      if(!catalog)return error(409,'deployment-mapping-missing');
      if(!getExtensionDeploymentIntent(catalog.catalog,plan.referenceArchitectureId,input.tier))return error(409,'deployment-mapping-missing');
      for(const item of plan.newItems){
        const component=catalog.catalog.components.find(c=>c.id===item.componentId);
        if(!component||!getComponentBicepDeployment(component))return error(409,'deployment-mapping-missing');
      }
      for(const item of plan.newItems)if(item.componentId.startsWith('postgres-flex-')) {
        const component=catalog.catalog.components.find(c=>c.id===item.componentId);
        if(!component||!getPostgresDeploymentMapping(component))return error(409,'deployment-mapping-missing');
      }
      const source=await deps.getExtensionSourceScan(p.sourceScanId);
      if(!source||source.scan.workspaceId!==p.workspaceId||source.scan.id!==p.sourceScanId||source.scan.status!=='succeeded'
        ||JSON.stringify(sourceScanSchema.parse(source.sourceScan))!==JSON.stringify(sourceScanSchema.parse(p.result.sourceScan)))return error(409,'deployment-configuration-invalid');
      try{
        // Pure preparation only: no model, compiler, key, reservation or current engine.
        // The eventual artifact gets its own row-derived names after reservation.
        createBicepContext({id:p.id,extensionId:p.id,workspaceId:p.workspaceId,sourceScanId:p.sourceScanId,tier:input.tier,kind:'bicep',createdAt:now.toISOString()},
          {extension:p.result,catalogData:catalog,inventory:source.inventory});
      }catch(e){
        if(e instanceof ExtendBicepError&&e.code.includes('binding'))return error(409,'deployment-network-binding-required');
        return error(409,'deployment-configuration-invalid');
      }
      try{await deps.checkCompilerAvailability();}
      catch(e){if(isCompilerEnvironmentError(e))return error(409,'compiler-unavailable');throw e;}
    }
    // The parent is already saved: its persisted scan/owner resolves the exact company key before reservation.
    if(!await deps.hasCompletionClaudeKey({source:'extension',sourceId:id}))return error(409,'key-unavailable',p.workspaceId);
    const reserved=await deps.reserveExtensionArtifact(input,{staleBefore:getStaleBefore(now)});
    if(!reserved)return error(404,'extension-missing');
    if(reserved.created){
      try{deps.schedule(()=>deps.runJob(reserved.id,reserved.attemptId));}
      catch{await deps.failExtensionArtifact(reserved.id,reserved.attemptId,'internal',null);return error(500,'internal');}
    }
    return Response.json({artifact:{id:reserved.id,tier:input.tier,kind:input.kind,status:reserved.status,createdAt:now.toISOString(),content:null,error:null}},
      {status:reserved.status==='succeeded'?200:202,headers});
   }catch{return error(500,'internal');}
  },
  async get(id:string,tierRaw:unknown):Promise<Response>{
   try{
    const tier=tierSchema.safeParse(tierRaw);if(!tier.success)return error(400,'invalid-request');
    const saved=await basis(id,tier.data);if(!saved)return error(404,'extension-missing');
    return Response.json({basis:saved,artifacts:(await deps.listExtensionArtifacts(id,{tier:tier.data})).map(r=>view(r,deps.now()))},{headers});
   }catch{return error(500,'internal');}
  },
  async download(id:string,tierRaw:unknown,kindRaw:unknown,locale:Locale):Promise<Response>{
   try{
    const parsed=extensionArtifactRequestSchema.safeParse({schemaVersion:1,extensionId:id,tier:tierRaw,kind:kindRaw});
    if(!parsed.success)return error(400,'invalid-request');
    const {tier,kind}=parsed.data,saved=await basis(id,tier);if(!saved)return error(404,'download-missing');
    const row=(await deps.listExtensionArtifacts(id,{tier})).find(a=>a.kind===kind);
    if(row?.status!=='succeeded'||!row.content)return error(404,'download-missing');
    const file=renderExtensionArtifactFile(row.content,saved,locale);
    return new Response(file.body,{headers:{...headers,'Content-Type':file.contentType,'Content-Disposition':`attachment; filename="${file.filename}"`,
      'Content-Security-Policy':"default-src 'none'; sandbox"}});
   }catch{return error(500,'internal');}
  },
 };
}
export function extensionArtifactApi(schedule:Dependencies['schedule']){
 return createExtensionArtifactApi({getExtension,getExtensionCoreData,getExtensionSourceScan,getCurrentWorkspace,hasCompletionClaudeKey,
 listExtensionArtifacts,reserveExtensionArtifact,failExtensionArtifact,checkCompilerAvailability:checkExtensionArtifactCompilerAvailability,schedule,now:()=>new Date(),
 runJob:(id,attemptId)=>runExtensionArtifactJob(id,attemptId,{
  prepare:prepareExtensionArtifactRequest,
  onValidation:event=>logExtensionArtifactValidation(id,event),
  llm:request=>requestCompletionStructuredOutput({source:'extension-artifact',sourceId:id},request),
  complete:completeExtensionArtifact,fail:failExtensionArtifact,
 })});
}
