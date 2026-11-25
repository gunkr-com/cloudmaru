import {act,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {I18nProvider} from '@/i18n/provider';
import {processedFixture} from '@/lib/extend/proposal.test-data';
import {artifactDisplayBasis} from '@/lib/extend-artifacts/render-file';
import {extensionArtifacts} from '@/lib/completion/fixtures.test-data';
import {ExtensionArtifactPanel} from './extension-artifact-panel';
import {createTranslator} from '@/i18n/translate';
const f=processedFixture(),basis=artifactDisplayBasis(f.result,{catalog:f.context.catalog,support:f.context.support},'low');
const wrap=(locale:'en'|'ko'='en')=><I18nProvider locale={locale}><ExtensionArtifactPanel extensionId={f.result.id} tier="low"/></I18nProvider>;
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();});
it('loads saved artifacts and switches language/download without generation or unsafe markup',async()=>{
 const a={...structuredClone(extensionArtifacts[0]),extensionId:f.result.id,workspaceId:f.result.workspaceId,sourceScanId:f.result.sourceScanId,tier:'low' as const};a.content.overview={en:'<img src=x onerror=alert(1)>',ko:'저장된 설명'};
 const fetcher=vi.fn(async(...args:[unknown,RequestInit?])=>(void args,Response.json({basis,artifacts:[{id:a.id,kind:'guide',tier:'low',status:'succeeded',createdAt:a.createdAt,content:a,error:null}]})));vi.stubGlobal('fetch',fetcher);
 const {container,rerender}=render(wrap());await screen.findByRole('button',{name:'View'});fireEvent.click(screen.getByRole('button',{name:'View'}));
 expect(container.querySelector('img')).toBeNull();expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
 expect(screen.getByRole('link',{name:'Download'})).toHaveAttribute('href',expect.stringContaining('tier=low&kind=guide'));
 rerender(wrap('ko'));await screen.findByText('저장된 설명');expect(fetcher).toHaveBeenCalledTimes(1);
 expect(container.querySelector('section')).toHaveClass('min-w-0');
});
it('shows no-key owner setting link, keeps controls retryable and sends only strict saved request',async()=>{
 const fetcher=vi.fn().mockResolvedValueOnce(Response.json({basis,artifacts:[]})).mockResolvedValueOnce(Response.json({code:'key-unavailable',workspaceId:f.result.workspaceId},{status:409}));vi.stubGlobal('fetch',fetcher);
 render(wrap());await screen.findAllByRole('button',{name:'Generate'});fireEvent.click(screen.getAllByRole('button',{name:'Generate'})[0]);
 expect(await screen.findByRole('alert')).toHaveTextContent('Claude key');
 expect(screen.getByRole('link',{name:'Claude key settings'})).toHaveAttribute('href',`/workspaces/${f.result.workspaceId}/claude`);
 const body=JSON.parse(fetcher.mock.calls[1][1].body);expect(body).toEqual({schemaVersion:1,extensionId:f.result.id,tier:'low',kind:'guide'});
});
it('aborts reads on unmount and stops polling after the bounded pending window',async()=>{
 vi.useFakeTimers();const fetcher=vi.fn(async(...args:[unknown,RequestInit?])=>(void args,Response.json({basis,artifacts:[{id:'a',kind:'guide',tier:'low',status:'pending',createdAt:new Date().toISOString(),content:null,error:null}]})));vi.stubGlobal('fetch',fetcher);
 const {unmount}=render(wrap());await act(async()=>{await Promise.resolve();});
 await act(async()=>{await vi.advanceTimersByTimeAsync(334000);});
 expect(fetcher.mock.calls.length).toBeLessThan(115);
 const n=fetcher.mock.calls.length;unmount();await act(async()=>{await vi.advanceTimersByTimeAsync(10000);});expect(fetcher).toHaveBeenCalledTimes(n);
 expect(fetcher.mock.calls[0][1]!.signal!.aborted).toBe(true);
});
it.each(['partial','unavailable'] as const)('keeps %s price reasons visible beside the saved estimate in both languages',async state=>{
 const saved=structuredClone(basis);if(saved.cost.state!=='available')throw Error('fixture-cost');
 saved.cost=state==='partial'?{state,reasons:['price-unavailable'],data:saved.cost.data}:{state,reason:'price-unavailable'};
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({basis:saved,artifacts:[]})));
 const {rerender}=render(wrap());
 for(const locale of ['en','ko'] as const){rerender(wrap(locale));expect(await screen.findByText(createTranslator(locale)('extension.reasons.price-unavailable'))).toBeInTheDocument();}
});
it.each(['en','ko'] as const)('shows actionable %s compiler advice for POST and saved failures without key links',async locale=>{
 const t=createTranslator(locale);
 const fetcher=vi.fn().mockResolvedValueOnce(Response.json({basis,artifacts:[]})).mockResolvedValueOnce(Response.json({code:'compiler-unavailable'},{status:409}));vi.stubGlobal('fetch',fetcher);
 const {unmount}=render(wrap(locale));await screen.findAllByRole('button',{name:t('extensionArtifacts.generate')});
 fireEvent.click(screen.getAllByRole('button',{name:t('extensionArtifacts.generate')})[2]);
 expect(await screen.findByRole('alert')).toHaveTextContent(t('extensionArtifacts.errors.compiler-unavailable'));
 expect(screen.getByRole('alert')).toHaveTextContent('0.49.2');expect(screen.getByRole('alert')).toHaveTextContent('CLOUDSIGHT_BICEP_PATH');
 expect(screen.queryByRole('link',{name:t('extensionArtifacts.keySettings')})).toBeNull();unmount();
 fetcher.mockResolvedValueOnce(Response.json({basis,artifacts:[{id:'a',kind:'bicep',tier:'low',status:'failed',createdAt:new Date().toISOString(),content:null,error:'compiler-unavailable'}]}));
 render(wrap(locale));expect(await screen.findByRole('alert')).toHaveTextContent(t('extensionArtifacts.errors.compiler-unavailable'));
 expect(screen.queryByRole('link',{name:t('extensionArtifacts.keySettings')})).toBeNull();
});
it('uses each pending creation time across consecutive runs, concurrent kinds and reopening',async()=>{
 vi.useFakeTimers();vi.setSystemTime(new Date('2026-11-12T12:00:00Z'));
 const row=(id:string,kind:string,createdAt:string,status='pending')=>({id,kind,tier:'low',createdAt,status,content:null,error:status==='failed'?'validation-failed':null});
 let rows=[row('first','guide',new Date(Date.now()-20000).toISOString())];
 vi.stubGlobal('fetch',vi.fn(async(_url:unknown,init?:RequestInit)=>Response.json(init?.method==='POST'?{artifact:{}}:{basis,artifacts:rows})));
 const view=render(wrap());await act(async()=>{await Promise.resolve();});
 expect(screen.getByText('Elapsed time · 20')).toBeInTheDocument();
 await act(async()=>{await vi.advanceTimersByTimeAsync(2000);});expect(screen.getByText('Elapsed time · 22')).toBeInTheDocument();
 rows=[{...rows[0],status:'failed',error:'validation-failed'}];
 fireEvent.click(screen.getByRole('button',{name:'Refresh saved artifacts'}));await act(async()=>{await Promise.resolve();});
 rows=[row('second','guide',new Date().toISOString()),row('concurrent','evaluation',new Date(Date.now()-7000).toISOString())];
 fireEvent.click(screen.getByRole('button',{name:'Retry'}));await act(async()=>{await Promise.resolve();});
 expect(screen.getByText('Elapsed time · 0')).toBeInTheDocument();expect(screen.getByText('Elapsed time · 7')).toBeInTheDocument();
 await act(async()=>{await vi.advanceTimersByTimeAsync(2000);});
 expect(screen.getByText('Elapsed time · 2')).toBeInTheDocument();expect(screen.getByText('Elapsed time · 9')).toBeInTheDocument();
 view.unmount();render(wrap());await act(async()=>{await Promise.resolve();});
 expect(screen.getByText('Elapsed time · 2')).toBeInTheDocument();expect(screen.getByText('Elapsed time · 9')).toBeInTheDocument();
});
it('ignores a late old-tier response while timing the selected tier pending artifact',async()=>{
 vi.useFakeTimers();vi.setSystemTime(new Date('2026-11-12T12:00:00Z'));
 let resolveOld!:(response:Response)=>void;let oldSignal:AbortSignal|undefined;
 const pending=new Promise<Response>(r=>{resolveOld=r;});
 vi.stubGlobal('fetch',vi.fn((url:string,init?:RequestInit)=>{
  if(url.includes('tier=low')){oldSignal=init?.signal??undefined;return pending;}
  return Promise.resolve(Response.json({basis:{...basis,tier:'ha'},artifacts:[{id:'ha',kind:'bicep',tier:'ha',status:'pending',createdAt:new Date(Date.now()-5000).toISOString(),content:null,error:null}]}));
 }));
 const {rerender}=render(wrap());rerender(<I18nProvider locale="en"><ExtensionArtifactPanel extensionId={f.result.id} tier="ha"/></I18nProvider>);
 await act(async()=>{await Promise.resolve();});
 expect(oldSignal?.aborted).toBe(true);expect(screen.getByText('Elapsed time · 5')).toBeInTheDocument();
 await act(async()=>{resolveOld(Response.json({basis,artifacts:[{id:'old',kind:'guide',tier:'low',status:'pending',createdAt:new Date(Date.now()-90000).toISOString(),content:null,error:null}]}));await Promise.resolve();});
 expect(screen.queryByText('Elapsed time · 90')).toBeNull();expect(screen.getByText('Elapsed time · 5')).toBeInTheDocument();
});
