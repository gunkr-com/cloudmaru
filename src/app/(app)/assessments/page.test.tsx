import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { renderWithI18n as render } from "@/test/render-with-i18n";
import { ids, completeSnapshot, assessment } from "@/lib/completion/fixtures.test-data";
import {loadAssessmentRules} from "@/lib/assessment/rules/catalog";
import {advisorCatalog} from "@/lib/assessment/advisor-catalog";
import {evaluateAssessmentRules} from "@/lib/assessment/rules/engine";
import type { AssessmentRecord } from "@/services/db/assessments";
import type { RoadmapStatusData } from "@/lib/assessment/roadmap/job";
const mocks = vi.hoisted(() => ({ locale: "en", current: vi.fn(), owner: vi.fn(), get: vi.fn(), list: vi.fn(), scans: vi.fn(), scan: vi.fn(), inventory: vi.fn(), catalog:vi.fn(), fail: vi.fn(), push: vi.fn(), refresh: vi.fn(), roadmap: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: mocks.locale }) }) }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("404"); }, useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }) }));
vi.mock("@/services/current-workspace", () => ({ getCurrentWorkspace: mocks.current }));
vi.mock("@/services/db/workspaces", () => ({ getWorkspace: mocks.owner }));
vi.mock("@/services/db/assessments", () => ({ getAssessment: mocks.get, listAssessments: mocks.list, failAssessment: mocks.fail, getAssessmentCatalogData:mocks.catalog }));
vi.mock("@/services/db/scans", () => ({ listScans: mocks.scans, getScan: mocks.scan, getScanInventory: mocks.inventory }));
vi.mock("@/services/assessment-roadmap", () => ({ roadmapJobs: { get: mocks.roadmap } }));
import History from "./page";
import New from "./new/page";
import Detail from "./[id]/page";
const source = completeSnapshot.record;
const row: AssessmentRecord = { id: ids.assessment, workspaceId: ids.workspace, sourceScanId: ids.scan, previousScanId: null, input: { schemaVersion: 1, workspaceId: ids.workspace, sourceScanId: ids.scan, previousScanId: null }, status: "failed", result: null, error: { schemaVersion: 1, code: "internal" }, createdAt: new Date().toISOString(), completedAt: new Date().toISOString(), roadmap: { status: "not-requested", attemptId: null, content: null, error: null, usage: null, createdAt: null, completedAt: null } };
const props = () => ({ params: Promise.resolve({ id: ids.assessment }) });
beforeEach(() => {
  vi.clearAllMocks(); mocks.locale = "en";
  mocks.roadmap.mockResolvedValue(null);
  mocks.catalog.mockResolvedValue({rules:loadAssessmentRules(),advisor:advisorCatalog});
  mocks.current.mockResolvedValue({ id: ids.workspace, name: "Current" }); mocks.owner.mockResolvedValue({ id: ids.workspace, name: "Saved owner" });
  mocks.get.mockResolvedValue(row); mocks.list.mockResolvedValue([]); mocks.scans.mockResolvedValue([]); mocks.scan.mockResolvedValue(source); mocks.inventory.mockResolvedValue(completeSnapshot.inventory);
});
it.each(["en", "ko"] as const)("shows distinct empty history and no successful scans in %s", async locale => {
  mocks.locale = locale;
  const view = render(await History(), { locale });
  expect(mocks.list).toHaveBeenCalledWith(ids.workspace);
  expect(screen.getByText(locale === "en" ? "No assessments yet." : "아직 점검이 없습니다.")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: locale === "en" ? "New assessment" : "새 점검" })).toHaveAttribute("href", "/assessments/new");
  view.unmount();
  render(await New({ searchParams: Promise.resolve({}) }), { locale });
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: locale === "en" ? "Go to inventory" : "인벤토리로 이동" })).toHaveAttribute("href", "/inventory");
});
it("filters successful same-workspace scans and orders by collection time, without defaulting to latest", async () => {
  mocks.scans.mockResolvedValue([
    { ...source, id: "old", collectedAt: "2026-11-01T00:00:00Z" }, { ...source, id: "pending", status: "pending" },
    { ...source, id: "foreign", workspaceId: ids.otherWorkspace }, { ...source, id: "empty", summary: null },
    { ...source, id: "latest", collectedAt: "2026-11-12T00:00:00Z" },
  ]);
  render(await New({ searchParams: Promise.resolve({ sourceScanId: "foreign" }) }), { locale: "en" });
  const select = screen.getAllByRole("combobox")[0];
  expect(select).toHaveValue("");
  expect(Array.from(select.querySelectorAll("option")).map(o => o.value)).toEqual(["", "latest", "old"]);
  fireEvent.change(select, { target: { value: "latest" } });
  expect(Array.from(screen.getAllByRole("combobox")[1].querySelectorAll("option")).map(o => o.value)).toEqual(["", "old"]);
});
it.each(["en", "ko"] as const)("keeps the inventory entry scan selected ahead of a newer scan in %s", async locale => {
  mocks.locale = locale;
  mocks.scans.mockResolvedValue([
    { ...source, id: ids.oldScan, collectedAt: "2026-11-12T00:00:00Z" },
    source,
  ]);
  render(await New({ searchParams: Promise.resolve({ sourceScanId: source.id }) }), { locale });
  expect(screen.getAllByRole("combobox")[0]).toHaveValue(source.id);
  expect(mocks.scans).toHaveBeenCalledWith(ids.workspace, { limit: Number.MAX_SAFE_INTEGER });
  expect(mocks.inventory).not.toHaveBeenCalled();
  expect(mocks.catalog).not.toHaveBeenCalled();
});
it("saved history links reopen original result and retry prefills only the saved scans", async () => {
  mocks.list.mockResolvedValue([row]);
  const view = render(await History(), { locale: "en" });
  expect(screen.getByRole("link", { name: /Open saved assessment/ })).toHaveAttribute("href", `/assessments/${row.id}`);
  view.unmount();
  render(await Detail(props()), { locale: "en" });
  expect(screen.getByRole("alert")).toHaveTextContent("assessment failed");
  expect(screen.getByRole("link", { name: "Run a new assessment with these scans" })).toHaveAttribute("href", `/assessments/new?sourceScanId=${ids.scan}`);
});
it("retains saved owner on cookie mismatch and offers a safe current-workspace new run without retry payload", async () => {
  mocks.current.mockResolvedValue({ id: ids.otherWorkspace });
  render(await Detail(props()), { locale: "en" });
  expect(screen.getByText(/This assessment belongs to Saved owner/)).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Run a new assessment with these scans" })).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Start in the current workspace" })).toHaveAttribute("href", "/assessments/new");
});
it("polls only pending; stale pending is failed conditionally and reread to preserve concurrent success", async () => {
  mocks.get.mockResolvedValueOnce({ ...row, status: "pending", error: null, completedAt: null });
  const view = render(await Detail(props()), { locale: "en" });
  expect(screen.getByRole("status")).toHaveTextContent("Assessing"); view.unmount();
  mocks.get.mockResolvedValueOnce({ ...row, status: "pending", createdAt: "2026-01-01T00:00:00Z" }).mockResolvedValueOnce({ ...row, status: "succeeded", result: { ...assessment, local: { ...assessment.local, findings: [] } } });
  render(await Detail(props()), { locale: "en" });
  expect(mocks.fail).toHaveBeenCalledWith(row.id, "interrupted");
  expect(screen.queryByText(/Assessing the saved scan/)).not.toBeInTheDocument();
  expect(screen.getByRole("region", { name: "Local checks" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /roadmap|report/i })).not.toBeInTheDocument();
});
it("uses 404 for missing saved assessment", async () => {
  mocks.get.mockResolvedValue(null);
  await expect(Detail(props())).rejects.toThrow("404");
});

