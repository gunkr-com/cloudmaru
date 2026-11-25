// @vitest-environment node
import {afterEach,expect,it,vi} from 'vitest';
import {logExtensionArtifactValidation} from './extension-artifact-validation-log';
afterEach(()=>vi.restoreAllMocks());
const id='00000000-0000-4000-8000-000000000001';
it('records response attempts and bounded allowlisted guide/evaluation paths',()=>{
 const spy=vi.spyOn(console,'info').mockImplementation(()=>{});
 logExtensionArtifactValidation(id,{attempt:2,errors:['steps.0.instructions.0.ko: unsafe-text-or-claim','axes.2.rationale.en: invalid-model-structure']});
 expect(spy).toHaveBeenCalledWith('[cloudsight:extension-artifact-validation]',{id,attempt:2,valid:false,
  issues:[{path:'steps.0.instructions.0.ko',code:'unsafe-text-or-claim'},{path:'axes.2.rationale.en',code:'invalid-model-structure'}],omitted:0});
});
it('hides model keys, values, invalid identifiers, long paths and excessive errors',()=>{
 const spy=vi.spyOn(console,'info').mockImplementation(()=>{}),secret='sk-ant-private-company-value';
 logExtensionArtifactValidation(secret,{attempt:1,errors:[`${secret}: invalid-model-structure`,`steps.0.${secret}: invalid-model-structure`,
  `content: ${secret}`,`${Array(15).fill('steps').join('.')}: invalid-model-structure`,...Array(100).fill('content: validation-failed')]});
 const event=spy.mock.calls[0][1] as {issues:unknown[];omitted:number};
 expect(JSON.stringify(spy.mock.calls)).not.toContain(secret);
 expect(event.issues).toHaveLength(20);expect(event.omitted).toBe(84);
 expect(event.issues.slice(0,4)).toEqual([{path:'unknown',code:'invalid-model-structure'},{path:'unknown',code:'invalid-model-structure'},
  {path:'content',code:'other-validation-error'},{path:'unknown',code:'invalid-model-structure'}]);
});
it('reports a successful response without serializing content',()=>{
 const spy=vi.spyOn(console,'info').mockImplementation(()=>{});
 logExtensionArtifactValidation(id,{attempt:1,errors:[]});
 expect(spy.mock.calls[0][1]).toEqual({id,attempt:1,valid:true,issues:[],omitted:0});
});
it('preserves fixed vocabulary and policy categories without a rejected word',()=>{
 const spy=vi.spyOn(console,'info').mockImplementation(()=>{});
 logExtensionArtifactValidation(id,{attempt:1,errors:['overview.en: unsupported-operational-vocabulary','cautions.1.en: prose-policy-violation']});
 expect(spy.mock.calls[0][1]).toMatchObject({issues:[{path:'overview.en',code:'unsupported-operational-vocabulary'},
  {path:'cautions.1.en',code:'prose-policy-violation'}]});
});
it.each(['invalid-prose-plan','unsafe-prose-markup','monetary-prose-claim','readiness-prose-claim','private-identity-reference',
 'catalog-display-name-reference','unselected-component-reference','identity-or-link-reference','provider-name-reference','mutation-or-command-prose'])(
 'preserves the reviewed %s branch',code=>{
 const spy=vi.spyOn(console,'info').mockImplementation(()=>{});
 logExtensionArtifactValidation(id,{attempt:1,errors:[`overview.en: ${code}`]});
 expect(spy.mock.calls[0][1]).toMatchObject({issues:[{path:'overview.en',code}]});
});
