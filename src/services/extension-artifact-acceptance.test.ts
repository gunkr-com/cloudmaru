// @vitest-environment node
vi.mock("./workspace-secrets", () => ({ readWorkspaceSecret: vi.fn(async () => null) }));
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {Tier} from '@/types/catalog';
import {parseExtendBicep} from '@/lib/extend-artifacts/bicep-source';
import {createTranslator} from '@/i18n/translate';
import type {PGlite} from '@electric-sql/pglite';
import {createTestDatabase,insertTestWorkspace} from '@/lib/db/test-db.test-data';
import {processedFixture} from '@/lib/extend/proposal.test-data';
import {referencePlan} from '@/lib/extend/deployment.test-data';
import {createExtensionRequestContext} from '@/lib/extend/validate-proposal';
import {processExtensionOutput} from '@/lib/extend/process';
import {runExtensionArtifactJob} from '@/lib/extend-artifacts/artifact-job';
import {validateExtensionArtifact,checkExtensionArtifactCompilerAvailability} from './extension-artifact-compiler';
import {createScansDb} from './db/scans';
import {createExtensionsDb} from './db/extensions';
import {createExtensionArtifactsDb} from './db/extension-artifacts';
import {createExtensionArtifactContextService} from './extension-artifact-context';
import {createExtensionArtifactApi} from './extension-artifact-api';
import {requestCompletionStructuredOutput,hasCompletionClaudeKey} from './workspace-claude';
import {saveWorkspaceClaudeSettings} from './db/workspace-claude';
const sdk=vi.hoisted(()=>vi.fn());
vi.mock('./claude',async importOriginal=>({...await importOriginal<typeof import('./claude')>(),requestStructuredOutput:sdk}));
vi.mock('./db/client',()=>({getDb:async()=>db}));
let db:PGlite,workspaceId:string,extensionId:string,compilerRoot:string;
let parents:ReturnType<typeof createExtensionsDb>,store:ReturnType<typeof createExtensionArtifactsDb>,context:ReturnType<typeof createExtensionArtifactContextService>;
const f=processedFixture(),tasks:(()=>Promise<void>)[]=[];
const usage={promptTokens:11,completionTokens:6,costUsd:0.01};
beforeEach(async()=>{
 compilerRoot=await mkdtemp(join(tmpdir(),'cloudsight-acceptance-compiler-'));
 const executable=join(compilerRoot,'bicep');
 await writeFile(executable,`#!${process.execPath}\nif(process.argv[2]==='--version')console.log('Bicep CLI version 0.49.2 (b34271ac51)');else process.exit(1);`,{mode:0o700});
 vi.stubEnv('CLOUDSIGHT_BICEP_PATH',executable);
 db=await createTestDatabase();workspaceId=await insertTestWorkspace(db);tasks.length=0;sdk.mockReset();
 const scanId=await createScansDb({db:async()=>db}).createImportScan({workspaceId,subscriptionIds:f.context.scan.subscriptionIds,inventory:f.context.inventory,summary:f.context.scan.summary!,collectedAt:f.context.scan.collectedAt!});
 parents=createExtensionsDb({db:async()=>db});const input={...f.result.input,workspaceId,sourceScanId:scanId};
 const row=(await parents.reserveExtension(input))!,saved=(await parents.getExtensionSourceScan(scanId))!,parent=(await parents.getExtension(row.id))!;
 const c=createExtensionRequestContext(input,saved.scan,saved.inventory,f.context.catalog,{support:f.context.support});
 const result=processExtensionOutput(f.raw,c,{id:parent.id,createdAt:parent.createdAt});if(!result.ok)throw Error(JSON.stringify(result));
 await parents.completeExtension(parent.id,result.value);extensionId=parent.id;
 store=createExtensionArtifactsDb({db:async()=>db,validateArtifact:validateExtensionArtifact});context=createExtensionArtifactContextService({...parents,...store});
 vi.stubEnv('CLOUDSIGHT_CLAUDE_KEY_ONE','fake-one');vi.stubEnv('CLOUDSIGHT_CLAUDE_KEY_TWO','fake-two');vi.stubEnv('ANTHROPIC_API_KEY','forbidden-fallback');
 await saveWorkspaceClaudeSettings(workspaceId,{apiKeyEnv:'CLOUDSIGHT_CLAUDE_KEY_ONE'});
});
afterEach(async()=>{vi.restoreAllMocks();vi.unstubAllEnvs();await db.close();await rm(compilerRoot,{recursive:true,force:true});});
function api(current=workspaceId){return createExtensionArtifactApi({...parents,...store,getCurrentWorkspace:async()=>({id:current}),hasCompletionClaudeKey,checkCompilerAvailability:checkExtensionArtifactCompilerAvailability,
 schedule:task=>{tasks.push(task);},now:()=>new Date(),runJob:(id,attempt)=>runExtensionArtifactJob(id,attempt,{prepare:context.prepareExtensionArtifactRequest,
 llm:request=>requestCompletionStructuredOutput({source:'extension-artifact',sourceId:id},request),complete:store.completeExtensionArtifact,fail:store.failExtensionArtifact})});}
