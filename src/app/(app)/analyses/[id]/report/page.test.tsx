import { render,screen } from "@testing-library/react";
import { beforeEach,expect,it,vi } from "vitest";
import sample from "@/lib/analysis/fixtures/sample-result.json";
const m=vi.hoisted(()=>({get:vi.fn(),workspace:vi.fn(),current:vi.fn()}));
vi.mock("@/services/db/analyses",()=>({getAnalysis:m.get}));
vi.mock("@/services/db/workspaces",()=>({getWorkspace:m.workspace}));
vi.mock("@/services/current-workspace",()=>({getCurrentWorkspace:m.current}));
vi.mock("@/i18n/server",()=>({getLocale:async()=>"en"}));
vi.mock("next/navigation",()=>({notFound:()=>{throw Error("not-found");}}));
import Page from "./page";
const id="00000000-0000-4000-8000-000000000001";
const saved="00000000-0000-4000-8000-0000000000aa",current="00000000-0000-4000-8000-0000000000bb";
const ws=(wid:string,name:string,companyName:string|null)=>({id:wid,name,companyName,defaultRegion:"canadacentral",currency:"CAD",createdAt:"2026-11-01T00:00:00Z",updatedAt:"2026-11-01T00:00:00Z"});
beforeEach(()=>{vi.resetAllMocks();m.get.mockResolvedValue({id,workspaceId:saved,createdAt:"2026-11-13T12:00:00Z",status:"succeeded",result:sample});
 m.workspace.mockImplementation(async(wid:string)=>wid===saved?ws(saved,"Synthetic offline demo","Synthetic examples only · 합성 예제 전용"):wid===current?ws(current,"Current cookie workspace","Current company"):null);
 m.current.mockResolvedValue(ws(current,"Current cookie workspace","Current company"));});
it("reads the requested saved Build owner and applies scope without pricing or model transport",async()=>{
 render(await Page({params:Promise.resolve({id}),searchParams:Promise.resolve({lang:"ko",scope:"summary",tier:"balanced"})}));
 expect(screen.getByRole("heading",{level:1})).toHaveTextContent("신규 구축 제안서");expect(m.get).toHaveBeenCalledWith(id);
 expect(document.body.textContent).not.toContain(saved);
});
it("rejects invalid queries/IDs before reading, missing/pending data and displays safe errors",async()=>{
 await expect(Page({params:Promise.resolve({id:"bad"}),searchParams:Promise.resolve({})})).rejects.toThrow("not-found");
 await expect(Page({params:Promise.resolve({id}),searchParams:Promise.resolve({sections:"made-up"})})).rejects.toThrow("not-found");expect(m.get).not.toHaveBeenCalled();
 m.get.mockResolvedValue({status:"pending",result:null});await expect(Page({params:Promise.resolve({id}),searchParams:Promise.resolve({})})).rejects.toThrow("not-found");
 m.get.mockRejectedValue(Error("SECRET"));render(await Page({params:Promise.resolve({id}),searchParams:Promise.resolve({})}));expect(screen.getByRole("alert")).not.toHaveTextContent("SECRET");
});
it("uses requested report language in document metadata",async()=>{
 const {generateMetadata}=await import("./page");
 expect((await generateMetadata({searchParams:Promise.resolve({lang:"ko"})})).title).toContain("신규 구축 제안서");
});
it("labels the report with the saved owner's stored names in one read, never the current workspace",async()=>{
 render(await Page({params:Promise.resolve({id}),searchParams:Promise.resolve({lang:"en"})}));
 expect(m.workspace).toHaveBeenCalledTimes(1);expect(m.workspace).toHaveBeenCalledWith(saved);expect(m.current).not.toHaveBeenCalled();
 expect(document.body.textContent).toContain("Synthetic offline demo");expect(document.body.textContent).toContain("Synthetic examples only · 합성 예제 전용");
 expect(document.body.textContent).not.toContain("Current cookie workspace");expect(document.body.textContent).not.toContain("Current company");
});
it("fails closed without substituting labels when the saved owner row is unavailable",async()=>{
 m.workspace.mockResolvedValue(null);
 render(await Page({params:Promise.resolve({id}),searchParams:Promise.resolve({})}));
 expect(screen.getByRole("alert")).toHaveTextContent("saved report is unavailable");expect(m.current).not.toHaveBeenCalled();
 m.workspace.mockRejectedValue(Error("SECRET STORE"));
 render(await Page({params:Promise.resolve({id}),searchParams:Promise.resolve({})}));
 expect(document.body.textContent).not.toContain("SECRET STORE");
});
it("F2 rejects report-inapplicable sections before any read",async()=>{
 await expect(Page({params:Promise.resolve({id:"00000000-0000-4000-8000-000000000001"}),searchParams:Promise.resolve({sections:"findings"})})).rejects.toThrow("not-found");
 expect(m.get).not.toHaveBeenCalled();
});
