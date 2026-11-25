import 'server-only';
import {z} from 'zod';
import type {ArtifactValidationEvent} from '@/lib/extend-artifacts/artifact-job';

// Model output, arbitrary object keys and provider/compiler error messages stay private.
const fields=new Set(['content','overview','prerequisites','cautions','steps','title','goal','instructions',
 'componentIds','reusedResourceIds','verification','summary','axes','axis','grade','rationale','improvement','en','ko','code']);
const codes=new Set(['invalid-prose-plan','invalid-model-structure','unsafe-text-or-claim','incomplete-selected-option','validation-failed',
 'unsupported-operational-vocabulary','prose-policy-violation',
 'unsafe-prose-markup','monetary-prose-claim','readiness-prose-claim','private-identity-reference',
 'catalog-display-name-reference','unselected-component-reference','identity-or-link-reference','provider-name-reference','mutation-or-command-prose',
 'source-contract-required','source-does-not-match-saved-contract']);
export function logExtensionArtifactValidation(id:string,event:ArtifactValidationEvent):void {
 const issues=event.errors.slice(0,20).map(error=>{
  const match=/^([^:]{0,256}): ([a-z-]{1,80})$/.exec(error);
  const parts=match?.[1].split('.')??[];
  return {path:parts.length>0&&parts.length<=12&&parts.every(part=>fields.has(part)||/^[0-9]{1,4}$/.test(part))
   ?parts.join('.'):'unknown',code:match&&codes.has(match[2])?match[2]:'other-validation-error'};
 });
 console.info('[cloudsight:extension-artifact-validation]',{id:z.uuid().safeParse(id).success?id:'unknown',
  attempt:event.attempt,valid:event.errors.length===0,issues,omitted:Math.max(0,event.errors.length-issues.length)});
}