const post=(kind='guide',tier:Tier='low')=>new Request('http://localhost/api',{method:'POST',body:JSON.stringify({schemaVersion:1,extensionId,tier,kind})});
function good(request:{user:string}){
 const payload=JSON.parse(request.user.split('\n<validation_errors>')[0]);
 return {overview:'review-saved',prerequisites:['check-access'],cautions:['capacity-unknown','review-scope'],steps:[{title:'review-configuration',goal:'review-saved',instructions:['review-authentication','test-recovery'],
 componentIds:payload.components.map((c:{id:string})=>c.id),reusedResourceIds:payload.reusedResources.map((r:{alias:string})=>r.alias),verification:'verify-isolated'}]};
}
it.each(['guide','evaluation'] as const)('rejects foreign-product EN/KO variants through the actual %s job, store and proof boundary',async kind=>{
 const variants=[
  {en:'Use snowflake for monitoring.',ko:'스노우플레이크를 사용합니다.'},
  {en:'Use DaTaDoG for monitoring.',ko:'데이터독으로 모니터링합니다.'},
  {en:'Use prometheus for monitoring.',ko:'프로메테우스를 사용합니다.'},
  {en:'Use ＳＮＯＷＦＬＡＫＥ for monitoring.',ko:'데이터도그를 사용합니다.'},
  {en:'Review application settings before integration.',ko:'데이터독API를 사용합니다.'},
  {en:'Use snоwflake for monitoring.',ko:'진행 전에 연결 설정을 확인합니다.'},
 ];
 const a=api();
 for(const variant of variants){
  const before=sdk.mock.calls.length;
  sdk.mockImplementation(async request=>{
   const data=kind==='guide'?{...good(request),overview:variant}:{summary:variant,axes:['reliability','security','cost','operations','performance'].map(axis=>({axis,grade:'medium',rationale:{en:'Review the saved limitations before proceeding.',ko:'진행 전에 저장된 제약을 검토합니다.'},improvement:variant}))};
   return {data,usage};
  });
  expect((await a.post(post(kind),extensionId)).status).toBe(202);
  await tasks.at(-1)!();
  const row=(await store.listExtensionArtifacts(extensionId))[0];
  expect(row).toMatchObject({status:'failed',content:null,error:{code:'validation-failed'}});
  expect(sdk.mock.calls.length-before).toBe(2);
  expect((await db.query('select * from extension_artifact_evidence where artifact_id=$1 and attempt_id=$2',[row.id,row.attemptId])).rows).toHaveLength(0);
  expect((await db.query('select prompt_tokens from llm_calls where source_id=$1',[row.attemptId])).rows).toEqual([{prompt_tokens:22}]);
 }
});
it.each(['guide','evaluation'] as const)('persists useful compositional %s advice with selected references and bilingual proof-backed downloads',async kind=>{
 const operational='review-authentication',recovery='bounded-retries',uncertainty='capacity-unknown';
 sdk.mockImplementation(async request=>{
  expect(request.system).toContain('extend-artifact-prose-v1');
  const data=kind==='guide'?{...good(request),overview:operational,prerequisites:[operational],cautions:[uncertainty],steps:good(request).steps.map(s=>({...s,instructions:[recovery,operational],verification:uncertainty}))}
   :{summary:operational,axes:['reliability','security','cost','operations','performance'].map(axis=>({axis,grade:'medium',rationale:uncertainty,improvement:recovery}))};
  return {data,usage};
 });
 const a=api();expect((await a.post(post(kind),extensionId)).status).toBe(202);await tasks[0]();
 const row=(await store.listExtensionArtifacts(extensionId))[0];expect(row.status).toBe('succeeded');expect(sdk).toHaveBeenCalledTimes(1);
 const proofs=(await db.query<{evidence:{validation:{policyVersion:string}}}>('select evidence from extension_artifact_evidence where artifact_id=$1 and attempt_id=$2',[row.id,row.attemptId])).rows;
 expect(proofs[0].evidence.validation.policyVersion).toBe('extend-artifact-text-v2');
 for(const locale of ['en','ko'] as const){const file=await a.download(extensionId,'low',kind,locale);expect(file.status).toBe(200);expect(await file.text()).toContain(locale==='en'?'authentication':'권한');}
});
it('runs actual17 parent → fake company LLM retry/key rotation → real validators/proof → repeated bilingual downloads without more work',async()=>{
 const a=api();sdk.mockImplementationOnce(async()=>{await saveWorkspaceClaudeSettings(workspaceId,{apiKeyEnv:'CLOUDSIGHT_CLAUDE_KEY_TWO'});return {data:{bad:true},usage};});
 sdk.mockImplementationOnce(async request=>({data:good(request),usage}));
 expect((await a.post(post(),extensionId)).status).toBe(202);expect(tasks).toHaveLength(1);
 expect((await a.post(post(),extensionId)).status).toBe(202);expect(tasks).toHaveLength(1);
 await tasks[0]();const rows=await store.listExtensionArtifacts(extensionId);expect(rows[0].status).toBe('succeeded');
 expect(sdk.mock.calls.map(c=>c[0].apiKeyEnv)).toEqual(['CLOUDSIGHT_CLAUDE_KEY_ONE','CLOUDSIGHT_CLAUDE_KEY_TWO']);
 expect((await db.query('select * from extension_artifact_evidence')).rows).toHaveLength(1);
 const calls=(await db.query<{prompt_tokens:number}>('select * from llm_calls')).rows;expect(calls).toHaveLength(1);expect(calls[0].prompt_tokens).toBe(22);
 await saveWorkspaceClaudeSettings(workspaceId,{apiKeyEnv:null});
 const foreign=api('other');for(const locale of ['en','ko','en'] as const){
  const file=await foreign.download(extensionId,'low','guide',locale);expect(file.status).toBe(200);expect(file.headers.get('Vary')).toBe('Cookie');
  expect(file.headers.get('Content-Disposition')).toContain(locale==='ko'?'guide.ko.md':'guide.md');expect(await file.text()).toContain(locale==='ko'?'무료 한도':'free-grant');
  expect((await foreign.get(extensionId,'low')).status).toBe(200);
 }
 expect(sdk).toHaveBeenCalledTimes(2);expect((await a.post(post(),extensionId)).status).toBe(200);expect(tasks).toHaveLength(1);
});
it('key deletion between preflight and SDK fails closed without global fallback and preserves parent',async()=>{
 const a=api();expect((await a.post(post(),extensionId)).status).toBe(202);await saveWorkspaceClaudeSettings(workspaceId,{apiKeyEnv:null});
 await tasks[0]();expect(sdk).not.toHaveBeenCalled();expect((await store.listExtensionArtifacts(extensionId))[0]).toMatchObject({status:'failed',error:{code:'not-configured'}});
 expect((await parents.getExtension(extensionId))!.status).toBe('succeeded');
 expect((await db.query('select * from llm_calls')).rows).toHaveLength(0);
});
it('runs saved evaluation generation and downloads exactly five advice axes without altering checks',async()=>{
 sdk.mockResolvedValue({data:{summary:'review-saved',axes:['reliability','security','cost','operations','performance'].map(axis=>({axis,grade:'medium',rationale:'capacity-unknown',improvement:'verify-isolated'}))},usage});
 const a=api();expect((await a.post(post('evaluation'),extensionId)).status).toBe(202);await tasks[0]();
 const row=(await store.listExtensionArtifacts(extensionId))[0];expect(row.status).toBe('succeeded');
 expect(row.content?.kind==='evaluation'&&row.content.content.axes).toHaveLength(5);
 for(const locale of ['en','ko'] as const)expect((await a.download(extensionId,'low','evaluation',locale)).status).toBe(200);
 expect(sdk).toHaveBeenCalledTimes(1);expect((await parents.getExtension(extensionId))!.result!.plans[0].checks.some(c=>c.verdict==='unknown')).toBe(true);
});
// Real-compiler contract (docs/SELF_HOSTING.md#native-bicep-compiler): CLOUDSIGHT_TEST_BICEP_PATH names the pinned CLI; unset skips explicitly, a wrong path fails.
const binary=process.env.CLOUDSIGHT_TEST_BICEP_PATH??'';
it.skipIf(!binary).each(['app-service-basic-web-app','app-service-zone-redundant','container-apps-web-api','serverless-static-web-app'])('persists actual %s across all tiers, typed deployment inputs and immutable bilingual downloads',async reference=>{
 const original=(await parents.getExtension(extensionId))!,source=(await parents.getExtensionSourceScan(original.sourceScanId))!;
 const reserved=(await parents.reserveExtension(original.input))!,pending=(await parents.getExtension(reserved.id))!;
 const request=createExtensionRequestContext(pending.input,source.scan,source.inventory,f.context.catalog,{support:f.context.support});
 const raw=structuredClone(f.raw);raw.plans=(['low','balanced','ha'] as const).map(t=>referencePlan(reference,t));
 const result=processExtensionOutput(raw,request,{id:pending.id,createdAt:pending.createdAt});if(!result.ok)throw Error(JSON.stringify(result));
 expect(await parents.completeExtension(pending.id,result.value)).toBe(true);extensionId=pending.id;
 vi.stubEnv('CLOUDSIGHT_BICEP_PATH',binary);sdk.mockImplementation(async request=>({data:{code:JSON.parse(request.user).source},usage}));
 const a=api();for(const tier of ['low','balanced','ha'] as const){expect((await a.post(post('bicep',tier),extensionId)).status).toBe(202);await tasks.at(-1)!();}
 const rows=await store.listExtensionArtifacts(extensionId);expect(rows).toHaveLength(3);expect(rows.every(r=>r.status==='succeeded')).toBe(true);
 for(const row of rows){
  if(row.content?.kind!=='bicep')throw Error('missing-bicep');
  const content=row.content.content,notes=content.deploymentNotes.map(n=>n.en).join('\n');
  for(const p of content.parameters){
   expect(p.description.en).toBeTruthy();expect(p.description.ko).toBeTruthy();
   if(p.name!=='postgresPassword')expect(p.description.en).not.toContain('Administrator password');
  }
  if(content.parameters.some(p=>p.name==='deploymentZones'))expect(notes).toContain('region-verified');
  if(reference==='serverless-static-web-app'){expect(notes).toContain('control-plane');expect(notes).toContain(row.tier==='ha'?'blob-hot-zrs':'blob-hot-lrs');}
  if(reference==='container-apps-web-api')expect(notes).toContain('image');
 }
 const proofs=(await db.query('select * from extension_artifact_evidence')).rows;expect(proofs).toHaveLength(3);expect(sdk).toHaveBeenCalledTimes(3);
 const calls=(await db.query('select * from llm_calls')).rows;expect(calls).toHaveLength(3);
 vi.stubEnv('CLOUDSIGHT_BICEP_PATH','/missing/compiler');await saveWorkspaceClaudeSettings(workspaceId,{apiKeyEnv:null});
 for(const row of rows)for(const locale of ['en','ko'] as const){
  const response=await a.download(extensionId,row.tier,'bicep',locale);expect(response.status).toBe(200);
  if(row.content?.kind!=='bicep')throw Error('kind');expect(parseExtendBicep(await response.text())).toEqual(parseExtendBicep(row.content.content.code));
  expect((await a.post(post('bicep',row.tier),extensionId)).status).toBe(200);
 }
 expect(sdk).toHaveBeenCalledTimes(3);expect(tasks).toHaveLength(3);
},30000);
it.skipIf(!binary)('retains a saved Disabled HA-tier draft when a later catalog offers native HA',async()=>{
 const original=(await parents.getExtension(extensionId))!,source=(await parents.getExtensionSourceScan(original.sourceScanId))!;
 const catalog=structuredClone(f.context.catalog);
 catalog.architectures.find(a=>a.id==='app-service-basic-web-app')!.tiers.ha.deploymentIntent!.postgres={highAvailabilityMode:'Disabled',billingInstancesPerRoot:1};
 parents=createExtensionsDb({db:async()=>db,coreData:{catalog,support:f.context.support}});
 const reserved=(await parents.reserveExtension(original.input))!,pending=(await parents.getExtension(reserved.id))!;
 const request=createExtensionRequestContext(pending.input,source.scan,source.inventory,catalog,{support:f.context.support});
 const result=processExtensionOutput(f.raw,request,{id:pending.id,createdAt:pending.createdAt});if(!result.ok)throw Error(JSON.stringify(result));
 expect(await parents.completeExtension(pending.id,result.value)).toBe(true);extensionId=pending.id;
 context=createExtensionArtifactContextService({...parents,...store});
 vi.stubEnv('CLOUDSIGHT_BICEP_PATH',binary);sdk.mockImplementation(async request=>({data:{code:JSON.parse(request.user).source},usage}));
 const a=api();expect((await a.post(post('bicep','ha'),extensionId)).status).toBe(202);await tasks[0]();
 const row=(await store.listExtensionArtifacts(extensionId))[0];expect(row.status).toBe('succeeded');
 if(row.content?.kind!=='bicep')throw Error('kind');
 const saved=row.content;
 expect(parseExtendBicep(saved.content.code).resources.filter(r=>!r.existing&&r.type.startsWith('Microsoft.DBforPostgreSQL/flexibleServers@'))).toHaveLength(2);
 expect(saved.content.code).toContain("mode: 'Disabled'");expect(saved.content.code).not.toContain('deploymentZones');
 expect(saved.content.deploymentNotes[1].en).toContain('2 independent logical server(s), 2 billed');
 parents=createExtensionsDb({db:async()=>db,coreData:{catalog:f.context.catalog,support:f.context.support}});
 context=createExtensionArtifactContextService({...parents,...store});vi.stubEnv('CLOUDSIGHT_BICEP_PATH','/missing/compiler');await saveWorkspaceClaudeSettings(workspaceId,{apiKeyEnv:null});
 const reopened=api();
 expect((await reopened.post(post('bicep','ha'),extensionId)).status).toBe(200);
 expect((await store.listExtensionArtifacts(extensionId))[0].content).toEqual(saved);
 for(const locale of ['en','ko'] as const){const file=await reopened.download(extensionId,'ha','bicep',locale);expect(file.status).toBe(200);const body=await file.text();expect(parseExtendBicep(body)).toEqual(parseExtendBicep(saved.content.code));expect(body).toContain(saved.content.deploymentNotes[1][locale]);}
 expect(sdk).toHaveBeenCalledTimes(1);expect(tasks).toHaveLength(1);
},30000);
it.skipIf(!binary).each(['low','ha'] as const)('runs saved %s PostgreSQL topology through fake model + actual local CLI then reopens without relabeling',async tier=>{
 vi.stubEnv('CLOUDSIGHT_BICEP_PATH',binary);sdk.mockImplementation(async request=>({data:{code:JSON.parse(request.user).source},usage}));
 const a=api();expect((await a.post(post('bicep',tier),extensionId)).status).toBe(202);await tasks[0]();
 const row=(await store.listExtensionArtifacts(extensionId))[0];expect(row.status).toBe('succeeded');expect(row.content?.kind).toBe('bicep');
 if(row.content?.kind!=='bicep')throw Error();expect(row.content.content.code).toContain("sku:");expect(row.content.content.parameters).toHaveLength(tier==='ha'?2:1);
 expect(row.content.content.deploymentNotes[1].en).toContain('capabilities remain unverified');
 const mode=tier==='ha'?'ZoneRedundant':'Disabled';
 expect(row.content.content.code).toContain(`mode: '${mode}'`);
 expect(row.content.content.deploymentNotes[1].en).toContain(tier==='ha'?'1 logical server(s), 2 billed primary/standby':'1 independent logical server(s), 1 billed');
 const originalCode=row.content.content.code,originalNotes=structuredClone(row.content.content.deploymentNotes);
 vi.stubEnv('CLOUDSIGHT_BICEP_PATH','/missing/compiler');await saveWorkspaceClaudeSettings(workspaceId,{apiKeyEnv:null});
 for(const locale of ['en','ko','en'] as const){const file=await a.download(extensionId,tier,'bicep',locale);expect(file.status).toBe(200);expect(parseExtendBicep(await file.text())).toEqual(parseExtendBicep(originalCode));}
 expect((await a.get(extensionId,tier)).status).toBe(200);expect(sdk).toHaveBeenCalledTimes(1);
 const saved=(await store.listExtensionArtifacts(extensionId))[0];
 expect(saved.content?.kind==='bicep'&&saved.content.content.deploymentNotes).toEqual(originalNotes);
 expect((await db.query('select * from extension_artifact_evidence')).rows).toHaveLength(1);
},30000);

