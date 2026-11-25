// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdtemp, writeFile, readdir, rm, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { compilerFixture, existingChildCompilerFixture } from '@/lib/extend-artifacts/compiler.test-data';
import { createArtifactTextContext, validateArtifactTextOutput } from '@/lib/extend-artifacts/guide-evaluation';
import { createExtensionArtifactCompiler, ExtensionArtifactCompilerError } from './extension-artifact-compiler';

// Real-compiler contract (docs/SELF_HOSTING.md#native-bicep-compiler): CLOUDSIGHT_TEST_BICEP_PATH names the pinned CLI; unset skips explicitly, a wrong path fails.
const realBinary = process.env.CLOUDSIGHT_TEST_BICEP_PATH ?? '';
let root: string;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'cloudsight-compiler-test-')); });
afterEach(async () => { vi.unstubAllEnvs(); vi.restoreAllMocks(); await rm(root, { recursive: true, force: true }); });
async function fake(body: string, version = "console.log('Bicep CLI version 0.49.2 (b34271ac51)');") {
  const executable = join(root, 'test compiler');
  await writeFile(executable, `#!${process.execPath}\nif(process.argv[2]==='--version'){${version}}else{${body}}`, { mode: 0o700 });
  return executable;
}
const compile = (executable: string, extra = {}) => createExtensionArtifactCompiler({ executable, tempRoot: root, ...extra });
const remaining = () => readdir(root);
describe('bounded offline Bicep process service', () => {
  it('preflights the pinned CLI without source files or build and rechecks changed configuration', async () => {
    const report = join(root, 'version-env.json');
    const executable = await fake("throw Error('build must not run');", `require('fs').writeFileSync(${JSON.stringify(report)},JSON.stringify({args:process.argv.slice(2),env:process.env,cwd:process.cwd()}));console.log('Bicep CLI version 0.49.2 (b34271ac51)');`);
    vi.stubEnv('CLOUDSIGHT_COMPANY_SECRET', 'never inherit');
    vi.stubEnv('CLOUDSIGHT_BICEP_PATH', executable);
    const service = createExtensionArtifactCompiler({tempRoot:root});
    await service.checkAvailability();
    const observed = JSON.parse(await readFile(report, 'utf8'));
    expect(observed.args).toEqual(['--version']);
    expect(observed.env.CLOUDSIGHT_COMPANY_SECRET).toBeUndefined();
    expect(observed.env.PATH).toBe('/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin');
    expect((await remaining()).sort()).toEqual(['test compiler','version-env.json']);
    vi.stubEnv('CLOUDSIGHT_BICEP_PATH', join(root,'missing'));
    await expect(service.checkAvailability()).rejects.toMatchObject({code:'compiler-unavailable'});
    for(const value of ['relative/bicep','bicep --version','/bin/bicep\n']) {
      vi.stubEnv('CLOUDSIGHT_BICEP_PATH',value);
      await expect(service.checkAvailability()).rejects.toMatchObject({code:'configuration'});
    }
  });
  it.each(['wrong-version','timeout','output-limit','nonzero'] as const)('bounds and sanitizes %s availability failures', async mode => {
    const version = mode==='wrong-version'?"console.log('Bicep CLI version 0.1.0 (unknown)');":mode==='timeout'?'setInterval(()=>{},1000);':mode==='output-limit'?"process.stdout.write('x'.repeat(4096));setInterval(()=>{},1000);":"console.error('/private/company secret');process.exit(1);";
    const executable = await fake("throw Error('build must not run');",version);
    // 오류 분류 검사는 병렬 실행의 Node 시작 지연과 분리한다. 짧은 기한은 hang 사례에서만 검증한다.
    const error = await compile(executable,{timeoutMs:mode==='timeout'?200:5000}).checkAvailability().catch(e=>e);
    expect(error).toBeInstanceOf(ExtensionArtifactCompilerError);
    expect(error.code).toBe(mode==='wrong-version'?'compiler-version':mode==='nonzero'?'compiler-unavailable':mode);
    expect(String(error)+JSON.stringify(error)).not.toMatch(/private|company|secret|test compiler/);
    expect(await remaining()).toEqual(['test compiler']);
  });
  it.skipIf(!realBinary)('preflights the actual pinned CLI offline', async () => {
    await compile(realBinary).checkAvailability();
    expect(await remaining()).toEqual([]);
  });
  it.each(['guide', 'evaluation'] as const)('preserves the real %s semantic validator without needing a compiler', async kind => {
    const f = compilerFixture(), binding = { ...f.binding, kind };
    const context = createArtifactTextContext(binding, f.basis);
    const text = { en: 'Review the saved configuration before integration.', ko: '연결 전에 저장된 구성을 검토합니다.' };
    const raw = kind === 'guide' ? { overview: text, prerequisites: [text], cautions: [text], steps: [{ title: text, goal: text,
      instructions: [text], componentIds: context.payload.components.map(c => c.id), reusedResourceIds: context.payload.reusedResources.map(r => r.alias), verification: text }] }
      : { summary: text, axes: ['reliability', 'security', 'cost', 'operations', 'performance'].map(axis => ({ axis, grade: 'medium', rationale: text, improvement: text })) };
    const out = validateArtifactTextOutput(raw, context); if (!out.ok) throw Error(JSON.stringify(out));
    expect(await compile('/missing/compiler').validateArtifact(out.value, f.basis)).toEqual({ policyVersion: 'extend-artifact-text-v2' });
    expect(await remaining()).toEqual([]);
  });
  it.skipIf(!realBinary)('compiles an actual17 synthetic mixed existing/new, scope, parent, exact SKU/count/CIDR plan using real CLI', async () => {
    const f = compilerFixture();
    const service = compile(realBinary);
    const proof = await service.validateArtifact(f.artifact, f.basis);
    expect(proof).toEqual({ policyVersion: 'extend-bicep-source-arm-v1', compilerVersion: 'bicep-0.49.2-b34271ac51-arm-0.49.2.45890' });
    expect(await remaining()).toEqual([]);
  }, 30000);
  it.skipIf(!realBinary)('compiles a guarded default-scope existing parent with new child at the exact saved target', async () => {
    const f = compilerFixture('low');
    expect(await compile(realBinary).validateArtifact(f.artifact, f.basis)).toMatchObject({policyVersion:'extend-bicep-source-arm-v1'});
    expect(await remaining()).toEqual([]);
  }, 30000);
  it.skipIf(!realBinary)('compiles an existing child with its exact ancestor in another subscription/group beside a new IP', async () => {
    const f = existingChildCompilerFixture();
    expect(f.bound.program.resources.filter(r => r.existing)).toHaveLength(2);
    expect(await compile(realBinary).compile(f.bound.code, f.context)).toMatchObject({ policyVersion: 'extend-bicep-source-arm-v1' });
    expect(await remaining()).toEqual([]);
  }, 30000);
  it.skipIf(!realBinary)('handles real CLI syntax errors even when the pure source parser recognizes equivalent tokens', async () => {
    const f = compilerFixture();
    const missingNewlines = f.bound.code.split('\n').slice(1).join(' ');
    await expect(compile(realBinary).compile(missingNewlines, f.context)).rejects.toMatchObject({ code: 'compile-failed' });
    expect(await remaining()).toEqual([]);
  }, 30000);
  it('rejects module/load/import/loops/conditions/nested declarations before even creating a temp folder or spawning version', async () => {
    const executable = await fake("throw Error('must not run');", `require('fs').writeFileSync(${JSON.stringify(join(root, 'spawned'))}, 'bad');`);
    const f = compilerFixture();
    for (const suffix of ["module x 'br:evil' = {}", "var x = loadTextContent('secret')", "import * as x from './private.bicep'", "resource x 'Microsoft.Web/sites@2024-04-01' = [for i in range(0,100): {}]", "resource x 'Microsoft.Web/sites@2024-04-01' = if(true) {}", "resource x 'Microsoft.Web/sites@2024-04-01' = { resource child 'slots@2024-04-01' = {} }"])
      await expect(compile(executable).compile(f.bound.code + '\n' + suffix, f.context)).rejects.toMatchObject({ code: 'unsafe-source' });
    for (const code of [f.bound.code.replace("'sample-plan'", "'different-plan'"), 'x'.repeat(60001), '// ' + '한'.repeat(21000)])
      await expect(compile(executable).compile(code, f.context)).rejects.toMatchObject({ code: 'unsafe-source' });
    expect(await remaining()).toEqual(['test compiler']);
  });
  it('keeps compiler diagnostics/paths/source out of errors and cleans temporary files after syntax failure', async () => {
    const executable = await fake("console.error('BCP001 /private/company source key secret'); process.exit(1);");
    const f = compilerFixture();
    const error = await compile(executable).compile(f.bound.code, f.context).catch(e => e);
    expect(error).toBeInstanceOf(ExtensionArtifactCompilerError); expect(error.code).toBe('compile-failed');
    expect(String(error) + JSON.stringify(error)).not.toMatch(/private|company|secret|sample|test compiler/);
    expect(error.cause).toBeUndefined(); expect(await remaining()).toEqual(['test compiler']);
  });
  it('handles missing binary and unsupported versions without attempting a build', async () => {
    const f = compilerFixture();
    await expect(compile(join(root, 'missing')).compile(f.bound.code, f.context)).rejects.toMatchObject({ code: 'compiler-unavailable' });
    const executable = await fake("require('fs').writeFileSync('built', 'bad');", "console.log('Bicep CLI version 0.1.0 (unknown)');");
    await expect(compile(executable).compile(f.bound.code, f.context)).rejects.toMatchObject({ code: 'compiler-version' });
    expect(await remaining()).toEqual(['test compiler']);
  });
  it.each(['version', 'build'])('kills a hung %s process at the shared deadline and cleans up', async stage => {
    const hang = 'setInterval(()=>{},1000);';
    const executable = await fake(hang, stage === 'version' ? hang : undefined);
    const f = compilerFixture(), start = Date.now();
    await expect(compile(executable, { timeoutMs: 150 }).compile(f.bound.code, f.context)).rejects.toMatchObject({ code: 'timeout' });
    expect(Date.now() - start).toBeLessThan(3000); expect(await remaining()).toEqual(['test compiler']);
  });
  it.each(['stdout', 'stderr', 'version'])('bounds %s bytes and terminates overflowing output', async stream => {
    const flood = `process.${stream === 'stderr' ? 'stderr' : 'stdout'}.write('x'.repeat(100000)); setInterval(()=>{},1000);`;
    const executable = await fake(flood, stream === 'version' ? flood : undefined);
    const f = compilerFixture();
    await expect(compile(executable, { maxOutputBytes: 1000 }).compile(f.bound.code, f.context)).rejects.toMatchObject({ code: 'output-limit' });
    expect(await remaining()).toEqual(['test compiler']);
  });
  it('uses fixed offline arguments, explicit config, private permissions and an environment without company secrets', async () => {
    vi.stubEnv('CLOUDSIGHT_COMPANY_SECRET', 'never pass this');
    const report = join(root, 'observed.json');
    const executable = await fake(`const fs=require('fs');fs.writeFileSync(${JSON.stringify(report)},JSON.stringify({args:process.argv.slice(2),env:process.env,cwd:process.cwd(),files:fs.readdirSync('.'),mode:fs.statSync('.').mode,config:JSON.parse(fs.readFileSync('bicepconfig.json','utf8')),sourceMode:fs.statSync('main.bicep').mode}));console.log('{}');`);
    const f = compilerFixture();
    await expect(compile(executable).compile(f.bound.code, f.context)).rejects.toMatchObject({ code: 'template-mismatch' });
    const observed = JSON.parse(await readFile(report, 'utf8'));
    expect(observed.args).toEqual(['build', 'main.bicep', '--stdout', '--no-restore', '--config', 'bicepconfig.json']);
    expect(observed.files.sort()).toEqual(['bicepconfig.json', 'main.bicep']);
    expect(observed.mode & 0o777).toBe(0o700); expect(observed.sourceMode & 0o777).toBe(0o600);
    expect(observed.env.CLOUDSIGHT_COMPANY_SECRET).toBeUndefined();
    expect(observed.env.HOME).toBe(observed.cwd);
    expect(observed.config).toMatchObject({ analyzers: { core: { enabled: false } }, experimentalFeaturesEnabled: { symbolicNameCodegen: false } });
    expect(existsSync(observed.cwd)).toBe(false);
    expect((await stat(root)).isDirectory()).toBe(true);
  });
  it('reads configured executable at call time, refuses invalid limits and fails closed on malformed or expanded ARM output', async () => {
    const executable = await fake("console.log('not JSON');"); vi.stubEnv('CLOUDSIGHT_BICEP_PATH', executable);
    const f = compilerFixture();
    await expect(createExtensionArtifactCompiler({ tempRoot: root }).compile(f.bound.code, f.context)).rejects.toMatchObject({ code: 'template-mismatch' });
    for (const options of [{ timeoutMs: Infinity }, { timeoutMs: 0 }, { timeoutMs: 30001 }, { maxOutputBytes: 1048577 }, { maxOutputBytes: 0 }, { executable: 'az' }])
      expect(() => createExtensionArtifactCompiler(options)).toThrow();
    const wrong = await fake("console.log(JSON.stringify({resources:Array(201).fill({type:'Microsoft.Resources/deployments'})}));");
    await expect(compile(wrong).compile(f.bound.code, f.context)).rejects.toMatchObject({ code: 'template-mismatch' });
  });
});
it.skipIf(!realBinary)('compiles independently counted new metered hosts with safe tenant identity and target guards',async()=>{
 const {processedFixture}=await import('@/lib/extend/proposal.test-data');
 const {processExtensionOutput}=await import('@/lib/extend/process');
 const {createBicepContext,bindBicepSource}=await import('@/lib/extend-artifacts/bicep-semantics');
 const f=processedFixture();for(const p of f.raw.plans){
  p.newItems=p.newItems.filter(i=>!i.componentId.startsWith('postgres-flex-'));
  p.reusedResources=p.reusedResources.filter(r=>!['key-vault-operations','log-analytics-ingestion'].includes(r.componentId));p.usageIncreases=[];
  p.newItems.push({componentId:'key-vault-operations',quantity:10,instanceCount:2},{componentId:'log-analytics-ingestion',quantity:25,instanceCount:1});
 }
 const result=processExtensionOutput(f.raw,f.context,{id:f.result.id,createdAt:f.result.createdAt});if(!result.ok)throw Error(JSON.stringify(result));
 const binding={...compilerFixture().binding};
 const context=createBicepContext(binding,{extension:result.value,catalogData:{catalog:f.context.catalog,support:f.context.support},inventory:f.context.inventory});
 const out=bindBicepSource(context.payload.source,context);
 expect(await compile(realBinary).compile(out.code,context)).toMatchObject({policyVersion:'extend-bicep-source-arm-v1'});
},30000);
it.skipIf(!realBinary)('compiles pinned PostgreSQL mapping, secure parameters and classic storage',async()=>{
 const {processedFixture}=await import('@/lib/extend/proposal.test-data');const {createBicepContext,bindBicepSource}=await import('@/lib/extend-artifacts/bicep-semantics');
 const f=processedFixture(),binding={...compilerFixture().binding,tier:'low' as const};
 const context=createBicepContext(binding,{extension:f.result,catalogData:{catalog:f.context.catalog,support:f.context.support},inventory:f.context.inventory});
 const out=bindBicepSource(context.payload.source,context);
 expect(await compile(realBinary).compile(out.code,context)).toMatchObject({policyVersion:'extend-bicep-source-arm-v1'});
},30000);
it.skipIf(!realBinary).each(['b1','b2','p0v3','p1v3','p2v3'])('compiles the actual catalog retail spelling of new %s with exact ARM SKU and count',async sku=>{
 const {fixture}=await import('@/lib/extend/proposal.test-data');
 const {processExtensionOutput}=await import('@/lib/extend/process');
 const {createBicepContext,bindBicepSource}=await import('@/lib/extend-artifacts/bicep-semantics');
 const f=fixture(),binding={...compilerFixture().binding,tier:'low' as const};
 for(const p of f.raw.plans){
  if(p.tier!=='low')continue;
  p.newItems=[{componentId:`app-service-linux-${sku}`,quantity:2,instanceCount:2}];p.subnetProposals=[];
  p.reusedResources=p.reusedResources.filter(r=>!r.componentId.startsWith('app-service-linux-'));
 }
 const result=processExtensionOutput(f.raw,f.context,{id:binding.extensionId,createdAt:binding.createdAt});
 if(!result.ok)throw Error(JSON.stringify(result));
 const context=createBicepContext(binding,{extension:result.value,catalogData:{catalog:f.context.catalog,support:f.context.support},inventory:f.context.inventory});
 const out=bindBicepSource(context.payload.source,context);
 expect(await compile(realBinary).compile(out.code,context)).toMatchObject({policyVersion:'extend-bicep-source-arm-v1'});
},30000);
