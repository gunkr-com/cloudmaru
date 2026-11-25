// @vitest-environment node
import {expect,it} from 'vitest';
import {renderArtifactProsePlan,artifactProseCatalog} from './prose-plan';
import {createArtifactTextContext,validateArtifactTextOutput} from './guide-evaluation';
import {processedFixture} from '@/lib/extend/proposal.test-data';
import {ids} from '@/lib/completion/fixtures.test-data';
const f=processedFixture();
function context(kind:'guide'|'evaluation'='guide'){
 return createArtifactTextContext({id:ids.network,extensionId:f.result.id,workspaceId:f.result.workspaceId,sourceScanId:f.result.sourceScanId,
  tier:'low',kind,createdAt:f.result.createdAt},{extension:f.result,inventory:f.context.inventory,catalogData:{catalog:f.context.catalog,support:f.context.support}});
}
function plan(){const ctx=context();return {overview:'review-saved',prerequisites:['check-access'],cautions:['capacity-unknown'],steps:[{
 title:'review-configuration',goal:'review-saved',instructions:['preserve-settings'],verification:'verify-isolated',
 componentIds:ctx.payload.components.map(c=>c.id),reusedResourceIds:ctx.payload.reusedResources.map(r=>r.alias)}]};}
it('renders reviewed bilingual phrases while preserving selected members and old semantic checks',()=>{
 const rendered=renderArtifactProsePlan(plan(),'guide');expect(rendered).not.toBeNull();
 expect(validateArtifactTextOutput(rendered,context()).ok).toBe(true);
 const missing=plan();missing.steps[0].componentIds=[];
 expect(validateArtifactTextOutput(renderArtifactProsePlan(missing,'guide'),context()).ok).toBe(false);
});
it('every catalog phrase passes the actual privacy/claims/language validator, including title limits',()=>{
 const failures:unknown[]=[];
 for(const item of artifactProseCatalog.statements){
  const raw=plan();raw.overview=item.id;
  const result=validateArtifactTextOutput(renderArtifactProsePlan(raw,'guide'),context());
  if(!result.ok)failures.push({id:item.id,errors:result.errors});
 }
 for(const item of artifactProseCatalog.titles){
  const raw=plan();raw.steps[0].title=item.id;
  const result=validateArtifactTextOutput(renderArtifactProsePlan(raw,'guide'),context());
  if(!result.ok)failures.push({id:item.id,errors:result.errors});
 }
 expect(failures).toEqual([]);
});
it.each(['arbitrary-provider','The cost is 100.','review-saved\nhttps://example.com'])('rejects unreviewed phrase %s without a free-text fallback',id=>{
 expect(renderArtifactProsePlan({...plan(),overview:id},'guide')).toBeNull();
});
it('rejects extra money/claims, wrong phrase roles, aliases and cross-kind structure',()=>{
 expect(renderArtifactProsePlan({...plan(),amount:0},'guide')).toBeNull();
 expect(renderArtifactProsePlan({...plan(),overview:'review-configuration'},'guide')).toBeNull();
 expect(renderArtifactProsePlan(plan(),'evaluation')).toBeNull();
 const raw=plan();raw.steps[0].reusedResourceIds=['r999999'];
 expect(validateArtifactTextOutput(renderArtifactProsePlan(raw,'guide'),context()).ok).toBe(false);
});
it('renders five distinct advice axes and rejects duplicates',()=>{
 const raw={summary:'review-saved',axes:['reliability','security','cost','operations','performance'].map(axis=>({axis,grade:'medium',rationale:'capacity-unknown',improvement:'verify-isolated'}))};
 const result=validateArtifactTextOutput(renderArtifactProsePlan(raw,'evaluation'),context('evaluation'));
 expect(result.ok).toBe(true);raw.axes[1].axis='reliability';
 expect(renderArtifactProsePlan(raw,'evaluation')).toBeNull();
});