it.skipIf(!binary)('synthetic dry-run: persists counted metered hosts, usage-only egress and exact helper parents without duplicate billed roots',async()=>{
 const fixture=processedFixture();
 for(const p of fixture.raw.plans){
  p.newItems=p.newItems.filter(i=>!i.componentId.startsWith('postgres-flex-'));
  p.reusedResources=p.reusedResources.filter(r=>!['key-vault-operations','log-analytics-ingestion'].includes(r.componentId));p.usageIncreases=[];
  p.newItems.push({componentId:'key-vault-operations',quantity:10,instanceCount:2},{componentId:'log-analytics-ingestion',quantity:25,instanceCount:1},
   {componentId:p.tier==='ha'?'app-service-linux-p0v3':'app-service-linux-b1',quantity:2,instanceCount:2},{componentId:'internet-egress',quantity:100,instanceCount:0});
 }
 const original=(await parents.getExtension(extensionId))!,source=(await parents.getExtensionSourceScan(original.sourceScanId))!;
 const row=(await parents.reserveExtension(original.input))!,pending=(await parents.getExtension(row.id))!;
 const ctx=createExtensionRequestContext(pending.input,source.scan,source.inventory,fixture.context.catalog,{support:fixture.context.support});
 const result=processExtensionOutput(fixture.raw,ctx,{id:row.id,createdAt:pending.createdAt});if(!result.ok)throw Error(JSON.stringify(result));
 expect(await parents.completeExtension(row.id,result.value)).toBe(true);extensionId=row.id;
 vi.stubEnv('CLOUDSIGHT_BICEP_PATH',binary);sdk.mockImplementation(async request=>({data:{code:JSON.parse(request.user).source},usage}));
 const a=api();expect((await a.post(post('bicep','ha'),extensionId)).status).toBe(202);await tasks[0]();
 const artifact=(await store.listExtensionArtifacts(extensionId))[0];expect(artifact.status).toBe('succeeded');
 if(artifact.content?.kind!=='bicep')throw Error('bicep-missing');
 const resources=parseExtendBicep(artifact.content.content.code).resources;
 const count=(type:string)=>resources.filter(r=>!r.existing&&r.type.split('@')[0]===type).length;
 expect(count('Microsoft.KeyVault/vaults')).toBe(2);expect(count('Microsoft.OperationalInsights/workspaces')).toBe(1);
 expect(count('Microsoft.Web/serverfarms')).toBe(1);expect(count('Microsoft.Web/sites')).toBe(2);expect(count('Microsoft.Insights/components')).toBe(1);
 expect(resources).toHaveLength(11); // two existing, four billed roots, two network, three allowed helpers
 const names=resources.filter(r=>!r.existing).map(r=>r.body.properties.name);expect(new Set(names).size).toBe(names.length);
 const cost=result.value.plans[2].incrementalCost;if(cost.state!=='available')throw Error('cost-missing');
 expect(cost.data.lines.filter(l=>l.componentId==='key-vault-operations')).toMatchObject([{kind:'new',quantity:10}]);
 expect(cost.data.lines.filter(l=>l.componentId==='log-analytics-ingestion')).toMatchObject([{kind:'new',quantity:25}]);
 const request=JSON.parse(sdk.mock.calls[0][0].user);
 expect(request.usageAssumptions).toEqual(expect.arrayContaining([{componentId:'internet-egress',quantity:100,kind:'new'},{componentId:'key-vault-operations',quantity:10,kind:'new'}]));
 expect((await a.download(extensionId,'ha','bicep','en')).status).toBe(200);expect((await db.query('select * from llm_calls')).rows).toHaveLength(1);
},30000);

