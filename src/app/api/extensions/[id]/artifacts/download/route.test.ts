// @vitest-environment node
import {expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({download:vi.fn(async()=>new Response('saved'))}));
vi.mock('@/services/extension-artifact-api',()=>({extensionArtifactApi:()=>mocks}));
vi.mock('@/i18n/server',()=>({getLocale:async()=> 'ko'}));
import {GET} from './route';
it('downloads the saved requested option in cookie language without scheduling regeneration',async()=>{
 const r=await GET(new Request('http://localhost/download?tier=ha&kind=bicep'),{params:Promise.resolve({id:'saved'})});
 expect(await r.text()).toBe('saved');expect(mocks.download).toHaveBeenCalledWith('saved','ha','bicep','ko');
});
