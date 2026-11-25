import { expect, it } from "vitest";
import { reports as en } from "../en/reports";
import { reports as ko } from "../ko/reports";
import { MESSAGES } from "../index";
function shape(value:object):unknown {return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,typeof v === "string" ? [...v.matchAll(/\{([^}]+)\}/g)].map(m=>m[1]).sort():shape(v)]));}
it("registers matching nonempty reports dictionaries and interpolation parameters",()=>{
 expect(shape(ko)).toEqual(shape(en));expect(MESSAGES.en.reports).toBe(en);expect(MESSAGES.ko.reports).toBe(ko);
 for(const dictionary of [en,ko]) expect(JSON.stringify(dictionary)).not.toContain(':""');
});
