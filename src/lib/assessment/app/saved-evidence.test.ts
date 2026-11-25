import {expect,it} from "vitest";
import {assessment,completeSnapshot} from "@/lib/completion/fixtures.test-data";
import {sealAssessmentEvidence,readAssessmentEvidence,currentAssessmentCatalogData} from "./saved-evidence";
it("retains exact rule and Advisor catalogs through JSONB key reordering",()=>{
 const data=currentAssessmentCatalogData(),result=structuredClone(assessment);
 result.local.rulesVersion=data.rules.version;
 if("data" in result.advisor) result.advisor.data.mappingVersion=data.advisor.version;
 const source={source:{scan:completeSnapshot.record,inventory:completeSnapshot.inventory},previous:null};
 const saved=sealAssessmentEvidence(result,source,data);
 const reordered=JSON.parse(JSON.stringify(saved,(_key,value)=>value && typeof value === "object" && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).reverse()) : value));
 expect(readAssessmentEvidence(reordered,result,source)).toEqual(data);
});
it.each(["result","source","catalog"])("rejects altered saved %s",kind=>{
 const data=currentAssessmentCatalogData(),result=structuredClone(assessment);
 result.local.rulesVersion=data.rules.version;
 if("data" in result.advisor) result.advisor.data.mappingVersion=data.advisor.version;
 const source={source:{scan:structuredClone(completeSnapshot.record),inventory:structuredClone(completeSnapshot.inventory)},previous:null};
 const saved=sealAssessmentEvidence(result,source,data);
 if(kind === "result") result.createdAt="2026-11-12T12:00:00Z";
 if(kind === "source") source.source.inventory.resources[0].location="westus2";
 if(kind === "catalog") saved.rules.rules[0].title.en += " Altered.";
 expect(()=>readAssessmentEvidence(saved,result,source)).toThrow("assessment-storage-invalid");
});
