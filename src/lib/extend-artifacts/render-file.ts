import {formatMonthlyMoney} from '@/i18n/format';
import {createTranslator} from '@/i18n/translate';
import type {ExtensionArtifact,ExtensionResult} from '@/types/extension';
import type {ExtensionCoreData} from '@/lib/extend/process';
import type {Locale,LocalizedText} from '@/types/i18n';
import type {Tier} from '@/types/catalog';
/** Only server-validated stored parent + pinned catalog may supply this display projection. */
export function artifactDisplayBasis(extension:ExtensionResult, data:ExtensionCoreData,tier:Tier) {
  const plan=extension.plans.find(p=>p.tier===tier);
  if(!plan)throw Error('option-missing');
  const ids=new Set([...plan.newItems,...plan.reusedResources,...plan.usageIncreases].map(i=>i.componentId));
  const components=data.catalog.components.filter(c=>ids.has(c.id)).map(c=>({id:c.id,name:c.name,
    usage:c.usage?.assumptionLabel??null}));
  const architecture=data.catalog.architectures.find(r=>r.id===plan.referenceArchitectureId);
  if(!architecture||components.length!==ids.size)throw Error('invalid-catalog-basis');
  const references=architecture.sources.map(source=>{
    const url=new URL(source.url);
    if(url.protocol!=='https:'||url.hostname!=='learn.microsoft.com'||url.username||url.password)throw Error('invalid-catalog-source');
    return {title:source.title,url:source.url};
  });
  return {extensionId:extension.id,workspaceId:extension.workspaceId,sourceScanId:extension.sourceScanId,tier,
    source:extension.sourceScan,coverage:extension.contextCoverage,priceAsOf:data.catalog.prices.asOf,
    components,references,cost:plan.incrementalCost,checks:plan.checks.map(c=>({kind:c.kind,verdict:c.verdict,reasonCodes:c.reasonCodes})),
    usage:[...plan.newItems.map(i=>({...i,kind:'new' as const})),...plan.usageIncreases.map(i=>({...i,kind:'usage-increase' as const}))]};
}
export type ArtifactDisplayBasis=ReturnType<typeof artifactDisplayBasis>;
/** Every untrusted character stays prose, including images/autolinks/HTML and fence delimiters. */
export function escapeArtifactMarkdown(value:string):string {
  return value.normalize('NFKC').replace(/[\p{Cc}\p{Cf}]/gu,' ').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
    .replace(/[\\`*_{}\[\]()#+.!|~:$]/g,'\\$&');
}
export function renderExtensionArtifactFile(artifact:ExtensionArtifact,basis:ArtifactDisplayBasis,locale:Locale) {
  const t=createTranslator(locale),md=escapeArtifactMarkdown;
  const text=(v:LocalizedText)=>md(v[locale]);
  const prefix=`cloudsight-extension-${basis.tier}-`;
  const costReasons=basis.cost.state==='partial'?basis.cost.reasons:basis.cost.state==='unavailable'||basis.cost.state==='failed'?[basis.cost.reason]:[];
  const savedBasis=[t('extensionArtifacts.sourceScan',{id:basis.sourceScanId}),t('extensionArtifacts.priceBasis',{date:basis.priceAsOf}),
    t('extensionArtifacts.coverage',{included:basis.coverage.included,excluded:basis.coverage.excluded,total:basis.coverage.total}),t('extensionArtifacts.scopeNotice'),t('extensionArtifacts.freeGrantNotice'),
    `${t('extensionArtifacts.collectionScope')}: ${t(basis.source.completeness.state==='complete'?'extension.result.complete':basis.source.completeness.state==='partial'?'extension.result.incomplete':'extension.result.unknown')} · ${basis.source.completeness.reasons.map(r=>t(`extension.reasons.${r}`)).join(', ')}`,
    `${t('extensionArtifacts.estimatedCost')}: ${basis.cost.state==='available'||basis.cost.state==='partial'?formatMonthlyMoney(basis.cost.data.total,'CAD',locale):t('extension.result.unavailable')}`,
    ...(basis.cost.state==='partial'?[t('extension.result.partial')]:[]),...costReasons.map(r=>t(`extension.reasons.${r}`)),
    ...basis.checks.map(c=>`${t(`extension.result.${c.kind}`)}: ${t(`extension.verdict.${c.verdict}`)} ${c.reasonCodes.map(r=>t(`extension.reasons.${r}`)).join(', ')}`),
    ...basis.coverage.reasons.map(r=>`${t(`extension.reasons.${r.code}`)}: ${r.count}`)];
  if(artifact.kind==='bicep') {
    const code=artifact.content.code.replace(/^\/\/ (?:Unverified draft|검증 전 초안)[^\n]*\n/,'');
    const comments=[t('extensionArtifacts.compileNotice'),...savedBasis,...artifact.content.deploymentNotes.map(n=>n[locale])]
      .map(line=>'// '+line.replace(/[\r\n\p{Cc}\p{Cf}]/gu,' ')).join('\n');
    return {filename:prefix+'main.bicep',contentType:'text/plain; charset=utf-8',body:`// ${t('artifacts.download.bicepDraft')}\n${comments}\n${code}`};
  }
  const lines=[`# ${t(artifact.kind==='guide'?'extensionArtifacts.guide':'extensionArtifacts.evaluation')}`];
  const heading=(key:Parameters<typeof t>[0])=>lines.push('',`## ${t(key)}`);
  if(artifact.kind==='guide') {
    lines.push('',text(artifact.content.overview));heading('artifacts.prerequisites');
    lines.push(...artifact.content.prerequisites.map(v=>'- '+text(v)));
    for(const [i,step] of artifact.content.steps.entries()) {
      lines.push('',`## ${i+1}. ${text(step.title)}`,'',`**${t('artifacts.download.goal')}:** ${text(step.goal)}`,'',...step.instructions.map(v=>'- '+text(v)),
        '',...step.componentIds.map(id=>'- '+md(basis.components.find(c=>c.id===id)?.name[locale]??id)),...step.reusedResourceIds.map(id=>'- '+md(id)),
        '',`**${t('artifacts.download.verification')}:** ${text(step.verification)}`);
    }
    heading('artifacts.cautions');lines.push(...artifact.content.cautions.map(v=>'- '+text(v)));
  } else {
    lines.push('',text(artifact.content.summary));
    for(const axis of artifact.content.axes) lines.push('',`## ${t(`artifacts.${axis.axis}`)} · ${t(`artifacts.${axis.grade}`)}`,'',text(axis.rationale),'',text(axis.improvement));
  }
  heading('extensionArtifacts.evidenceTitle');
  lines.push('',...savedBasis.map(md));
  heading('extensionArtifacts.assumptions');
  for(const u of basis.usage){const c=basis.components.find(c=>c.id===u.componentId)!;lines.push('- '+md(c.name[locale])+': '+md(c.usage?c.usage[locale].replaceAll('{quantity}',String(u.quantity)):String(u.quantity)));}
  heading('extensionArtifacts.references');
  // URLs come exclusively from the pinned validated catalog. Encode Markdown delimiters in their paths.
  lines.push(...basis.references.map(r=>`- [${md(r.title)}](${r.url.replace(/[()\s<>]/g,c=>encodeURIComponent(c))})`));
  return {filename:prefix+artifact.kind+(locale==='ko'?'.ko':'')+'.md',contentType:'text/markdown; charset=utf-8',body:lines.join('\n')+'\n'};
}
