// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDatabase, insertTestWorkspace } from "@/lib/db/test-db.test-data";
import { completeSnapshot, ids } from "@/lib/completion/fixtures.test-data";
import { summarizeInventory } from "@/lib/inventory/summarize";
import { toCompletionSourceScan } from "@/lib/completion/source-scan";
import * as engine from "@/lib/assessment/rules/engine";
import * as diffEngine from "@/lib/inventory/diff";
import { mapAdvisorRows } from "@/lib/assessment/advisor-parse";
import { advisorCatalog } from "@/lib/assessment/advisor-catalog";
import { createScansDb } from "@/services/db/scans";
import { createAssessmentsDb } from "@/services/db/assessments";
import { createAssessmentRoadmapsDb } from "@/services/db/assessment-roadmaps";
import type { ActualCost, AssessmentResult } from "@/types/assessment";
import type { ScanInventory } from "@/types/scan";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nProvider } from "@/i18n/provider";
const m=vi.hoisted(()=>({db:vi.fn(),locale:vi.fn(),claude:vi.fn(),owner:vi.fn()}));
vi.mock("@/services/db/client",()=>({getDb:m.db}));
vi.mock("@/i18n/server",()=>({getLocale:m.locale}));
vi.mock("@/services/workspace-claude",()=>({requestCompletionStructuredOutput:m.claude,hasCompletionClaudeKey:m.claude}));
vi.mock("@/services/current-workspace",()=>({getCurrentWorkspace:m.owner}));
import { GET } from "./route";
import Page from "@/app/(app)/assessments/[id]/report/page";
let db:PGlite,workspaceId:string;
beforeEach(async()=>{vi.resetAllMocks();db=await createTestDatabase();m.db.mockResolvedValue(db);m.locale.mockResolvedValue("en");workspaceId=await insertTestWorkspace(db);});
afterEach(async()=>{vi.restoreAllMocks();await db?.close();});
function inventories(){
  const base=structuredClone(completeSnapshot.inventory);
  const rows=base.resources.filter(r=>r.type === "microsoft.web/sites").slice(0,3).map(r=>({...r,observedFields:["tags","zones","managedBy","sku","properties","location","kind"] as const}));
  const before:ScanInventory={...base,relations:[],resources:rows.slice(0,2).map(r=>({...r,observedFields:[...r.observedFields]}))};
  const after:ScanInventory={...base,relations:[],resources:[rows[0],rows[2]].map(r=>({...r,observedFields:[...r.observedFields]}))};
  before.resources[0].properties={httpsOnly:true,siteConfig:{minTlsVersion:"1.2"},ordinary:"old",password:"PRIVATE BEFORE"};
  after.resources[0].properties={httpsOnly:false,siteConfig:{minTlsVersion:'<img src=x onerror=alert(1)> ![remote](https://evil.test/img) ``` ```` | [go](javascript:alert(1))'},ordinary:"new",password:"PRIVATE AFTER",
    settings:[{name:"API_TOKEN",value:"PRIVATE NAMED"}],uri:"https://user:PRIVATEUSER@host/path",pwd:"Pwd=PRIVATEPWD",sig:"sig=PRIVATESIG"};
  return {before,after};
}
async function save(inventory:ScanInventory,source:"live"|"import",collectedAt:string,scope=[ids.subscription] as string[]){
 const scans=createScansDb({db:async()=>db});const data={inventory,subscriptionIds:scope,collectedAt,summary:summarizeInventory(inventory.resources,inventory.containers)};
 const id=source === "import" ? await scans.createImportScan({workspaceId,...data}):(await scans.reserveLiveScan({workspaceId,subscriptionIds:scope,staleBefore:new Date(0)})).id;
 if(source === "live") await scans.completeScan(id,data);
 return {scan:(await scans.getScan(id))!,inventory:(await scans.getScanInventory(id))!};
}
async function stored(options:{source?:"live"|"import";legacy?:boolean;partial?:boolean;scope?:boolean;costs?:boolean}={}){
 const {before,after}=inventories();
 if(options.legacy)for(const resource of [...before.resources,...after.resources])delete resource.observedFields;
 if(options.partial)after.skippedRows=2;
 const baseline=await save(before,options.source??"live","2026-11-08T10:00:00Z");
 const comparison=await save(after,options.source??"live","2026-11-09T10:00:00Z",options.scope?[ids.subscription,ids.otherSubscription]:[ids.subscription]);
 const parents=createAssessmentsDb({db:async()=>db});
 const id=(await parents.reserveAssessment({schemaVersion:1,workspaceId,sourceScanId:comparison.scan.id,previousScanId:baseline.scan.id}))!.id;
 const parent=(await parents.getAssessment(id))!;const now=new Date().toISOString();
 const result:AssessmentResult={schemaVersion:1,id,workspaceId,sourceScanId:comparison.scan.id,sourceScan:toCompletionSourceScan(comparison.scan,comparison.inventory),createdAt:parent.createdAt,
 local:engine.evaluateAssessmentRules(comparison.inventory.resources,now),advisor:{state:"unavailable",reason:"forbidden"},
 actualCost:{schemaVersion:1,monthToDate:{state:"unavailable",reason:"no-data"},trailing30Days:{state:"failed",reason:"timeout"}},
 diff:{state:"available",data:diffEngine.compareScans(baseline,comparison,now)},roadmap:{state:"not-requested"}};
 if(options.source === "import"){
  result.advisor={state:"unavailable",reason:"not-supported"};result.actualCost.monthToDate={state:"unavailable",reason:"not-supported"};result.actualCost.trailing30Days={state:"unavailable",reason:"not-supported"};
 }
 if(options.costs){
  const resourceId=comparison.inventory.resources[0].id;
  const data:ActualCost={schemaVersion:1,retrievedAt:now,period:{from:"2026-11-01T00:00:00Z",to:now,preset:"month-to-date"},
   scope:{kind:"subscriptions",requestedSubscriptionIds:[ids.subscription],availableSubscriptionIds:[ids.subscription],paginationComplete:false},
   rows:[{subscriptionId:ids.subscription,currency:"CAD",amount:0,attribution:{kind:"resource",resourceId}},
   {subscriptionId:ids.subscription,currency:"USD",amount:-0.000000000001,attribution:{kind:"unattributed",resourceId:null,reason:"missing-resource-id"}},
   {subscriptionId:ids.subscription,currency:"USD",amount:1.23456789,attribution:{kind:"unattributed",resourceId:resourceId.replace(/[^/]+$/,"removed-bill"),reason:"outside-inventory"}}],
   totals:[{currency:"CAD",amount:0,subscriptionIds:[ids.subscription]},{currency:"USD",amount:1.23456789-0.000000000001,subscriptionIds:[ids.subscription]}]};
  result.actualCost.monthToDate={state:"partial",data,reasons:["collection-partial"]};result.actualCost.trailing30Days={state:"unavailable",reason:"no-data"};
  const entry=advisorCatalog.entries.find(e=>e.resourceTypes.includes("microsoft.web/sites"))!;
  const advice=mapAdvisorRows([{subscriptionId:ids.subscription,value:{id:"mapped",properties:{recommendationTypeId:entry.recommendationTypeId,resourceMetadata:{resourceId}}}},
    {subscriptionId:ids.subscription,value:{id:"unmapped",properties:{recommendationTypeId:ids.subscription,resourceMetadata:{resourceId}}}}],[resourceId],now);
  result.advisor={state:"partial",data:advice,reasons:["unmapped-advisor-type"]};
 }
 await parents.completeAssessment(id,result);return {id,result,parents};
}
const read=(id:string,lang="en")=>GET(new Request(`http://localhost/api/assessments/${id}/report?lang=${lang}`),{params:Promise.resolve({id})});
it("downloads saved partial costs, credits/zero/no-data, Advisor coverage and complete comparison through the actual route without recomputing or writes",async()=>{
 const f=await stored({costs:true});const original=(await db.query("select * from assessments")).rows;
 const checks=vi.spyOn(engine,"evaluateAssessmentRules");const compare=vi.spyOn(diffEngine,"compareScans");const external=vi.spyOn(globalThis,"fetch");
 for(const lang of ["en","ko","en"]){
  const response=await read(f.id,lang);expect(response.status).toBe(200);const md=await response.text();
  expect(md).toContain("CAD 0");expect(md).toContain("USD -1e-12");expect(md).toContain("USD 1.23456789");
  expect(md).toContain(lang === "en"?"No billing data returned":"청구");
  expect(md.includes("PRIVATE")).toBe(false);expect(md.includes("![remote]")).toBe(true); // inert inside robust fence
  expect(md).toContain("`````text");expect(md).toContain(lang === "en"?"No longer observed in collection scope":"관측");
  expect(md).toContain(lang === "en"?"not an Azure":"Azure");expect(md).toContain(lang === "en"?"Unmapped Advisor type":"매핑");
  expect(md).toContain("Test workspace");expect(md).toContain(workspaceId); // saved owner's stored label beside its immutable ID
 }
 const page=await Page({params:Promise.resolve({id:f.id}),searchParams:Promise.resolve({lang:"ko"})});
 const html=renderToStaticMarkup(<I18nProvider locale="ko">{page}</I18nProvider>);
 expect(html).toContain('lang="ko"');expect(html).toContain("점검 보고서");expect(html.includes("<img")).toBe(false);expect(html.includes("PRIVATE")).toBe(false);
 expect(html).toContain("&lt;img");expect(checks).not.toHaveBeenCalled();expect(compare).not.toHaveBeenCalled();expect(external).not.toHaveBeenCalled();expect(m.claude).not.toHaveBeenCalled();expect(m.owner).not.toHaveBeenCalled();
 expect((await db.query("select * from assessments")).rows).toEqual(original);expect((await db.query("select * from llm_calls")).rows).toHaveLength(0);
});
it.each([{source:"import" as const},{legacy:true},{partial:true},{scope:true}])("keeps conservative comparison/scope provenance %j in saved downloads",async options=>{
 const f=await stored(options),r=await read(f.id);expect(r.status).toBe(200);const md=await r.text();
 expect(md).toContain("Change unknown");expect(md).toContain("not an Azure");
 if(options.source)expect(md).toContain("Imported scope unverified");
 if(options.legacy)expect(md).toContain("Legacy collection completeness unknown");
 if(options.partial)expect(md).toContain("Partial collection");
 if(options.scope)expect(md).toContain("Scope not collected");
});
it("failed/pending roadmaps remain independent and GET never interrupts them; corrupted proof/parent fail closed",async()=>{
 const f=await stored(),store=createAssessmentRoadmapsDb({db:async()=>db});
 const attempt=(await store.reserveAssessmentRoadmap(f.id,new Date(0)))!;
 const before=(await db.query("select * from assessments")).rows;
 expect(await (await read(f.id)).text()).toContain("Generating roadmap");expect((await db.query("select * from assessments")).rows).toEqual(before);
 await store.failAssessmentRoadmap(f.id,attempt.attemptId,"timeout",null);
 expect(await (await read(f.id)).text()).toContain("Timed out");expect((await f.parents.getAssessment(f.id))!.status).toBe("succeeded");
 await db.query("update assessments set saved_evidence=null where id=$1",[f.id]);
 const checks=vi.spyOn(engine,"evaluateAssessmentRules");const r=await read(f.id);expect(r.status).toBe(500);expect(await r.json()).toEqual({code:"unavailable"});expect(checks).not.toHaveBeenCalled();
});