it.each(['foreign-component','foreign-id','url','private-source','existing-overwrite','secret-default'] as const)('rejects %s through the real saved pipeline after one retry, retaining known billing and parent',async attack=>{
 sdk.mockImplementation(async request=>{
  if(attack==='existing-overwrite')return {data:{code:JSON.parse(request.user.split('\n<validation_errors>')[0]).source.replace(' existing =',' =')},usage};
  if(attack==='secret-default')return {data:{code:JSON.parse(request.user.split('\n<validation_errors>')[0]).source.replace('param postgresPassword string',"param postgresPassword string = 'synthetic-private-value'")},usage};
  const output=good(request);
  if(attack==='foreign-component')output.steps[0].componentIds.push('unapproved-compute');
  if(attack==='foreign-id')output.steps[0].reusedResourceIds.push('r999999');
  if(attack==='url')output.overview='Read https://attacker.invalid/run before proceeding.';
  if(attack==='private-source')output.overview='Attach sample-vault before proceeding.';
  return {data:output,usage};
 });
 const a=api(),kind=attack==='existing-overwrite'||attack==='secret-default'?'bicep':'guide';
 expect((await a.post(post(kind),extensionId)).status).toBe(202);await tasks[0]();
 const [row]=await store.listExtensionArtifacts(extensionId);
 expect(row).toMatchObject({status:'failed',content:null,error:{code:'validation-failed'},usage:{promptTokens:22,completionTokens:12,costUsd:0.02}});
 expect(sdk).toHaveBeenCalledTimes(2);expect((await db.query('select * from extension_artifact_evidence')).rows).toHaveLength(0);
 expect((await db.query('select * from llm_calls')).rows).toHaveLength(1);expect((await parents.getExtension(extensionId))!.status).toBe('succeeded');
 expect((await a.download(extensionId,'low',kind,'en')).status).toBe(404);
});

