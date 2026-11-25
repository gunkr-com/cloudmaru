import {expect,it} from "vitest";
import {normalizeCostTotalForDisplay} from "./cost-display";
it("removes floating residual using the precision of original rows",()=>{
 expect(normalizeCostTotalForDisplay(0.1+0.2-0.3,[{amount:0.1},{amount:0.2},{amount:-0.3}])).toBe(0);
});
it("preserves real subcent and very small original adjustments",()=>{
 expect(normalizeCostTotalForDisplay(-1e-12,[{amount:-1e-12}])).toBe(-1e-12);
 expect(normalizeCostTotalForDisplay(5e-120,[{amount:5e-120}])).toBe(5e-120);
});
it("leaves a total without source rows intact",()=>{
 expect(normalizeCostTotalForDisplay(0.123,[])).toBe(0.123);
});
