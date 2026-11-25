// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
const mocks=vi.hoisted(()=>({get:vi.fn(),locale:vi.fn()}));
vi.mock("@/services/assessment-roadmap-report",()=>({assessmentReports:{get:mocks.get}}));
vi.mock("@/i18n/server",()=>({getLocale:mocks.locale}));
import { GET } from "./route";
const id="00000000-0000-4000-8000-000000000001";
const read=(query="",value=id)=>GET(new Request(`http://localhost/api/assessments/${value}/report${query}`),{params:Promise.resolve({id:value})});
beforeEach(()=>{vi.resetAllMocks();mocks.locale.mockResolvedValue("en");mocks.get.mockImplementation(async(id,locale)=>({id,locale,title:"Report",sections:[]}));});
it("returns safe Markdown attachment; exact lang overrides cookie and Vary/no-store/nosniff apply",async()=>{
  mocks.locale.mockResolvedValue("ko");
  const response=await read("?format=markdown&lang=en");
  expect(response.status).toBe(200);expect(mocks.get).toHaveBeenCalledWith(id,"en");
  expect(response.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
  expect(response.headers.get("content-disposition")).toBe(`attachment; filename="cloudsight-assessment-${id}.md"`);
  expect(response.headers.get("vary")).toBe("Cookie");expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect((await read()).headers.get("content-disposition")).toContain(".ko.md");
});
it.each(["?lang=bad","?format=pdf","?lang=en&lang=ko","?x=1"])("rejects query %s before reading saved data",async q=>{
  const r=await read(q);expect(r.status).toBe(400);expect(await r.json()).toEqual({code:"invalid-query"});expect(mocks.get).not.toHaveBeenCalled();
});
it("rejects invalid/missing IDs and sanitizes storage errors",async()=>{
  expect((await read("","invalid\"name")).status).toBe(404);expect(mocks.get).not.toHaveBeenCalled();
  mocks.get.mockResolvedValue(null);expect((await read()).status).toBe(404);
  mocks.get.mockRejectedValue(Error("SECRET /private/data"));const r=await read();expect(r.status).toBe(500);expect(await r.json()).toEqual({code:"unavailable"});
});
