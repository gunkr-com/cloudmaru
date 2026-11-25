import {expect,it} from "vitest";
import {fixture,proposalCatalog,proposalSupport} from "./proposal.test-data";
import {processExtensionOutput} from "./process";
import {sealExtensionEvidence,readExtensionEvidence} from "./saved-evidence";
import legacy from "./legacy-evidence.test-data.json";
import { extensionResultSchema } from "@/lib/completion/schema";

function data() {
  const f=fixture();
  const processed=processExtensionOutput(f.raw,f.context,{id:"00000000-0000-4000-8000-000000000777",createdAt:"2026-11-12T12:00:00.000Z"});
  if(!processed.ok) throw Error("fixture");
  return {source:{scan:f.context.scan,inventory:f.context.inventory},result:processed.value,core:{catalog:proposalCatalog,support:proposalSupport}};
}
it("retains exact catalog evidence through JSONB object key ordering",()=>{
  const f=data(),sealed=sealExtensionEvidence(f.result,f.core,f.source);
  const reordered=JSON.parse(JSON.stringify(sealed,(_key,value)=>value && !Array.isArray(value) && typeof value === "object" ? Object.fromEntries(Object.entries(value).reverse()) : value));
  expect(readExtensionEvidence(reordered,f.result,f.source)).toEqual(f.core);
});
it("reads frozen pre-cardinality evidence without altering its result, quantities, totals or digest", () => {
  const before = JSON.stringify(legacy);
  const result = extensionResultSchema.parse(legacy.result);
  expect(result).toEqual(legacy.result);
  expect(result.plans.every(p => p.newItems.every(i => !Object.hasOwn(i, "instanceCount")))).toBe(true);
  expect(readExtensionEvidence(legacy.evidence, result, legacy.source)).toEqual({ catalog: legacy.evidence.catalog, support: legacy.evidence.support });
  expect(JSON.stringify(legacy)).toBe(before);
});
it.each(["result","snapshot","digest","source"])("rejects altered %s rather than accepting historical corruption",kind=>{
  const f=data(),sealed=structuredClone(sealExtensionEvidence(f.result,f.core,f.source));
  if(kind === "result") f.result.plans[0].checks[3].reasonCodes=["missing-data"];
  if(kind === "snapshot") sealed.catalog.prices.asOf="2026-11-12";
  if(kind === "source") f.source.inventory.resources[0].location="westus2";
  if(kind === "digest") sealed.resultDigest="0".repeat(64);
  expect(()=>readExtensionEvidence(sealed,f.result,f.source)).toThrow("validation-failed");
});