it('does not overwrite a renewed attempt with an in-flight old success or failure, but bills its late final aggregate exactly once',async()=>{
 let release!:()=>void,start!:()=>void;const started=new Promise<void>(resolve=>{start=resolve;});
 sdk.mockImplementationOnce(request=>new Promise(resolve=>{release=()=>resolve({data:good(request),usage});start();}));
 const a=api();expect((await a.post(post(),extensionId)).status).toBe(202);const running=tasks[0]();await started;
 const old=(await store.listExtensionArtifacts(extensionId))[0];
 expect(await store.failExtensionArtifact(old.id,old.attemptId,'timeout',null)).toBe(true);
 expect((await a.post(post(),extensionId)).status).toBe(202);expect(tasks).toHaveLength(2);
 const fresh=(await store.listExtensionArtifacts(extensionId))[0];expect(fresh.id).toBe(old.id);expect(fresh.attemptId).not.toBe(old.attemptId);
 release();await running;
 expect(await store.failExtensionArtifact(old.id,old.attemptId,'internal',usage)).toBe(false);
 expect((await store.getExtensionArtifact(old.id))!.status).toBe('pending');
 sdk.mockImplementationOnce(async request=>({data:good(request),usage}));await tasks[1]();
 expect((await store.getExtensionArtifact(old.id))!).toMatchObject({status:'succeeded',attemptId:fresh.attemptId,usage:{promptTokens:22,completionTokens:12,costUsd:0.02}});
 expect((await db.query('select * from extension_artifact_evidence')).rows).toHaveLength(1);expect((await db.query('select * from llm_calls')).rows).toHaveLength(2);
});

