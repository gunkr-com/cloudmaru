'use client';
import {useEffect,useRef,useState} from 'react';
import {extensionArtifactSchema} from '@/lib/completion/schema';
import {formatMonthlyMoney} from '@/i18n/format';
import {useI18n} from '@/i18n/provider';
import type {MessageKey} from '@/i18n/messages/types';
import type {ArtifactDisplayBasis} from '@/lib/extend-artifacts/render-file';
import type {ExtensionArtifact} from '@/types/extension';
import type {Tier} from '@/types/catalog';
import type {Locale,LocalizedText} from '@/types/i18n';
type Kind=ExtensionArtifact['kind'];
type Row={id:string;tier:Tier;kind:Kind;status:'pending'|'succeeded'|'failed';createdAt:string;content:ExtensionArtifact|null;error:string|null};
const kinds=['guide','evaluation','bicep'] as const;
const button='min-h-8 rounded-lg bg-surface-2 px-4 py-2 text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink';
const errorKeys:Record<string,MessageKey>={
 'compiler-unavailable':'extensionArtifacts.errors.compiler-unavailable',
 'deployment-configuration-invalid':'extensionArtifacts.errors.deployment-configuration-invalid',
 'deployment-network-binding-required':'extensionArtifacts.errors.deployment-network-binding-required',
 'deployment-mapping-missing':'extensionArtifacts.errors.deployment-mapping-missing',
 'deployment-target-conflict':'extensionArtifacts.errors.deployment-target-conflict',
 'invalid-request':'extensionArtifacts.errors.invalid-request','workspace-changed':'extensionArtifacts.errors.workspace-changed',
 'key-unavailable':'extensionArtifacts.errors.key-unavailable','not-configured':'extensionArtifacts.errors.key-unavailable',
 'extension-missing':'extensionArtifacts.errors.extension-missing','extension-not-succeeded':'extensionArtifacts.errors.extension-not-succeeded',
 'option-missing':'extensionArtifacts.errors.option-missing','validation-failed':'extensionArtifacts.errors.validation-failed',
 timeout:'extensionArtifacts.errors.timeout',interrupted:'extensionArtifacts.errors.interrupted',internal:'extensionArtifacts.errors.internal',
};
function Content({artifact,locale,basis}:{artifact:ExtensionArtifact;locale:Locale;basis:ArtifactDisplayBasis|null}){
 const {t}=useI18n();const tx=(text:LocalizedText)=>text[locale];
 if(artifact.kind==='bicep')return <div className="space-y-4"><p className="text-warning">{t('extensionArtifacts.draftLabel')}</p><p>{t('extensionArtifacts.compileNotice')}</p>
  <pre tabIndex={0} className="max-w-full overflow-x-auto whitespace-pre text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"><code>{artifact.content.code}</code></pre>
  {artifact.content.deploymentNotes.map((n,i)=><p key={i}>{tx(n)}</p>)}</div>;
 if(artifact.kind==='evaluation')return <div className="space-y-4"><p>{tx(artifact.content.summary)}</p>{artifact.content.axes.map(a=><section key={a.axis} className="min-w-0"><h4>{t(`artifacts.${a.axis}`)} · {t(`artifacts.${a.grade}`)}</h4><p>{tx(a.rationale)}</p><p>{tx(a.improvement)}</p></section>)}</div>;
 return <div className="space-y-4"><p>{tx(artifact.content.overview)}</p><h4>{t('artifacts.prerequisites')}</h4><ul className="list-disc pl-5">{artifact.content.prerequisites.map((p,i)=><li key={i}>{tx(p)}</li>)}</ul>
 {artifact.content.steps.map((s,i)=><section key={i} className="min-w-0 space-y-2"><h4 className="text-lg font-semibold">{i+1}. {tx(s.title)}</h4><p>{tx(s.goal)}</p><ul className="list-disc pl-5">{s.instructions.map((p,j)=><li key={j}>{tx(p)}</li>)}</ul><ul>{s.componentIds.map(id=><li key={id}>{basis?.components.find(c=>c.id===id)?.name[locale]??id}</li>)}{s.reusedResourceIds.map(id=><li key={id} className="break-all font-mono text-sm">{id}</li>)}</ul><p>{t('artifacts.verification')} {tx(s.verification)}</p></section>)}
 <h4>{t('artifacts.cautions')}</h4><ul className="list-disc pl-5">{artifact.content.cautions.map((p,i)=><li key={i}>{tx(p)}</li>)}</ul></div>;
}
function PendingElapsed({createdAt}:{createdAt:string}){
 const {t}=useI18n();const [now,setNow]=useState(()=>Date.now());
 useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return ()=>clearInterval(timer);},[]);
 const start=Date.parse(createdAt),elapsed=Number.isFinite(start)?Math.max(0,Math.floor((now-start)/1000)):0;
 return <p>{t('extensionArtifacts.elapsed')} · {elapsed}</p>;
}
/** Integration contract for phase22: mount inside I18nProvider; saved parent ID + selected tier only. */
export function ExtensionArtifactPanel(props:{extensionId:string;tier:Tier}){
 return <Controls key={`${props.extensionId}:${props.tier}`} {...props}/>;
}
function Controls({extensionId,tier}:{extensionId:string;tier:Tier}){
 const {t,locale}=useI18n();const [rows,setRows]=useState<Row[]>([]),[basis,setBasis]=useState<ArtifactDisplayBasis|null>(null);
 const [error,setError]=useState<string|null>(null),[keyOwner,setKeyOwner]=useState<string|null>(null);
 const [open,setOpen]=useState<Kind|null>(null),[sending,setSending]=useState<Kind|null>(null),[refresh,setRefresh]=useState(0);
 const controllers=useRef(new Set<AbortController>()),mounted=useRef(true);
 const url=`/api/extensions/${encodeURIComponent(extensionId)}/artifacts`;
 useEffect(()=>{
  mounted.current=true;const pending=controllers.current;
  return ()=>{mounted.current=false;for(const c of pending)c.abort();pending.clear();};
 },[]);
 useEffect(()=>{
  const pending=controllers.current;let live=true;const controller=new AbortController();pending.add(controller);let poll:ReturnType<typeof setTimeout>|undefined;
  const started=Date.now();let count=0;
  async function read(){
   const timeout=setTimeout(()=>controller.abort(),15000);
   try{
    const response=await fetch(`${url}?tier=${tier}`,{cache:'no-store',signal:controller.signal});const data=await response.json();
    if(!response.ok)throw Error(typeof data.code==='string'?data.code:'internal');
    if(!Array.isArray(data.artifacts)||data.basis?.extensionId!==extensionId||data.basis?.tier!==tier)throw Error('internal');
    const values:Row[]=data.artifacts.map((r:Row)=>{
     if(!kinds.includes(r.kind)||r.tier!==tier||!['pending','succeeded','failed'].includes(r.status))throw Error('internal');
     if(r.status==='succeeded'){const content=extensionArtifactSchema.parse(r.content);if(content.extensionId!==extensionId||content.tier!==tier||content.kind!==r.kind)throw Error('internal');}
     return r;
    });
    if(!live)return;setRows(values);setBasis(data.basis);setError(null);
    if(values.some(r=>r.status==='pending')){
     if(++count>=110||Date.now()-started>=330000){setError('interrupted');return;}
     poll=setTimeout(()=>void read(),3000);
    }
   }catch(e){if(live&&!controller.signal.aborted)setError(e instanceof Error?e.message:'internal');else if(live)setError('timeout');}
   finally{clearTimeout(timeout);}
  }
  void read();return ()=>{live=false;controller.abort();pending.delete(controller);if(poll)clearTimeout(poll);};
 },[extensionId,tier,url,refresh]);
 const keyWorkspace=keyOwner??(rows.some(r=>r.error==='not-configured')?basis?.workspaceId:null);
 async function generate(kind:Kind){
  const controller=new AbortController();controllers.current.add(controller);const timer=setTimeout(()=>controller.abort(),15000);
  setSending(kind);setError(null);setKeyOwner(null);
  try{
   const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({schemaVersion:1,extensionId,tier,kind}),signal:controller.signal});
   const data=await response.json();if(!mounted.current)return;
   if(!response.ok){setError(typeof data.code==='string'?data.code:'internal');if(typeof data.workspaceId==='string'&&/^[0-9a-f-]{36}$/.test(data.workspaceId))setKeyOwner(data.workspaceId);return;}
   setRefresh(n=>n+1);
  }catch{if(mounted.current)setError('internal');}finally{clearTimeout(timer);controllers.current.delete(controller);if(mounted.current)setSending(null);}
 }
 return <section className="min-w-0 space-y-6 break-words" aria-labelledby="extension-artifacts-heading">
 <h2 id="extension-artifacts-heading" className="text-xl font-semibold">{t('extensionArtifacts.title')}</h2>
 <p>{t('extensionArtifacts.savedOption',{option:t(`common.tiers.${tier}`)})}</p>
 {!basis&&!error&&<p role="status">{t('extensionArtifacts.loading')}</p>}
 {basis&&<div className="space-y-2 text-sm text-muted"><p>{t('extensionArtifacts.sourceScan',{id:basis.sourceScanId})}</p><p>{t('extensionArtifacts.priceBasis',{date:basis.priceAsOf})}</p>
 <p>{t('extensionArtifacts.coverage',{included:basis.coverage.included,excluded:basis.coverage.excluded,total:basis.coverage.total})}</p>
 <p>{t('extensionArtifacts.scopeNotice')}</p><p>{t('extensionArtifacts.freeGrantNotice')}</p>
 <p>{t('extension.result.completeness',{state:t(basis.source.completeness.state==='complete'?'extension.result.complete':basis.source.completeness.state==='partial'?'extension.result.incomplete':'extension.result.unknown')})}</p>
 {basis.source.completeness.reasons.map(r=><p key={r}>{t(`extension.reasons.${r}`)}</p>)}
 <p>{t('extensionArtifacts.estimatedCost')} · {basis.cost.state==='available'||basis.cost.state==='partial'?formatMonthlyMoney(basis.cost.data.total,'CAD',locale):t('extension.result.unavailable')}</p>
 {basis.cost.state==='partial'&&<p>{t('extension.result.partial')}</p>}
 {(basis.cost.state==='partial'?basis.cost.reasons:basis.cost.state==='unavailable'||basis.cost.state==='failed'?[basis.cost.reason]:[]).map(r=><p key={r}>{t(`extension.reasons.${r}`)}</p>)}
 <details><summary className="cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink">{t('extensionArtifacts.assumptions')}</summary>
 {basis.usage.map((u,i)=>{const c=basis.components.find(c=>c.id===u.componentId);return <p key={i}>{c?.name[locale]} · {c?.usage?c.usage[locale].replaceAll('{quantity}',String(u.quantity)):u.quantity}</p>;})}</details>
 <details><summary className="cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink">{t('extensionArtifacts.checks')}</summary>
 {basis.checks.map(c=><p key={c.kind}>{t(`extension.result.${c.kind}`)} · {t(`extension.verdict.${c.verdict}`)} {c.reasonCodes.map(r=>t(`extension.reasons.${r}`)).join(' · ')}</p>)}</details></div>}
 {error&&<p role="alert" className="text-warning">{t(errorKeys[error]??'extensionArtifacts.errors.internal')}</p>}
 {keyWorkspace&&<a className={button} href={`/workspaces/${keyWorkspace}/claude`}>{t('extensionArtifacts.keySettings')}</a>}
 {kinds.map(kind=>{const row=rows.find(r=>r.kind===kind);const pending=row?.status==='pending';return <section key={kind} className="min-w-0 space-y-4 rounded-xl border border-hairline bg-surface-1 p-6" aria-labelledby={`extension-artifact-${kind}`}>
 <h3 id={`extension-artifact-${kind}`} className="font-semibold">{t(`extensionArtifacts.${kind}`)}</h3>
 {pending?<><p role="status">{t('extensionArtifacts.status.pending')}</p><PendingElapsed key={`${row.id}:${row.createdAt}`} createdAt={row.createdAt}/></>:row?.status==='succeeded'&&row.content?<>
 <p role="status">{t('extensionArtifacts.status.succeeded')}</p><button type="button" className={button} aria-expanded={open===kind} onClick={()=>setOpen(open===kind?null:kind)}>{t(open===kind?'extensionArtifacts.collapse':'extensionArtifacts.view')}</button>
 <a className={button} href={`${url}/download?tier=${tier}&kind=${kind}`}>{t('extensionArtifacts.download')}</a>
 {open===kind&&<Content artifact={row.content} locale={locale} basis={basis}/>}</>:<>
 {row?.status==='failed'&&<p role="alert" className="text-warning">{t(errorKeys[row.error??'internal']??'extensionArtifacts.errors.internal')}</p>}
 <button type="button" className={button} disabled={sending!==null} onClick={()=>void generate(kind)}>{t(row?.status==='failed'?'extensionArtifacts.retry':'extensionArtifacts.generate')}</button>
 {sending===kind&&<p role="status">{t('extensionArtifacts.status.pending')}</p>}</>}
 {kind==='bicep'&&<p className="text-warning">{t('extensionArtifacts.draftNotice')}</p>}
 </section>;})}
 <button type="button" className={button} onClick={()=>setRefresh(n=>n+1)}>{t('extensionArtifacts.refresh')}</button>
 {basis&&<ul>{basis.references.map(r=><li key={r.url}><a className="underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink" href={r.url} target="_blank" rel="noreferrer">{r.title}<span className="sr-only"> {t('extensionArtifacts.newTab')}</span></a></li>)}</ul>}
 </section>;
}
