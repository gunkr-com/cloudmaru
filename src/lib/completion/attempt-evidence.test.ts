import {expect,it} from "vitest";
import type {AttemptEvidenceBinding} from "@/types/completion-evidence";
import {ids} from "./fixtures.test-data";
import {sealAttemptEvidence,verifyAttemptEvidence} from "./attempt-evidence";
const binding:AttemptEvidenceBinding={source:"assessment-roadmap" as const,rowId:ids.assessment,attemptId:ids.extension,kind:"roadmap" as const};
const validation={policyVersion:"roadmap-v1"};
it("preserves validated content evidence through JSONB key ordering without storing source text",()=>{
 const content={summary:{en:"Private text",ko:"비공개 문장"}},basis={catalog:{version:"v1"},parent:{id:ids.assessment}};
 const evidence=sealAttemptEvidence(binding,content,basis,validation);
 const reordered=JSON.parse(JSON.stringify(evidence,(_key,value)=>value && typeof value === "object" && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).reverse()) : value));
 expect(verifyAttemptEvidence(reordered,binding,content,basis)).toEqual(validation);
 expect(JSON.stringify(evidence)).not.toContain("Private text");
});
it.each(["attempt","row","source","kind","content","basis","evidence"])("rejects changed %s",kind=>{
 const content={x:1},basis={catalog:"saved"},evidence=sealAttemptEvidence(binding,content,basis,validation);
 const current:AttemptEvidenceBinding={...binding};
 if(kind === "attempt") current.attemptId=ids.scan;
 if(kind === "row") current.rowId=ids.scan;
 if(kind === "source") Object.assign(current,{source:"extension-artifact"});
 if(kind === "kind") Object.assign(current,{kind:"guide"});
 if(kind === "content") content.x=2;
 if(kind === "basis") basis.catalog="later";
 if(kind === "evidence") evidence.contentDigest="0".repeat(64);
 expect(()=>verifyAttemptEvidence(evidence,current,content,basis)).toThrow("completion-evidence-invalid");
});
it("retains compiler validation metadata for historical artifact reads",()=>{
 const artifact={...binding,source:"extension-artifact" as const,kind:"bicep" as const};
 const details={policyVersion:"extension-bicep-v1",compilerVersion:"0.49.2"};
 const evidence=sealAttemptEvidence(artifact,{code:"synthetic"},{parent:"saved"},details);
 expect(verifyAttemptEvidence(evidence,artifact,{code:"synthetic"},{parent:"saved"})).toEqual(details);
});
it("requires compile-version evidence only for Bicep and rejects non-JSON bases",()=>{
 const artifact={...binding,source:"extension-artifact" as const,kind:"bicep" as const};
 expect(()=>sealAttemptEvidence(artifact,{}, {},validation)).toThrow("completion-evidence-invalid");
 expect(()=>sealAttemptEvidence(binding,{}, {},{...validation,compilerVersion:"0.49.2"})).toThrow("completion-evidence-invalid");
 expect(()=>sealAttemptEvidence(binding,{},new Map(),validation)).toThrow("completion-evidence-invalid");
});