it('refuses corrupted saved content on both GET and download without regeneration or private error details',async()=>{
 sdk.mockImplementation(async request=>({data:good(request),usage}));const a=api();
 await a.post(post(),extensionId);await tasks[0]();const [row]=await store.listExtensionArtifacts(extensionId);
 await db.query("update extension_artifacts set content=jsonb_set(content,'{content,overview,en}','\"Corrupted saved explanation\"') where id=$1",[row.id]);
 for(const response of [await a.get(extensionId,'low'),await a.download(extensionId,'low','guide','en')]){
  expect(response.status).toBe(500);expect(await response.json()).toEqual({code:'internal'});
 }
 expect(sdk).toHaveBeenCalledTimes(1);
});

it.skipIf(!binary).each(['partial','unavailable'] as const)('synthetic dry-run: preserves %s price, source coverage and unknown checks through saved all-kind downloads',async state=>{
 const fixture=processedFixture(),catalog=structuredClone(fixture.context.catalog),support=structuredClone(fixture.context.support);
 // A valid fixed snapshot with no verified paid tier cannot price new/increased ingestion.
 for(const price of Object.values(catalog.prices.prices['log-analytics-ingestion']))for(const tier of price.tiers)tier.unitPrice=0;
 const original=(await parents.getExtension(extensionId))!,source=(await parents.getExtensionSourceScan(original.sourceScanId))!;
 if(state==='unavailable')for(const plan of fixture.raw.plans){
  plan.reusedResources=[];plan.usageIncreases=[];plan.subnetProposals=[];
  plan.newItems=[{componentId:'log-analytics-ingestion',quantity:5,instanceCount:1}];
 }
 parents=createExtensionsDb({db:async()=>db,coreData:{catalog,support}});
 const row=(await parents.reserveExtension(original.input))!,pending=(await parents.getExtension(row.id))!;
 const ctx=createExtensionRequestContext(pending.input,source.scan,source.inventory,catalog,{support});
 const result=processExtensionOutput(fixture.raw,ctx,{id:row.id,createdAt:pending.createdAt});if(!result.ok)throw Error(JSON.stringify(result));
 expect(result.value.plans[0].incrementalCost.state).toBe(state);
 expect(await parents.completeExtension(row.id,result.value)).toBe(true);extensionId=row.id;
 context=createExtensionArtifactContextService({...parents,...store});vi.stubEnv('CLOUDSIGHT_BICEP_PATH',binary);
 sdk.mockImplementation(async request=>{
  const payload=JSON.parse(request.user);
  if(request.schemaName==='extension_bicep_source')return {data:{code:payload.source},usage};
  expect(payload.cost).toMatchObject({state,reasonCodes:['price-unavailable']});
  return {data:request.schemaName==='extension_guide_plan_v1'?good(request):{summary:'review-saved',axes:['reliability','security','cost','operations','performance'].map(axis=>({axis,grade:'low',rationale:'capacity-unknown',improvement:'verify-isolated'}))},usage};
 });
 const a=api();
 for(const kind of ['guide','evaluation','bicep'] as const){expect((await a.post(post(kind),extensionId)).status).toBe(202);await tasks.at(-1)!();}
 const data=await (await a.get(extensionId,'low')).json();expect(data.basis.cost).toEqual(result.value.plans[0].incrementalCost);
 expect(data.basis.source.completeness.reasons).toContain('import-scope-unverified');
 for(const row of data.artifacts)expect(row.status).toBe('succeeded');
 for(const kind of ['guide','evaluation','bicep'] as const)for(const locale of ['en','ko'] as const){
  const response=await a.download(extensionId,'low',kind,locale);expect(response.status).toBe(200);const body=await response.text();
  expect(body).toContain(createTranslator(locale)('extension.reasons.price-unavailable'));expect(body).toContain(data.basis.sourceScanId);
  expect(body).toContain(createTranslator(locale)('extension.reasons.capacity-unverified'));
 }
 expect(sdk).toHaveBeenCalledTimes(3);expect((await db.query('select * from extension_artifact_evidence')).rows).toHaveLength(3);
},30000);

