// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { runExtensionArtifactJob } from './artifact-job';
const usage = {promptTokens:2,completionTokens:3,costUsd:0.01};
function setup() {
  const value = {saved:'validated'};
  const complete=vi.fn(async()=>true), fail=vi.fn(async()=>true);
  const llm=vi.fn(async()=>({data:{},usage}));
  const prepare=vi.fn(async()=>({attemptId:'attempt',request:{system:'s',user:'u',schemaName:'n',jsonSchema:{}},validate:vi.fn(()=>({ok:true as const,value}))}));
  return {value, deps:{prepare,llm,complete,fail}};
}
it('validates then completes using the original attempt and combined retry usage only',async()=>{
  const {deps,value}=setup(); const prepared=(await deps.prepare())!;
  prepared.validate.mockReturnValueOnce({ok:false,errors:['content: invalid']} as never); deps.prepare.mockResolvedValue(prepared);
  await runExtensionArtifactJob('row','attempt',deps);
  expect(deps.llm).toHaveBeenCalledTimes(2);
  expect(deps.complete).toHaveBeenCalledWith('row','attempt',value,{promptTokens:4,completionTokens:6,costUsd:0.02});
  expect(deps.fail).not.toHaveBeenCalled();
});
it('observes each validated response separately without changing retry or billing',async()=>{
 const {deps,value}=setup(),onValidation=vi.fn();
 const prepared=(await deps.prepare())!;
 prepared.validate.mockReturnValueOnce({ok:false,errors:['steps.0.instructions.0.ko: unsafe-text-or-claim']} as never);
 deps.prepare.mockResolvedValue(prepared);
 await runExtensionArtifactJob('row','attempt',{...deps,onValidation});
 expect(onValidation.mock.calls).toEqual([[{attempt:1,errors:['steps.0.instructions.0.ko: unsafe-text-or-claim']}],[{attempt:2,errors:[]}]]);
 expect(deps.complete).toHaveBeenCalledWith('row','attempt',value,{promptTokens:4,completionTokens:6,costUsd:0.02});
});
it('isolates diagnostic observer failures from validation and settlement',async()=>{
 const {deps,value}=setup();
 await runExtensionArtifactJob('row','attempt',{...deps,onValidation:()=>{throw Error('logger unavailable');}});
 expect(deps.complete).toHaveBeenCalledWith('row','attempt',value,usage);
 expect(deps.llm).toHaveBeenCalledTimes(1);
 expect(deps.fail).not.toHaveBeenCalled();
});
it('never starts a superseded or missing preparation and sanitizes provider errors',async()=>{
  const {deps}=setup(); deps.prepare.mockResolvedValueOnce(null as never);
  await runExtensionArtifactJob('row','attempt',deps); expect(deps.llm).not.toHaveBeenCalled();
  deps.llm.mockRejectedValueOnce(Error('private provider body'));
  await runExtensionArtifactJob('row','attempt',deps);
  expect(deps.fail).toHaveBeenCalledWith('row','attempt','internal',null);
});
it('preserves known billing when completion/compiler validation fails',async()=>{
  const {deps}=setup();deps.complete.mockRejectedValueOnce(Error('private compiler error'));
  await runExtensionArtifactJob('row','attempt',deps);
  expect(deps.fail).toHaveBeenCalledWith('row','attempt','validation-failed',usage);
});
it('retains the classified compiler failure and known usage when the first terminal write fails',async()=>{
  const {deps}=setup();
  deps.complete.mockRejectedValueOnce(Object.assign(Error('compiler removed'),{code:'compiler-unavailable'}));
  deps.fail.mockRejectedValueOnce(Error('transient terminal write'));
  await runExtensionArtifactJob('row','attempt',deps);
  expect(deps.llm).toHaveBeenCalledTimes(1);
  expect(deps.complete).toHaveBeenCalledTimes(1);
  expect(deps.fail).toHaveBeenCalledTimes(2);
  expect(deps.fail).toHaveBeenNthCalledWith(1,'row','attempt','compiler-unavailable',usage);
  expect(deps.fail).toHaveBeenNthCalledWith(2,'row','attempt','compiler-unavailable',usage);
});
it('times out state promptly but still passes late final usage to the guarded store',async()=>{
  vi.useFakeTimers();const {deps}=setup();let resolve!: (value:{data:object;usage:typeof usage})=>void;
  deps.llm.mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));
  const running=runExtensionArtifactJob('row','attempt',deps);await vi.advanceTimersByTimeAsync(300001);
  expect(deps.fail).toHaveBeenCalledWith('row','attempt','timeout',null);
  resolve({data:{},usage});await running;
  expect(deps.fail).toHaveBeenLastCalledWith('row','attempt','timeout',usage);
  expect(deps.complete).not.toHaveBeenCalled();vi.useRealTimers();
});

it.each(['internal','compiler-unavailable','validation-failed'] as const)('preserves classified %s after a fail-once terminal error',async code=>{
 const {deps}=setup();
 deps.complete.mockRejectedValueOnce(Object.assign(Error('private store failure'),{code}));
 deps.fail.mockRejectedValueOnce(Error('transient terminal write'));
 await runExtensionArtifactJob('row','attempt',deps);
 expect(deps.llm).toHaveBeenCalledTimes(1);
 expect(deps.complete).toHaveBeenCalledTimes(1);
 expect(deps.fail.mock.calls).toEqual([['row','attempt',code,usage],['row','attempt',code,usage]]);
});
it('lets the deadline override an in-flight classified internal store failure',async()=>{
 vi.useFakeTimers();
 try {
  const {deps}=setup();let reject!: (error:unknown)=>void;
  deps.complete.mockImplementationOnce(()=>new Promise((_,r)=>{reject=r;}));
  const running=runExtensionArtifactJob('row','attempt',deps);
  await vi.advanceTimersByTimeAsync(300001);
  reject(Object.assign(Error('private store error'),{code:'internal'}));await running;
  expect(deps.fail).toHaveBeenLastCalledWith('row','attempt','timeout',usage);
 }finally{vi.useRealTimers();}
});
