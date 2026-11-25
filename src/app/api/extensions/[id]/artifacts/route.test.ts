// @vitest-environment node
import {expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({post:vi.fn(async()=>new Response(null,{status:202})),get:vi.fn(async()=>new Response(null,{status:200})),after:vi.fn()}));
vi.mock('@/services/extension-artifact-api',()=>({extensionArtifactApi:()=>mocks}));
vi.mock('next/server',()=>({after:mocks.after}));
import {POST,GET,maxDuration} from './route';
it('awaits route params and delegates only to the bounded server artifact API',async()=>{
 const context={params:Promise.resolve({id:'saved-id'})};const req=new Request('http://localhost/api?tier=balanced');
 expect((await POST(req,context)).status).toBe(202);expect(mocks.post).toHaveBeenCalledWith(req,'saved-id');
 await GET(req,context);expect(mocks.get).toHaveBeenCalledWith('saved-id','balanced');expect(maxDuration).toBe(300);
});