it.skipIf(!binary).each(['low','balanced','ha'] as const)('synthetic dry-run: saved %s option → all three kinds → real semantics/compiler → immutable bilingual downloads',async tier=>{
 vi.stubEnv('CLOUDSIGHT_BICEP_PATH',binary);
 const before=(await parents.getExtension(extensionId))!.result!;
 const plan=before.plans.find(p=>p.tier===tier)!;
 sdk.mockImplementation(async request=>{
  // Validate the actual SDK request, including retry boundaries, rather than a parallel context builder.
  for(const value of [extensionId,workspaceId,before.sourceScanId,'/subscriptions/','sample-rg','sample-vnet','sample-plan','sample-vault','sample-logs','10.1.','10.2.'])
   expect(request.user).not.toContain(value);
  const payload=JSON.parse(request.user);
  if(request.schemaName==='extension_bicep_source')return {data:{code:payload.source},usage};
  expect(payload.sourceScan.completeness.reasons).toContain('import-scope-unverified');
  expect(payload.cost.freeGrantAssumption).toBe('unverified-shared-free-grants-not-deducted');
  expect(payload.checks).toEqual(expect.arrayContaining([expect.objectContaining({kind:'capacity',verdict:'unknown'}),expect.objectContaining({kind:'path',verdict:'unknown'})]));
  return {data:request.schemaName==='extension_guide_plan_v1'?good(request):{summary:'review-saved',axes:['reliability','security','cost','operations','performance'].map(axis=>({axis,grade:'medium',rationale:'capacity-unknown',improvement:'verify-isolated'}))},usage};
 });
 const a=api();
 for(const kind of ['guide','evaluation','bicep'] as const){
  const responses=await Promise.all([a.post(post(kind,tier),extensionId),a.post(post(kind,tier),extensionId)]);
  expect(responses.map(r=>r.status)).toEqual([202,202]);
 }
 expect(tasks).toHaveLength(3);await Promise.all(tasks.map(task=>task()));
 const rows=await store.listExtensionArtifacts(extensionId,{tier});
 expect(rows).toHaveLength(3);expect(rows.map(r=>[r.kind,r.status,r.error])).toEqual(expect.arrayContaining(['guide','evaluation','bicep'].map(kind=>[kind,'succeeded',null])));
 const bicep=rows.find(r=>r.kind==='bicep')!.content!;if(bicep.kind!=='bicep')throw Error('kind');
 expect(bicep.content.existingResourceIds.sort()).toEqual(plan.reusedResources.map(r=>r.resourceId).sort());
 // Existing hosts remain references. Ingestion/operation units create no extra billed hosts.
 expect(bicep.content.code.match(/ existing = /g)).toHaveLength(4);
 expect(bicep.content.code.match(/Microsoft\.DBforPostgreSQL\/flexibleServers@/g)).toHaveLength(1);
 expect(bicep.content.code.match(/Microsoft\.Web\/sites@/g)).toHaveLength(1);
 expect(bicep.content.code.match(/Microsoft\.Insights\/components@/g)).toHaveLength(1);
 expect(bicep.content.code).not.toMatch(/Microsoft\.(?:KeyVault\/vaults|OperationalInsights\/workspaces)@[^\n]+(?<!existing) =/);
 expect(bicep.content.code).toContain(tier==='ha'?'10.2.0.0/16':'10.1.1.0/24');
 expect(bicep.content.code.match(tier==='ha'?/if \(deploymentEnabled\)/g:/if \(deploymentTargetMatches\)/g)).toHaveLength(tier==='ha'?5:4);
 const evaluation=rows.find(r=>r.kind==='evaluation')!.content!;
 expect(evaluation.kind==='evaluation'&&new Set(evaluation.content.axes.map(a=>a.axis)).size).toBe(5);
 const proof=(await db.query<{evidence:unknown}>('select evidence from extension_artifact_evidence order by artifact_id')).rows;
 expect(proof).toHaveLength(3);expect(JSON.stringify(proof)).toContain('bicep-0.49.2');
 const calls=(await db.query<{source_id:string;prompt_tokens:number}>('select source_id,prompt_tokens from llm_calls')).rows;
 expect(calls).toHaveLength(3);expect(new Set(calls.map(c=>c.source_id))).toEqual(new Set(rows.map(r=>r.attemptId)));
 const files=new Map<string,string>();
 for(const kind of ['guide','evaluation','bicep'] as const)for(const locale of ['en','ko'] as const){
  const response=await a.download(extensionId,tier,kind,locale);expect(response.status).toBe(200);const file=await response.text();files.set(kind+locale,file);
  if(kind==='bicep')expect(parseExtendBicep(file)).toEqual(parseExtendBicep(bicep.content.code));
 }
 const loader=await import('@/lib/catalog/load'),engine=await import('@/lib/extend/process');
 vi.spyOn(loader,'loadCatalog').mockImplementation(()=>{throw Error('current catalog unavailable');});
 vi.spyOn(engine,'processExtensionOutput').mockImplementation(()=>{throw Error('current engine changed');});
 vi.stubEnv('CLOUDSIGHT_BICEP_PATH','/missing/compiler');await saveWorkspaceClaudeSettings(workspaceId,{apiKeyEnv:null});
 const validator=vi.fn(async()=>{throw Error('must not regenerate');});
 store=createExtensionArtifactsDb({db:async()=>db,validateArtifact:validator});parents=createExtensionsDb({db:async()=>db});
 const reopened=api('different-current-workspace');
 const data=await (await reopened.get(extensionId,tier)).json();
 expect(data.basis.cost).toEqual(plan.incrementalCost);expect(data.basis.coverage).toEqual(before.contextCoverage);
 expect(data.basis.source).toEqual(before.sourceScan);
 const serialized=JSON.stringify(data);for(const key of ['attemptId','saved_evidence','basisDigest','contentDigest','aliasToResourceId','inventory'])expect(serialized).not.toContain(`"${key}"`);
 for(const kind of ['guide','evaluation','bicep'] as const)for(const locale of ['en','ko'] as const){
  const response=await reopened.download(extensionId,tier,kind,locale);expect(response.status).toBe(200);expect(await response.text()).toBe(files.get(kind+locale));
 }
 expect((await parents.getExtension(extensionId))!.result).toEqual(before);expect(validator).not.toHaveBeenCalled();expect(sdk).toHaveBeenCalledTimes(3);
 expect((await db.query('select evidence from extension_artifact_evidence order by artifact_id')).rows).toEqual(proof);
},30000);
it.each(['missing','version','configuration','compile-failed','template-mismatch','missing-terminal-failure'] as const)('classifies %s after preflight through the actual job/store, with one bill and no proof',async change=>{
 const root=await mkdtemp(join(tmpdir(),'cloudsight-preflight-race-')),executable=join(root,'bicep');
 try{
  await writeFile(executable,`#!${process.execPath}\nconsole.log('Bicep CLI version 0.49.2 (b34271ac51)');`,{mode:0o700});
  vi.stubEnv('CLOUDSIGHT_BICEP_PATH',executable);
  sdk.mockImplementation(async request=>{
   if(change==='missing'||change==='missing-terminal-failure')await rm(executable);
   else if(change==='version')await writeFile(executable,`#!${process.execPath}\nconsole.log('Bicep CLI version 0.1.0 (unknown)');`);
   else if(change==='configuration')vi.stubEnv('CLOUDSIGHT_BICEP_PATH','relative/bicep');
   else await writeFile(executable,`#!${process.execPath}\nif(process.argv[2]==='--version')console.log('Bicep CLI version 0.49.2 (b34271ac51)');else ${change==='compile-failed'?'process.exit(1);':"console.log('{}');"}`);
   return {data:{code:JSON.parse(request.user).source},usage};
  });
  if(change==='missing-terminal-failure')await db.exec(`
   create sequence compiler_terminal_fail_once;
   create function compiler_terminal_fail_once_fn() returns trigger language plpgsql as $$ begin
    if nextval('compiler_terminal_fail_once')=1 then raise exception 'synthetic transient terminal write'; end if;
    return new;
   end $$;
   create trigger compiler_terminal_fail_once before update of status on extension_artifacts
    for each row execute function compiler_terminal_fail_once_fn();
  `);
  const a=api();expect((await a.post(post('bicep'),extensionId)).status).toBe(202);await tasks[0]();
  const row=(await store.listExtensionArtifacts(extensionId))[0];
  const code=change==='compile-failed'||change==='template-mismatch'?'validation-failed':'compiler-unavailable';
  expect(row).toMatchObject({status:'failed',content:null,error:{schemaVersion:1,code},usage});
  expect(sdk).toHaveBeenCalledTimes(1);
  expect((await db.query('select * from extension_artifact_evidence')).rows).toHaveLength(0);
  expect((await db.query('select prompt_tokens from llm_calls where source_id=$1',[row.attemptId])).rows).toEqual([{prompt_tokens:11}]);
  expect(await store.failExtensionArtifact(row.id,row.attemptId,code,usage)).toBe(false);
  expect((await db.query('select * from llm_calls')).rows).toHaveLength(1);
  expect((await a.get(extensionId,'low')).status).toBe(200);
 }finally{await rm(root,{recursive:true,force:true});}
});

