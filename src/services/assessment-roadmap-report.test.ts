// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { setupRoadmapIntegration } from "./assessment-roadmap.test-data";
import * as rules from "@/lib/assessment/rules/catalog";
import { createAssessmentReportService } from "./assessment-roadmap-report";
import type { PGlite } from "@electric-sql/pglite";
const currentWorkspace=vi.hoisted(()=>vi.fn());
vi.mock("./current-workspace",()=>({getCurrentWorkspace:currentWorkspace}));
let db: PGlite;
afterEach(async()=>{vi.restoreAllMocks();await db?.close();});
it("reads actual pinned16 parent/catalog and verified19 roadmap; does not call transport or mutate rows",async()=>{
  const f=await setupRoadmapIntegration();db=f.db;
  let task!:()=>Promise<void>;
  await f.jobs.start(f.id,f.workspaceId,f.workspaceId,t=>{task=t;});await task();
  f.request.mockClear();f.hasKey.mockClear();
  const currentCatalog=vi.spyOn(rules,"loadAssessmentRules").mockImplementation(()=>{throw Error("current catalog must not be loaded");});
  const external=vi.spyOn(globalThis,"fetch").mockRejectedValue(Error("network forbidden"));
  const service=createAssessmentReportService({db:async()=>db});
  const before=(await db.query("select * from assessments")).rows;
  for(const locale of ["en","ko","en"] as const){
    const report=await service.get(f.id,locale);
    expect(report?.id).toBe(f.id);expect(report?.locale).toBe(locale);
    expect(JSON.stringify(report)).toContain(f.result.sourceScan.id);
    expect(JSON.stringify(report)).toContain(locale === "en" ? "AI-organized" : "AI가");
  }
  expect((await db.query("select * from assessments")).rows).toEqual(before);
  expect((await db.query("select * from llm_calls")).rows).toHaveLength(1);
  expect(currentCatalog).not.toHaveBeenCalled();expect(external).not.toHaveBeenCalled();expect(f.request).not.toHaveBeenCalled();expect(f.hasKey).not.toHaveBeenCalled();
});
it("fails before16 current-engine fallback on unpinned parent, corrupted proof or invalid id",async()=>{
  const f=await setupRoadmapIntegration();db=f.db;
  const service=createAssessmentReportService({db:async()=>db});
  expect(await service.get("bad", "en")).toBeNull();
  await db.query("update assessments set saved_evidence=null where id=$1",[f.id]);
  await expect(service.get(f.id,"en")).rejects.toThrow("assessment-report-unavailable");
});

it("rejects tampered exact-attempt proof without regenerating the report",async()=>{
  const f=await setupRoadmapIntegration();db=f.db;
  let task!:()=>Promise<void>;await f.jobs.start(f.id,f.workspaceId,f.workspaceId,t=>{task=t;});await task();
  await db.query("delete from assessment_roadmap_evidence where assessment_id=$1",[f.id]);
  const service=createAssessmentReportService({db:async()=>db});
  await expect(service.get(f.id,"en")).rejects.toThrow("assessment-report-unavailable");
  expect((await f.parents.getAssessment(f.id))!.status).toBe("succeeded");
  expect((await db.query("select * from llm_calls")).rows).toHaveLength(1);
});

it("provides a scoped presentation through the same verified saved reader, without writes or current prices",async()=>{
 const f=await setupRoadmapIntegration();db=f.db;
 const service=createAssessmentReportService({db:async()=>db});
 const before=(await db.query("select * from assessments")).rows;
 const {defaultSelection}=await import("@/lib/report/selection");
 const doc=await service.presentation(f.id,{...defaultSelection("en"),scope:"summary",severity:"high"});
 expect(doc?.kind).toBe("assess");expect(doc?.workspaceId).toBe(f.workspaceId);
 expect(doc?.selection.scope).toBe("summary");
 expect((await db.query("select * from assessments")).rows).toEqual(before);
 expect(f.request).not.toHaveBeenCalled();expect(f.hasKey).not.toHaveBeenCalled();
});

it("labels Markdown and presentation with the saved owner's stored names only, without writes or a current-workspace read",async()=>{
 const f=await setupRoadmapIntegration();db=f.db;
 await db.query("update workspaces set name=$2, company_name=$3 where id=$1",[f.workspaceId,"Synthetic offline demo","Synthetic examples only · 합성 예제 전용"]);
 // Another company exists (and could be the current cookie selection); it must never label this record.
 await db.query("insert into workspaces(name, company_name) values ($1,$2)",["Other current workspace","Other company"]);
 currentWorkspace.mockReset().mockRejectedValue(Error("current workspace must not be read"));
 const external=vi.spyOn(globalThis,"fetch").mockRejectedValue(Error("network forbidden"));
 const service=createAssessmentReportService({db:async()=>db});
 const before={assessments:(await db.query("select * from assessments")).rows,workspaces:(await db.query("select * from workspaces order by id")).rows};
 const {reportMarkdown}=await import("@/lib/assessment/report/markdown");
 const {defaultSelection}=await import("@/lib/report/selection");
 for(const locale of ["en","ko"] as const){
  const md=reportMarkdown((await service.get(f.id,locale))!);
  expect(md).toContain("Synthetic offline demo");expect(md).toContain("Synthetic examples only · 합성 예제 전용");expect(md).toContain(f.workspaceId);
  expect(md).not.toContain("Other current workspace");expect(md).not.toContain("Other company");
  const doc=(await service.presentation(f.id,defaultSelection(locale)))!;
  expect(doc.owner).toEqual({workspaceId:f.workspaceId,name:"Synthetic offline demo",companyName:"Synthetic examples only · 합성 예제 전용"});
  expect(JSON.stringify(doc.appendix)).toContain("Synthetic offline demo");
 }
 expect((await db.query("select * from assessments")).rows).toEqual(before.assessments);
 expect((await db.query("select * from workspaces order by id")).rows).toEqual(before.workspaces);
 expect(currentWorkspace).not.toHaveBeenCalled();expect(external).not.toHaveBeenCalled();expect(f.request).not.toHaveBeenCalled();expect(f.hasKey).not.toHaveBeenCalled();
});
