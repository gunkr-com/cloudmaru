import type { NetworkDiagnostic } from "@/types/network-diagnostics";
import {expect,it} from "vitest";
import {networkDiagnostic,resourceIds} from "@/lib/completion/fixtures.test-data";
import {sanitizeNetworkDiagnostic} from "./presentation";
it("masks unexpected secret evidence before client serialization without mutating the saved verdict",()=>{
 const value: NetworkDiagnostic=structuredClone(networkDiagnostic);
 value.engine.paths=[{verdict:"unknown",reasonCodes:["missing-data"],hops:[{resourceId:resourceIds.nsg,hopType:"nsg",verdict:"unknown",reasonCodes:["missing-data"],evidence:[{resourceId:resourceIds.nsg,propertyPath:"/properties/password",observation:{state:"present",value:"test-secret"}}]}]}];
 const safe=sanitizeNetworkDiagnostic(value);
 expect(JSON.stringify(safe)).not.toContain("test-secret");
 expect(value.engine.paths[0].hops[0].evidence[0].observation).toEqual({state:"present",value:"test-secret"});
 expect(safe.engine.verdict).toBe(value.engine.verdict);
});
