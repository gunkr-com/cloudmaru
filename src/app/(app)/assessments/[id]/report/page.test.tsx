import { render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { reportFixture } from "@/lib/assessment/report/fixtures.test-data";
import { buildAssessmentReport } from "@/lib/assessment/report/document";
import { assessDocument } from "@/lib/report/document";
const m=vi.hoisted(()=>({get:vi.fn(),locale:vi.fn()}));
vi.mock("@/services/assessment-roadmap-report",()=>({assessmentReports:{presentation:m.get}}));
vi.mock("@/i18n/server",()=>({getLocale:m.locale}));
vi.mock("next/navigation",()=>({notFound:()=>{throw Error("not-found");}}));
import Page from "./page";
const id="00000000-0000-4000-8000-000000000001";
beforeEach(()=>{vi.resetAllMocks();m.locale.mockResolvedValue("en");m.get.mockImplementation(async(_id,selection)=>{
 const f=reportFixture();return assessDocument(f.record,f.catalogData,buildAssessmentReport(f.record,f.catalogData,selection.locale),selection,{workspaceId:f.record.workspaceId,name:"Synthetic offline demo",companyName:null});
});});
it("uses the verified saved report and requested language/scope",async()=>{
 render(await Page({params:Promise.resolve({id}),searchParams:Promise.resolve({lang:"ko",scope:"summary",severity:"high"})}));
 expect(screen.getByRole("heading",{level:1})).toHaveTextContent("점검 보고서");
 expect(m.get).toHaveBeenCalledWith(id,expect.objectContaining({locale:"ko",scope:"summary",severity:"high"}));
});
it("rejects ambiguous/invalid scope before reading and sanitizes failures",async()=>{
 for(const query of [{lang:["en","ko"]},{severity:"typo"},{sections:"cost,cost"}])await expect(Page({params:Promise.resolve({id}),searchParams:Promise.resolve(query)})).rejects.toThrow("not-found");
 expect(m.get).not.toHaveBeenCalled();m.get.mockResolvedValue(null);
 await expect(Page({params:Promise.resolve({id}),searchParams:Promise.resolve({})})).rejects.toThrow("not-found");
 m.get.mockRejectedValue(Error("SECRET"));render(await Page({params:Promise.resolve({id}),searchParams:Promise.resolve({})}));
 expect(screen.getByRole("alert")).toHaveTextContent("saved report is unavailable");expect(document.body.textContent).not.toContain("SECRET");
});
it("F2 rejects report-inapplicable sections before any read",async()=>{
 await expect(Page({params:Promise.resolve({id:"00000000-0000-4000-8000-000000000001"}),searchParams:Promise.resolve({sections:"proposal"})})).rejects.toThrow("not-found");
 expect(m.get).not.toHaveBeenCalled();
});
