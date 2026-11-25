import { fireEvent, render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { ReportView } from "./report-view";
import { defaultSelection, parseSelection } from "@/lib/report/selection";
import { assessDocument, buildDocument } from "@/lib/report/document";
import { reportFixture } from "@/lib/assessment/report/fixtures.test-data";
import { buildAssessmentReport } from "@/lib/assessment/report/document";
import sample from "@/lib/analysis/fixtures/sample-result.json";
import type { AnalysisResult } from "@/types/analysis";
const owner=(workspaceId:string,companyName:string|null="Synthetic examples only · 합성 예제 전용")=>({workspaceId,name:"Synthetic offline demo",companyName});
it.each(["en","ko"] as const)("renders semantic %s summary, chart alternative and scoped appendix with inert text",locale=>{
 const f=reportFixture(); const doc=assessDocument(f.record,f.catalogData,buildAssessmentReport(f.record,f.catalogData,locale),defaultSelection(locale),owner(f.record.workspaceId));
 const attack='<img src="https://evil.test/track" onerror="alert(1)">';doc.subject=attack;
 const {container}=render(<ReportView report={doc}/>);
 expect(container.querySelector("article")).toHaveAttribute("lang",locale);
 expect(screen.getByRole("heading",{level:1})).toHaveTextContent(doc.title);
 expect(container.querySelectorAll("script,img,iframe,object")).toHaveLength(0);
 expect(screen.getByText(attack)).toBeInTheDocument();
 expect(screen.getByRole("table",{name:doc.chart!.title})).toBeInTheDocument();
 expect(container.querySelectorAll("thead th[scope='col']").length).toBeGreaterThan(0);
 expect(screen.getByRole("heading",{name:locale==="en"?"Detailed appendix":"상세 부록"})).toBeInTheDocument();
 const print=vi.spyOn(window,"print").mockImplementation(()=>{});
 fireEvent.click(screen.getByRole("button",{name:locale==="en"?"Print / save PDF":"인쇄 / PDF 저장"}));expect(print).toHaveBeenCalledOnce();print.mockRestore();
});
it("summary excludes raw IDs/evidence and preserves filters when changing language",()=>{
 const f=reportFixture(),selection={...defaultSelection("en"),scope:"summary" as const,severity:"high",sections:["findings","cost"] as const};
 const doc=assessDocument(f.record,f.catalogData,buildAssessmentReport(f.record,f.catalogData,"en"),{...selection,sections:[...selection.sections]},owner(f.record.workspaceId));
 const {container}=render(<ReportView report={doc}/>);
 expect(container.textContent).not.toContain(f.record.sourceScanId);
 expect(container.textContent).not.toContain(f.record.workspaceId);
 expect(container.querySelector('[data-report-appendix]')).toBeNull();
 const ko=screen.getByRole("link",{name:"한국어"});expect(ko.getAttribute("href")).toContain("severity=high");expect(ko.getAttribute("href")).toContain("scope=summary");
 expect(screen.getByText(/Showing .* of .* findings/)).toBeInTheDocument();
});
it("keeps selected plan detail and read-only print controls separate",()=>{
 const doc=buildDocument({id:"synthetic",workspaceId:"synthetic-owner",createdAt:"2026-11-13T12:00:00Z",result:sample as AnalysisResult},{...defaultSelection("en"),tier:"low"},owner("synthetic-owner"));
 render(<ReportView report={doc}/>);
 const compare=screen.getByRole("table",{name:"Option comparison"});expect(within(compare).getAllByRole("row")).toHaveLength(2);
 expect(screen.getByRole("form",{name:"Report scope"})).toHaveAttribute("method","get");
});
it("printed Assess scope states that finding filters leave other saved component scopes intact",()=>{
 const f=reportFixture();const doc=assessDocument(f.record,f.catalogData,buildAssessmentReport(f.record,f.catalogData,"en"),{...defaultSelection("en"),severity:"high"},owner(f.record.workspaceId));
 render(<ReportView report={doc}/>);
 expect(screen.getByText(/filters apply only to local findings/)).toHaveTextContent("original saved scope");
});
it.each([["en","Company","Workspace","Not set"],["ko","회사","워크스페이스","설정 안 됨"]] as const)("cover identifies the saved owner's stored %s workspace and company labels without the raw owner ID",(locale,company,workspace,unset)=>{
 const f=reportFixture();
 const doc=assessDocument(f.record,f.catalogData,buildAssessmentReport(f.record,f.catalogData,locale),{...defaultSelection(locale),scope:"summary"},owner(f.record.workspaceId));
 const {container,rerender}=render(<ReportView report={doc}/>);
 const cover=container.querySelector("header")!;
 expect(within(cover).getByText(company).nextSibling).toHaveTextContent("Synthetic examples only · 합성 예제 전용");
 expect(within(cover).getByText(workspace).nextSibling).toHaveTextContent("Synthetic offline demo");
 expect(container.textContent).not.toContain(f.record.workspaceId);
 rerender(<ReportView report={{...doc,owner:{...doc.owner,companyName:null}}}/>);
 expect(within(container.querySelector("header")!).getByText(company).nextSibling).toHaveTextContent(unset);
});
it("prints on Letter without a paper selector or paper query in language links",()=>{
 const doc=buildDocument({id:"synthetic",workspaceId:"synthetic-owner",createdAt:"2026-11-13T12:00:00Z",result:sample as AnalysisResult},{...defaultSelection("en"),tier:"ha"},owner("synthetic-owner"));
 render(<ReportView report={doc}/>);
 expect(screen.queryByRole("combobox",{name:"Paper size"})).not.toBeInTheDocument();
 expect(screen.getByText(/Letter/)).toBeInTheDocument();
 const ko=screen.getByRole("link",{name:"한국어"}).getAttribute("href")!;
 expect(ko).not.toContain("paper=");expect(ko).toContain("tier=ha");
});
it.each(["summary","full"] as const)("%s print flow ends inside the last page container so the footer cannot become a page by itself",scope=>{
 const f=reportFixture();
 const doc=assessDocument(f.record,f.catalogData,buildAssessmentReport(f.record,f.catalogData,"en"),{...defaultSelection("en"),scope},owner(f.record.workspaceId));
 const {container}=render(<ReportView report={doc}/>);
 const article=container.querySelector("article")!,last=article.lastElementChild!;
 expect(last.matches(scope==="full"?"[data-report-appendix]":"[data-report-page='executive-detail']")).toBe(true);
 const footer=container.querySelector("footer")!;
 expect(last.lastElementChild).toBe(footer);
 expect(footer).toHaveTextContent("CloudMaru · Assessment report · EN");
 // Content and counts stay present; nothing is hidden to make the page fit.
 expect(screen.getAllByText(/Showing \d+ of \d+ findings/).length).toBeGreaterThan(0);
});
it("print CSS paints a white page backdrop, uses Letter pages and keeps the footer with the final content",()=>{
 const css=readFileSync(join(process.cwd(),"src/components/report/report.module.css"),"utf8");
 const print=css.slice(css.indexOf("@media print"));
 expect(print).not.toMatch(/size:A4/i);
 expect(print).toMatch(/@page letter\{size:letter portrait;/);
 expect(print).not.toMatch(/size:auto/);
 expect(print).toContain('.report{page:letter}');
 expect(print).toMatch(/:global\(html\):has\(\.report\)[^{]*\{[^}]*color-scheme:light[^}]*background:#fff/);
 expect(print).toMatch(/\.footer\{[^}]*break-before:avoid/);
 expect(print).not.toMatch(/\.footer\{[^}]*display:none/);
});
it("F2 hidden section field only carries sections available for the report kind",()=>{
 const f=reportFixture();
 const assess=render(<ReportView report={assessDocument(f.record,f.catalogData,buildAssessmentReport(f.record,f.catalogData,"en"),parseSelection({},"en","assess"),owner(f.record.workspaceId))}/>);
 expect(assess.container.querySelector<HTMLInputElement>("input[name='sections']")!.value.split(",")).not.toContain("proposal");
 fireEvent.click(within(assess.container).getByRole("checkbox",{name:"Findings"}));
 expect(assess.container.querySelector<HTMLInputElement>("input[name='sections']")!.value).toBe("roadmap,advisor,cost,changes,sources,evidence");
 assess.unmount();
 const build=render(<ReportView report={buildDocument({id:"synthetic",workspaceId:"synthetic-owner",createdAt:"2026-11-13T12:00:00Z",result:sample as AnalysisResult},parseSelection({},"en","build"),owner("synthetic-owner"))}/>);
 expect(build.container.querySelector<HTMLInputElement>("input[name='sections']")!.value).toBe("proposal,sources,evidence");
 expect(screen.getByRole("button",{name:"Apply scope"})).toBeEnabled();
});
