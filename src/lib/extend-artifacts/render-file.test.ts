// @vitest-environment node
import {expect,it} from 'vitest';
import {processedFixture} from '@/lib/extend/proposal.test-data';
import {extensionArtifacts} from '@/lib/completion/fixtures.test-data';
import {artifactDisplayBasis,renderExtensionArtifactFile,escapeArtifactMarkdown} from './render-file';
import {createTranslator} from '@/i18n/translate';
it('escapes Markdown HTML images links fences and control characters as inert text',()=>{
  const value=escapeArtifactMarkdown('![x](https://evil.test) <script> ```\r\n# header');
  expect(value).not.toContain('![x]');expect(value).not.toContain('<script>');expect(value).not.toContain('```');
});
it('renders saved evidence, CAD/free grant assumptions and catalog links in both languages',()=>{
  const f=processedFixture();const basis=artifactDisplayBasis(f.result,{catalog:f.context.catalog,support:f.context.support},'low');
  const a=structuredClone(extensionArtifacts[0]);
  const en=renderExtensionArtifactFile(a,basis,'en'),ko=renderExtensionArtifactFile(a,basis,'ko');
  expect(en.filename).toMatch(/^cloudsight-extension-low-guide.md$/);expect(ko.filename).toMatch(/\.ko.md$/);
  expect(en.body).toContain('unverified');expect(en.body).toContain(f.result.sourceScanId);expect(en.body).toContain(f.context.catalog.prices.asOf);
  expect(en.body).toContain('https://learn.microsoft.com/');expect(en.body).toContain('CAD');
  expect(ko.body).toContain('무료 한도');
});
it('generates Bicep draft header in current language with deterministic safe filenames',()=>{
 const f=processedFixture(),basis=artifactDisplayBasis(f.result,{catalog:f.context.catalog,support:f.context.support},'low');
 const a=structuredClone(extensionArtifacts[2]);
 const file=renderExtensionArtifactFile(a,basis,'ko');expect(file.body.startsWith('// 검증 전 초안')).toBe(true);
 expect(file.filename).toBe('cloudsight-extension-low-main.bicep');expect(file.contentType).toContain('text/plain');
});
it.each(['partial','unavailable'] as const)('preserves %s price reasons and saved unknown checks in every bilingual download',state=>{
 const f=processedFixture(),basis=artifactDisplayBasis(f.result,{catalog:f.context.catalog,support:f.context.support},'low');
 if(basis.cost.state!=='available')throw Error('fixture-cost');
 basis.cost=state==='partial'?{state,reasons:['price-unavailable'],data:{...basis.cost.data,lines:basis.cost.data.lines.slice(0,1),total:basis.cost.data.lines[0].amount}}:{state,reason:'price-unavailable'};
 for(const locale of ['en','ko'] as const)for(const artifact of extensionArtifacts){
  const t=createTranslator(locale),file=renderExtensionArtifactFile(artifact,basis,locale);
  expect(file.body).toContain(t(state==='partial'?'extension.result.partial':'extension.result.unavailable'));
  expect(file.body).toContain(t('extension.reasons.price-unavailable'));
  if(state==='unavailable')expect(file.body).not.toContain('CA$0');
  expect(file.body).toContain(t('extension.reasons.capacity-unverified'));
  expect(file.body).toContain(t('extension.reasons.unsupported-path'));
  expect(file.body).toContain(basis.sourceScanId);
  expect(file.body).toContain(basis.priceAsOf);
 }
});
it.each(['en','ko'] as const)('formats saved decimal/large monthly CAD amounts consistently for %s in every download',async locale=>{
 const {formatMonthlyMoney}=await import('@/i18n/format');
 const f=processedFixture(),basis=artifactDisplayBasis(f.result,{catalog:f.context.catalog,support:f.context.support},'low');
 if(basis.cost.state!=='available')throw Error('fixture-cost');
 for(const total of [1234.56,1234567.89])for(const artifact of extensionArtifacts){
  basis.cost.data.total=total;
  const file=renderExtensionArtifactFile(artifact,basis,locale);
  const amount=formatMonthlyMoney(total,'CAD',locale);
  expect(file.body).toContain(artifact.kind==='bicep'?amount:escapeArtifactMarkdown(amount));
  expect(file.body).not.toContain('CAD '+total);
 }
});

it.each(['en','ko'] as const)('renders mixed component/reused references as separate escaped bullets in %s',locale=>{
 const f=processedFixture(),basis=artifactDisplayBasis(f.result,{catalog:f.context.catalog,support:f.context.support},'low');
 const a=structuredClone(extensionArtifacts[0]);if(a.kind!=='guide')throw Error('fixture');
 const malicious='![link](https://evil.test) <script>\n# attack';
 const reused=[f.result.plans[0].reusedResources[0].resourceId,malicious];
 a.content.steps[0].componentIds=[basis.components[0].id];a.content.steps[0].reusedResourceIds=reused;
 const body=renderExtensionArtifactFile(a,basis,locale).body;
 const bullets=[basis.components[0].name[locale],...reused].map(v=>'- '+escapeArtifactMarkdown(v));
 expect(body).toContain(bullets.join('\n'));
 expect(body).not.toContain('<script>');expect(body).not.toContain('![link]');
});
