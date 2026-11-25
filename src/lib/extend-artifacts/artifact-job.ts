import { requestWithValidationRetry } from '@/lib/llm/validation-retry';
import { readLlmErrorUsage } from '@/lib/llm/usage';
import type { StructuredLlm, StructuredLlmRequest } from '@/types/analysis';
import type { LlmUsage } from '@/types/llm';
import type { CompletionReasonCode } from '@/types/completion';
export type PreparedArtifact<T> = {attemptId:string;request:StructuredLlmRequest;validate:(raw:unknown)=>{ok:true;value:T}|{ok:false;errors:string[]}};
export type ArtifactValidationEvent = {attempt:1|2;errors:string[]};
type Dependencies<T> = {
  prepare:(id:string)=>Promise<PreparedArtifact<T>|null>;
  llm:StructuredLlm;
  complete:(id:string,attemptId:string,value:T,usage:LlmUsage|null)=>Promise<boolean>;
  fail:(id:string,attemptId:string,code:CompletionReasonCode,usage:LlmUsage|null)=>Promise<boolean>;
  onValidation?:(event:ArtifactValidationEvent)=>void;
};
/** Store alone owns billing. A timer can end state, but a late final aggregate still reaches that store. */
export async function runExtensionArtifactJob<T>(id:string, attemptId:string, deps:Dependencies<T>):Promise<void> {
  const started=Date.now();let expired=false, usage:LlmUsage|null=null;
  let failureCode:CompletionReasonCode='internal';
  let timer:ReturnType<typeof setTimeout>|undefined;
  const fail=async(code:CompletionReasonCode, finalUsage=usage)=>{
    // A transient terminal write must not replace an already classified failure.
    failureCode=code;
    await deps.fail(id,attemptId,code,finalUsage);
  };
  try {
    const prepared=await deps.prepare(id);
    if(!prepared||prepared.attemptId!==attemptId)return;
    timer=setTimeout(()=>{expired=true;void fail('timeout',null).catch(()=>{});},Math.max(0,300000-(Date.now()-started)));
    let providerCode:CompletionReasonCode='internal';
    let validationAttempt:1|2=1;
    const validate=(raw:unknown)=>{
      const result=prepared.validate(raw);
      // Diagnostics cannot change validator results, retries, settlement or billing.
      try {deps.onValidation?.({attempt:validationAttempt,errors:result.ok?[]:[...result.errors]});}catch{}
      validationAttempt=2;
      return result;
    };
    const response=await requestWithValidationRetry(async request=>{
      const remaining=280000-(Date.now()-started);
      if(expired||remaining<=0) {providerCode='timeout';throw Error('timeout');}
      try {return await deps.llm({...request,timeoutMs:Math.min(request.timeoutMs??remaining,remaining)});}
      catch(error){
        if(error && typeof error==='object' && 'kind' in error) {
          if(error.kind==='config')providerCode='not-configured';
          if(error.kind==='timeout')providerCode='timeout';
        }
        throw error;
      }
    },prepared.request,validate,{now:Date.now,budgetMs:Math.max(0,280000-(Date.now()-started)),minRetryMs:90000});
    usage=response.usage??null;
    if(expired)await fail('timeout');
    else if(response.kind==='ok') {
      try {await deps.complete(id,attemptId,response.value,usage);}
      catch(error) {
        const code=error instanceof Error && 'code' in error ? error.code : null;
        await fail(expired?'timeout':code==='compiler-unavailable'?'compiler-unavailable':code==='internal'?'internal':'validation-failed');
      }
    } else await fail(providerCode!=='internal'?providerCode:response.kind==='invalid'?'validation-failed':'internal');
  } catch(error) {
    usage??=readLlmErrorUsage(error);
    await fail(expired?'timeout':failureCode);
  } finally {if(timer)clearTimeout(timer);}
}