it("closes only stale pending history rows and rereads a concurrent success", async () => {
  const stale={...row,status:"pending",error:null,completedAt:null,createdAt:"2026-01-01T00:00:00Z"};
  mocks.list.mockResolvedValueOnce([stale,{...row,id:ids.oldScan}]).mockResolvedValueOnce([{...row,status:"succeeded",result:assessment}]);
  render(await History());
  expect(mocks.fail).toHaveBeenCalledTimes(1);
  expect(mocks.fail).toHaveBeenCalledWith(stale.id,"interrupted");
  expect(mocks.list).toHaveBeenCalledTimes(2);
  expect(screen.queryByText("Assessing")).not.toBeInTheDocument();
});

it("passes the saved catalog to the successful historical result page",async()=>{
 const local=evaluateAssessmentRules(completeSnapshot.inventory.resources,new Date().toISOString());
 const rules=structuredClone(loadAssessmentRules());
 rules.rules.find(rule=>rule.id === local.findings[0].ruleId)!.title.en="Historical source rule";
 mocks.get.mockResolvedValue({...row,status:"succeeded",error:null,result:{...assessment,local}});
 mocks.catalog.mockResolvedValue({rules,advisor:advisorCatalog});
 render(await Detail(props()),{locale:"en"});
 expect(mocks.catalog).toHaveBeenCalledWith(row.id);
 expect(screen.getAllByText("Historical source rule").length).toBeGreaterThan(0);
});

it("does not substitute the current catalog when saved catalog evidence disappears",async()=>{
 mocks.get.mockResolvedValue({...row,status:"succeeded",error:null,result:assessment});
 mocks.catalog.mockResolvedValue(null);
 await expect(Detail(props())).rejects.toThrow("404");
});