it.each([false,true])('synthetic storage probe preserves internal failure, usage once and no proof (fail terminal once=%s)',async failTerminalOnce=>{
 await db.exec(`
  create sequence storage_status_attempt;
  create function storage_status_probe() returns trigger language plpgsql as $$ begin
   if new.status='succeeded' or new.status='failed' and ${failTerminalOnce ? "nextval('storage_status_attempt')=1" : 'false'} then
    raise exception 'synthetic terminal storage failure';
   end if;
   return new;
  end $$;
  create trigger storage_probe before update of status on extension_artifacts
   for each row execute function storage_status_probe();
 `);
 sdk.mockImplementation(async request=>({data:good(request),usage}));
 const a=api();expect((await a.post(post(),extensionId)).status).toBe(202);await tasks[0]();
 const row=(await store.listExtensionArtifacts(extensionId))[0];
 expect(row).toMatchObject({status:'failed',error:{code:'internal'},content:null,usage});
 expect(sdk).toHaveBeenCalledTimes(1);
 expect((await db.query('select * from extension_artifact_evidence')).rows).toHaveLength(0);
 // A fresh adapter simulates a restart; the persisted attempt ledger owns idempotence.
 const restarted=createExtensionArtifactsDb({db:async()=>db,validateArtifact:validateExtensionArtifact});
 expect(await restarted.failExtensionArtifact(row.id,row.attemptId,'internal',usage)).toBe(false);
 expect((await db.query('select prompt_tokens from llm_calls where source_id=$1',[row.attemptId])).rows).toEqual([{prompt_tokens:11}]);
 expect((await restarted.getExtensionArtifact(row.id))?.usage).toEqual(usage);
});
