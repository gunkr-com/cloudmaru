import {z} from 'zod';
import catalogData from '@/catalog/extension-artifact-prose.json';

const phrase=(en:number,ko:number)=>z.strictObject({id:z.string().regex(/^[a-z][a-z0-9-]*$/),en:z.string().min(1).max(en),ko:z.string().min(1).max(ko)});
export const artifactProseCatalog=z.strictObject({version:z.literal('extend-artifact-prose-v1'),
 titles:z.array(phrase(80,40)).min(1),statements:z.array(phrase(240,120)).min(1),
}).superRefine((catalog,ctx)=>{
 for(const list of [catalog.titles,catalog.statements])if(new Set(list.map(p=>p.id)).size!==list.length)ctx.addIssue({code:'custom',message:'duplicate-phrase-id'});
}).parse(catalogData);
const title=z.enum(artifactProseCatalog.titles.map(p=>p.id));
const statement=z.enum(artifactProseCatalog.statements.map(p=>p.id));
const members=(pattern:RegExp)=>z.array(z.string().regex(pattern)).refine(ids=>new Set(ids).size===ids.length);
const guide=z.strictObject({overview:statement,prerequisites:z.array(statement).min(1).max(40),cautions:z.array(statement).min(1).max(40),
 steps:z.array(z.strictObject({title,goal:statement,instructions:z.array(statement).min(1).max(40),
  componentIds:members(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/),reusedResourceIds:members(/^r[0-9]{6,}$/),verification:statement})).min(1).max(200)});
const evaluation=z.strictObject({summary:statement,axes:z.array(z.strictObject({axis:z.enum(['reliability','security','cost','operations','performance']),
 grade:z.enum(['high','medium','low']),rationale:statement,improvement:statement})).length(5).refine(axes=>new Set(axes.map(a=>a.axis)).size===5)});
export const artifactProsePlanSchema=(kind:'guide'|'evaluation')=>kind==='guide'?guide:evaluation;
const texts=new Map(artifactProseCatalog.statements.map(({id,en,ko})=>[id,{en,ko}]));
const titles=new Map(artifactProseCatalog.titles.map(({id,en,ko})=>[id,{en,ko}]));
/** This is a new generation contract, never a fallback for rejected free text.
 * The caller must run the original complete text/member/privacy validator next.
 * Saved artifacts retain ordinary bilingual text and need no phrase catalog replay.
 */
export function renderArtifactProsePlan(raw:unknown,kind:'guide'|'evaluation'):unknown|null {
 if(kind==='guide'){
  const parsed=guide.safeParse(raw);if(!parsed.success)return null;
  const p=parsed.data;
  return {overview:texts.get(p.overview),prerequisites:p.prerequisites.map(id=>texts.get(id)),cautions:p.cautions.map(id=>texts.get(id)),
   steps:p.steps.map(step=>({...step,title:titles.get(step.title),goal:texts.get(step.goal),
    instructions:step.instructions.map(id=>texts.get(id)),verification:texts.get(step.verification)}))};
 }
 const parsed=evaluation.safeParse(raw);if(!parsed.success)return null;
 return {summary:texts.get(parsed.data.summary),axes:parsed.data.axes.map(axis=>({...axis,rationale:texts.get(axis.rationale),improvement:texts.get(axis.improvement)}))};
}
