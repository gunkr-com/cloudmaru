// @vitest-environment node
import {afterEach, expect, it, vi} from "vitest";
import {logExtensionValidation} from "./extension-validation-log";
afterEach(()=>vi.restoreAllMocks());
it("logs bounded server-owned paths and reason codes per validation attempt",()=>{
 const spy=vi.spyOn(console,"info").mockImplementation(()=>{});
 logExtensionValidation("00000000-0000-4000-8000-000000000001",{attempt:2,errors:["plans.2.title.en: unsafe-text-or-service-reference","plans.1.newItems: postgres-storage-basis-mismatch"]});
 expect(spy).toHaveBeenCalledWith("[cloudsight:extension-validation]",{id:"00000000-0000-4000-8000-000000000001",attempt:2,valid:false,issues:[{path:"plans.2.title.en",code:"unsafe-text-or-service-reference"},{path:"plans.1.newItems",code:"postgres-storage-basis-mismatch"}],omitted:0});
});
it("never forwards unknown keys, values, malformed ids or excessive errors",()=>{
 const spy=vi.spyOn(console,"info").mockImplementation(()=>{});
 const secret="sk-ant-private-company-value";
 logExtensionValidation(secret,{attempt:1,errors:[`${secret}: invalid-model-structure`,`plans.0.${secret}: invalid-proposal-structure`,`title: ${secret}`, ...Array(100).fill("plans.0: unknown-component")]});
 const event=spy.mock.calls[0][1] as {issues:unknown[];omitted:number};
 expect(JSON.stringify(spy.mock.calls)).not.toContain(secret);
 expect(event.issues).toHaveLength(20);expect(event.omitted).toBe(83);
});
it("reports successful validation without serializing output",()=>{
 const spy=vi.spyOn(console,"info").mockImplementation(()=>{});
 logExtensionValidation("00000000-0000-4000-8000-000000000001",{attempt:1,errors:[]});
 expect(spy.mock.calls[0][1]).toMatchObject({attempt:1,valid:true,issues:[]});
});