const roadmapData = (): RoadmapStatusData => ({
  id: row.id, workspaceId: row.workspaceId, sourceScanId: row.sourceScanId, workspaceMismatch: false,
  availability: "ready", coverage: { unit: "findings", total: 2, included: 1, excluded: 1, reasons: [{ code: "pass-finding", count: 1 }] },
  roadmap: { ...row.roadmap },
});
it.each(["en", "ko"] as const)("composes saved local checks and language-specific report links across roadmap states in %s", async locale => {
  mocks.locale = locale;
  mocks.get.mockResolvedValue({ ...row, status: "succeeded", result: assessment, error: null });
  for (const state of ["not-requested", "pending", "failed", "succeeded", "no-data"] as const) {
    const data = roadmapData();
    if (state === "no-data") data.availability = "no-data";
    else data.roadmap.status = state;
    if (state === "pending") { data.roadmap.createdAt = new Date().toISOString(); data.roadmap.attemptId = "00000000-0000-4000-8000-000000000099"; }
    if (state === "failed") data.roadmap.error = { schemaVersion: 1, code: "timeout" };
    if (state === "succeeded") data.roadmap.content = {
      schemaVersion: 1, generatedAt: new Date().toISOString(), summary: { en: "Stored roadmap", ko: "저장 로드맵" },
      phases: [{ id: "first", title: { en: "Stored priority", ko: "저장 우선순위" }, findingIds: [ids.assessment], actions: [{ en: "Catalog action", ko: "카탈로그 조치" }] }],
    };
    mocks.roadmap.mockResolvedValue(data);
    const view = render(await Detail(props()), { locale });
    expect(screen.getByRole("region", { name: locale === "en" ? "Local checks" : "로컬 점검" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: locale === "en" ? "Improvement roadmap" : "개선 로드맵" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: locale === "en" ? "Assessment report" : "점검 보고서" })).toHaveAttribute("href", `/assessments/${row.id}/report?lang=${locale}`);
    expect(screen.getByRole("link", { name: locale === "en" ? "Download assessment report" : "점검 보고서 내려받기" })).toHaveAttribute("href", `/api/assessments/${row.id}/report?format=markdown&lang=${locale}`);
    expect(mocks.roadmap).toHaveBeenLastCalledWith(row.id, ids.workspace);
    view.unmount();
  }
});
it("preserves local checks and reports when historical roadmap data is missing or fails to load", async () => {
  mocks.get.mockResolvedValue({ ...row, status: "succeeded", result: assessment, error: null });
  for (const fail of [false, true]) {
    if (fail) mocks.roadmap.mockRejectedValueOnce(Error("PRIVATE evidence failure"));
    const view = render(await Detail(props()), { locale: "en" });
    expect(screen.getByRole("region", { name: "Local checks" })).toBeInTheDocument();
    expect(screen.getByText("Historical roadmap evidence is unavailable. Local results remain available.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Assessment report" })).toHaveAttribute("href", `/assessments/${row.id}/report?lang=en`);
    expect(document.body.textContent).not.toContain("PRIVATE");
    view.unmount();
  }
});
it("keeps saved owner/scan and disables roadmap generation after a workspace change", async () => {
  mocks.current.mockResolvedValue({ id: ids.otherWorkspace });
  mocks.get.mockResolvedValue({ ...row, status: "succeeded", result: assessment, error: null });
  mocks.roadmap.mockResolvedValue({ ...roadmapData(), workspaceMismatch: true });
  render(await Detail(props()), { locale: "en" });
  expect(mocks.roadmap).toHaveBeenCalledWith(row.id, ids.otherWorkspace);
  expect(screen.getByRole("button", { name: "Generate roadmap" })).toBeDisabled();
  expect(screen.getByText(/This assessment belongs to Saved owner/)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: `Source scan · ${row.sourceScanId}` })).toHaveAttribute("href", `/inventory/scans/${row.sourceScanId}`);
  expect(screen.getByRole("link", { name: "Assessment report" })).toHaveAttribute("href", `/assessments/${row.id}/report?lang=en`);
});
it("shows the saved owner's key settings on refusal without replacing local results or report controls", async () => {
  mocks.get.mockResolvedValue({ ...row, status: "succeeded", result: assessment, error: null });
  mocks.roadmap.mockResolvedValue(roadmapData());
  const transport = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ code: "key-unavailable", workspaceId: row.workspaceId }, { status: 409 }));
  try {
    render(await Detail(props()), { locale: "en" });
    fireEvent.click(screen.getByRole("button", { name: "Generate roadmap" }));
    await waitFor(() => expect(screen.getByRole("link", { name: "Claude key settings" })).toHaveAttribute("href", `/workspaces/${row.workspaceId}/claude`));
    expect(screen.getByRole("region", { name: "Local checks" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Download assessment report" })).toBeInTheDocument();
    expect(JSON.parse(transport.mock.calls[0][1]!.body as string)).toEqual({ workspaceId: row.workspaceId });
  } finally { transport.mockRestore(); }
});
it.each(["pending", "failed"] as const)("does not load roadmap or offer reports before local success (%s)", async status => {
  mocks.get.mockResolvedValue({ ...row, status, createdAt: new Date().toISOString() });
  render(await Detail(props()), { locale: "en" });
  expect(mocks.roadmap).not.toHaveBeenCalled();
  expect(screen.queryByRole("link", { name: "Assessment report" })).not.toBeInTheDocument();
});
