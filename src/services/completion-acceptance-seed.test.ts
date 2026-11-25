// @vitest-environment node
import {afterEach,expect,it,vi} from 'vitest';
import {readFile,rm,mkdtemp,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {PGlite} from '@electric-sql/pglite';
import {seedCompletionAcceptanceV1} from './completion-acceptance-seed.test-data';
import {createAssessmentsDb} from './db/assessments';
import {createAssessmentRoadmapsDb} from './db/assessment-roadmaps';
import {createExtensionsDb} from './db/extensions';
import {createExtensionArtifactsDb} from './db/extension-artifacts';
import {createNetworkDiagnosticsDb} from './db/network-diagnostics';
import {createAssessmentReportService} from './assessment-roadmap-report';
const cleanup:string[]=[];
afterEach(async()=>{vi.restoreAllMocks();vi.unstubAllEnvs();for(const path of cleanup.splice(0))await rm(path,{recursive:true,force:true});});
it.each([[],['--target','/company/data'],['--new','/existing/data'],['--new','--new']].map(args=>({args})))('refuses non-exclusive invocation %j before opening any DB',async ({args})=>{
 await expect(seedCompletionAcceptanceV1(args)).rejects.toThrow('acceptance-seed-new-only');
});
it('refuses an inherited data directory, even when --new is requested',async()=>{
 const target=await mkdtemp(join(tmpdir(),'seed-refusal-'));cleanup.push(target);
 await writeFile(join(target,'sentinel'),'existing fixture/company directory');
 vi.stubEnv('CLOUDSIGHT_DATA_DIR',target);
 await expect(seedCompletionAcceptanceV1(['--new'])).rejects.toThrow('acceptance-seed-existing-environment');
 expect(await readFile(join(target,'sentinel'),'utf8')).toBe('existing fixture/company directory');
});
it.skipIf(!process.env.CLOUDSIGHT_TEST_BICEP_PATH)('creates a versioned fresh synthetic fixture DB with real saved proof/compiler and read-only bilingual reopen',async()=>{
 vi.stubEnv('CLOUDSIGHT_DATA_DIR','');
 vi.stubEnv('CLOUDSIGHT_BICEP_PATH',process.env.CLOUDSIGHT_TEST_BICEP_PATH!);
 const network=vi.spyOn(globalThis,'fetch').mockRejectedValue(Error('external I/O forbidden'));
 const manifest=await seedCompletionAcceptanceV1(['--new']);cleanup.push(manifest.directory);
 expect(manifest.fixtureVersion).toBe('cloudsight-completion-acceptance-v1');
 expect(manifest.dataDirectory).toBe(join(manifest.directory,'data'));
 expect(manifest.compilerVersion).toBe('0.49.2 (b34271ac51)');
 expect(JSON.parse(await readFile(join(manifest.directory,'manifest.json'),'utf8'))).toEqual(manifest);
 const db=new PGlite(manifest.dataDirectory);const deps={db:async()=>db};
 try{
  const assessments=createAssessmentsDb(deps),roadmaps=createAssessmentRoadmapsDb(deps);
  const record=(await roadmaps.getAssessmentRoadmap(manifest.ids.assessment))!;
  expect(record.status).toBe('succeeded');expect(record.roadmap.status).toBe('succeeded');
  expect(record.result!.local.findings.some(f=>f.verdict==='unknown')).toBe(true);
  expect(record.result!.local.findings.some(f=>f.verdict==='violation')).toBe(true);
  expect(record.result!.diff.state).toBe('available');
  const cost=(await assessments.getAssessment(manifest.ids.insights))!.result!.actualCost.monthToDate;
  expect(cost.state).toBe('available');
  if(cost.state!=='available')throw Error('fixture-cost');
  expect(cost.data.rows.map(r=>[r.currency,r.amount])).toEqual([['CAD',0],['USD',5],['USD',-2]]);
  expect(cost.data.totals.map(r=>[r.currency,r.amount])).toEqual([['CAD',0],['USD',3]]);
  const partial=(await assessments.getAssessment(manifest.ids.partialAssessment))!.result!;
  expect(partial.diff.state).toBe('partial');
  if(partial.diff.state!=='partial')throw Error('fixture-partial-diff');
  expect(partial.diff.data.changes.some(change=>change.kind==='unknown')).toBe(true);
  expect(partial.advisor.state).toBe('partial');
  if(partial.advisor.state!=='partial')throw Error('fixture-partial-advisor');
  expect(partial.advisor.data.recommendations).toHaveLength(1);
  expect(partial.advisor.data.coverage.reasons).toContainEqual({code:'unmapped-advisor-type',count:1});
  expect((await roadmaps.getAssessmentRoadmap(manifest.ids.roadmapFailed))!.roadmap.status).toBe('failed');
  const diagnostics=createNetworkDiagnosticsDb(deps);
  for(const verdict of ['allowed','blocked','unknown'] as const)expect((await diagnostics.getNetworkDiagnostic(manifest.ids.network[verdict]))!.result!.engine.verdict).toBe(verdict);
  const parent=(await createExtensionsDb(deps).getExtension(manifest.ids.extension))!;
  expect(parent.workspaceId).toBe(manifest.ids.workspace);expect(parent.result!.plans).toHaveLength(3);
  const constraints=(await createExtensionsDb(deps).getExtension(manifest.ids.constraintsExtension))!.result!;
  expect(constraints.plans[0].checks.find(c=>c.kind==='cidr')?.verdict).toBe('violation');
  expect(constraints.plans[1].checks.find(c=>c.kind==='cidr')?.verdict).toBe('violation');
  expect(constraints.plans.every(p=>p.checks.some(c=>c.kind==='capacity'&&c.verdict==='unknown'))).toBe(true);
  for(const id of Object.values(manifest.ids.extensionFailures))expect(await createExtensionsDb(deps).getExtension(id))
   .toMatchObject({status:'failed',result:null,error:{code:'validation-failed'}});
  const artifacts=createExtensionArtifactsDb(deps);
  expect((await artifacts.listExtensionArtifacts(parent.id)).filter(a=>a.status==='succeeded')).toHaveLength(9);
  vi.stubEnv('CLOUDSIGHT_BICEP_PATH','/missing/compiler');
  for(const locale of ['en','ko'] as const)expect(await createAssessmentReportService(deps).get(record.id,locale)).toBeTruthy();
  expect((await artifacts.listExtensionArtifacts(parent.id)).filter(a=>a.status==='succeeded')).toHaveLength(9);
  expect((await db.query('select * from llm_calls')).rows).toHaveLength(0);
  expect((await db.query<{claude_api_key_env:string|null}>('select claude_api_key_env from workspaces')).rows.every(r=>r.claude_api_key_env===null)).toBe(true);
  expect(network).not.toHaveBeenCalled();
 }finally{await db.close();network.mockRestore();}
},60000);
