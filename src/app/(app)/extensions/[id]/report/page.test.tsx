import { render,screen } from "@testing-library/react";
import { beforeEach,expect,it,vi } from "vitest";
import { processedFixture } from "@/lib/extend/proposal.test-data";
import { buildExtensionDisplay } from "@/lib/extend-app/result";
const m=vi.hoisted(()=>({get:vi.fn(),workspace:vi.fn(),current:vi.fn()}));
vi.mock("@/services/extension-job-result",()=>({extensionResults:{getDisplay:m.get}}));
vi.mock("@/services/db/workspaces",()=>({getWorkspace:m.workspace}));
vi.mock("@/services/current-workspace",()=>({getCurrentWorkspace:m.current}));
vi.mock("@/i18n/server",()=>({getLocale:async()=>"en"}));
vi.mock("next/navigation",()=>({notFound:()=>{throw Error("not-found");}}));
import Page from "./page";
const id="00000000-0000-4000-8000-000000000001";
const ws=(wid:string,name:string,companyName:string|null)=>({id:wid,name,companyName,defaultRegion:"canadacentral",currency:"CAD",createdAt:"2026-11-01T00:00:00Z",updatedAt:"2026-11-01T00:00:00Z"});
let saved:string;
beforeEach(()=>{vi.resetAllMocks();const f=processedFixture();const display=buildExtensionDisplay(f.result,{catalog:f.context.catalog,support:f.context.support},f.context.inventory);saved=display.result.workspaceId;m.get.mockResolvedValue(display);
 m.workspace.mockImplementation(async(wid:string)=>wid===saved?ws(saved,"Synthetic offline demo","Synthetic examples only · 합성 예제 전용"):ws(wid,"Current cookie workspace","Current company"));
 m.current.mockResolvedValue(ws("00000000-0000-4000-8000-0000000000bb","Current cookie workspace","Current company"));});
it("uses pinned display only and accepts scoped proposal reports",async()=>{
 render(await Page({params:Promise.resolve({id}),searchParams:Promise.resolve({scope:"summary",tier:"low"})}));
 expect(screen.getByRole("heading",{level:1})).toHaveTextContent("Extension proposal");expect(m.get).toHaveBeenCalledWith(id);
});
it("rejects invalid selection before reads and missing pinned evidence safely",async()=>{
 await expect(Page({params:Promise.resolve({id}),searchParams:Promise.resolve({scope:["full","summary"]})})).rejects.toThrow("not-found");expect(m.get).not.toHaveBeenCalled();
 m.get.mockResolvedValue(null);await expect(Page({params:Promise.resolve({id}),searchParams:Promise.resolve({})})).rejects.toThrow("not-found");
 m.get.mockRejectedValue(Error("SECRET"));render(await Page({params:Promise.resolve({id}),searchParams:Promise.resolve({})}));expect(screen.getByRole("alert")).not.toHaveTextContent("SECRET");
});
it("labels the report from the pinned result's saved owner only",async()=>{
 render(await Page({params:Promise.resolve({id}),searchParams:Promise.resolve({lang:"ko",scope:"summary"})}));
 expect(m.workspace).toHaveBeenCalledTimes(1);expect(m.workspace).toHaveBeenCalledWith(saved);expect(m.current).not.toHaveBeenCalled();
 expect(document.body.textContent).toContain("Synthetic offline demo");expect(document.body.textContent).toContain("Synthetic examples only · 합성 예제 전용");
 expect(document.body.textContent).not.toContain("Current cookie workspace");
 m.workspace.mockResolvedValue(null);
 render(await Page({params:Promise.resolve({id}),searchParams:Promise.resolve({})}));
 expect(screen.getByRole("alert")).toBeInTheDocument();
});
