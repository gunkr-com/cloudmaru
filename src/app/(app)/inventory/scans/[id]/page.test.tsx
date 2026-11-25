import { render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { I18nProvider } from "@/i18n/provider";
import { createTranslator } from "@/i18n/translate";
import { ids, resource } from "@/lib/inventory/fixtures.test-data";
import { summarizeInventory } from "@/lib/inventory/summarize";
import type { ScanInventory, ScanRecord } from "@/types/scan";
import Page, { generateMetadata } from "./page";
import NotFound from "./not-found";

const mocks = vi.hoisted(() => ({ locale: "en" as "en" | "ko", scan: vi.fn(), inventory: vi.fn(), workspace: vi.fn(), current: vi.fn(), failed: vi.fn(), table: vi.fn() }));
vi.mock("@/i18n/server", () => ({ getI18n: async () => ({ locale: mocks.locale, t: createTranslator(mocks.locale) }) }));
vi.mock("@/services/db/scans", () => ({ getScan: mocks.scan, getScanInventory: mocks.inventory }));
vi.mock("@/services/db/workspaces", () => ({ getWorkspace: mocks.workspace }));
vi.mock("@/services/current-workspace", () => ({ getCurrentWorkspace: mocks.current }));
vi.mock("@/components/inventory/scan-failed", () => ({ ScanFailed: mocks.failed }));
vi.mock("@/components/inventory/resource-table", () => ({ ResourceTable: mocks.table }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("404"); }, useRouter: () => ({ refresh: vi.fn() }) }));

const id = "12345678-1234-4234-8234-123456789012";
const inventory: ScanInventory = { resources: [resource(ids.vm, { sensitive: "server-only-inventory" })], containers: [], relations: [], skippedRows: 2 };
const record: ScanRecord = { id, workspaceId: "owner", source: "live", status: "succeeded", subscriptionIds: ["unread-sub"], summary: summarizeInventory(inventory.resources, []), createdAt: "2026-01-01T00:00:00Z", completedAt: "2026-01-01T00:01:00Z", collectedAt: "2026-01-01T00:01:00Z", errorCode: null };
const props = (scanId = id) => ({ params: Promise.resolve({ id: scanId }), searchParams: Promise.resolve({ q: "VM", page: "999", type: "missing/type" }) });
const show = async () => render(<I18nProvider locale={mocks.locale}>{await Page(props())}</I18nProvider>);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.locale = "en";
  mocks.scan.mockResolvedValue(record);
  mocks.inventory.mockResolvedValue(inventory);
  mocks.current.mockResolvedValue({ id: "current", name: "Current" });
  mocks.workspace.mockResolvedValue({ id: "owner", name: "Other company" });
});

it("rejects invalid and missing IDs and renders localized not-found navigation", async () => {
  await expect(Page(props("invalid"))).rejects.toThrow("404");
  expect(mocks.scan).not.toHaveBeenCalled();
  expect(await generateMetadata(props("invalid"))).toEqual({ title: "Scan not found · CloudMaru" });
  mocks.scan.mockResolvedValue(null);
  await expect(Page(props())).rejects.toThrow("404");
  expect(await generateMetadata(props())).toEqual({ title: "Scan not found · CloudMaru" });
  render(await NotFound());
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Scan not found");
  expect(screen.getByRole("link")).toHaveAttribute("href", "/inventory");
});
it("uses the owning workspace and passes only projected page rows to the server table", async () => {
  await show();
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Scan inventory");
  expect(screen.getByText("This scan belongs to Other company, not the current workspace.")).toBeInTheDocument();
  expect(mocks.workspace).toHaveBeenCalledWith("owner");
  expect(mocks.inventory).toHaveBeenCalledWith(id);
  expect(screen.getByText("2 rows could not be read and were skipped.")).toBeInTheDocument();
  expect(screen.getByText("unread-sub")).toBeInTheDocument();
  expect(screen.getByText("Virtual machines")).toBeInTheDocument();
  const tableProps = mocks.table.mock.calls[0][0];
  expect(tableProps.data.rows[0]).not.toHaveProperty("properties");
  expect(tableProps.data.page).toBe(1);
  expect(tableProps.query.type).toBeNull();
  expect(JSON.stringify(tableProps)).not.toContain("server-only-inventory");
  expect(await generateMetadata(props())).toEqual({ title: "Scan inventory · CloudMaru" });
});
it("renders pending without reading inventory and gives stale scans the interrupted failure", async () => {
  mocks.scan.mockResolvedValue({ ...record, status: "pending", summary: null, createdAt: new Date().toISOString() });
  const view = await show();
  expect(screen.getByRole("status")).toHaveTextContent("Scanning.");
  expect(mocks.inventory).not.toHaveBeenCalled();
  expect(await generateMetadata(props())).toEqual({ title: "Scanning · CloudMaru" });
  mocks.scan.mockResolvedValue({ ...record, status: "pending", summary: null });
  view.rerender(<I18nProvider locale="en">{await Page(props())}</I18nProvider>);
  expect(mocks.failed.mock.calls[0][0]).toMatchObject({ workspaceId: "owner", source: "live", errorCode: "interrupted", isCurrentWorkspace: false });
  expect(await generateMetadata(props())).toEqual({ title: "Scan failed · CloudMaru" });
});
it("renders internal failure when a succeeded scan has no inventory body", async () => {
  mocks.current.mockResolvedValue({ id: "owner" });
  mocks.inventory.mockResolvedValue(null);
  await show();
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Scan failed");
  expect(screen.queryByText(/This scan belongs/)).not.toBeInTheDocument();
  expect(mocks.failed.mock.calls[0][0]).toMatchObject({ errorCode: "internal", isCurrentWorkspace: true });
  expect(mocks.table).not.toHaveBeenCalled();
});

it("binds completed mode entry links to this successful source scan in its selected workspace",async()=>{
 mocks.current.mockResolvedValue({id:"owner"}); await show();
 const nav=screen.getByRole("navigation",{name:"Analyze this scan"});
 expect(Array.from(nav.querySelectorAll("a")).map(a=>a.getAttribute("href"))).toEqual([
 `/assessments/new?sourceScanId=${id}`,`/network?scan=${id}`,`/extensions/new?sourceScanId=${id}`]);
 expect(nav.textContent).not.toContain("server-only-inventory");
});
it("does not offer source-scoped analysis links for another workspace or an invalid scan",async()=>{
 const view=await show();expect(screen.queryByRole("navigation",{name:"Analyze this scan"})).not.toBeInTheDocument();
 mocks.current.mockResolvedValue({id:"owner"});mocks.inventory.mockResolvedValue(null);
 view.rerender(<I18nProvider locale="en">{await Page(props())}</I18nProvider>);
 expect(screen.queryByRole("navigation",{name:"Analyze this scan"})).not.toBeInTheDocument();
});

it.each(["en", "ko"] as const)("keeps partial imported legacy scan actions source-bound in %s", async locale => {
  mocks.locale = locale;
  mocks.current.mockResolvedValue({ id: "owner" });
  mocks.scan.mockResolvedValue({ ...record, source: "import" });
  const view = await show();
  const t = createTranslator(locale);
  const nav = screen.getByRole("navigation", { name: t("inventory.actions.analyzeScan") });
  const expected = [
    [t("assessment.ui.new"), `/assessments/new?sourceScanId=${id}`],
    [t("network.title"), `/network?scan=${id}`],
    [t("extension.ui.new"), `/extensions/new?sourceScanId=${id}`],
  ];
  for (const [name, href] of expected) {
    expect(screen.getByRole("link", { name })).toHaveAttribute("href", href);
  }
  expect(nav.querySelectorAll("a")).toHaveLength(3);
  expect(screen.getByText(t("inventory.summary.skipped", { count: "2" }))).toBeInTheDocument();
  expect(mocks.scan).toHaveBeenCalledWith(id);
  expect(mocks.inventory).toHaveBeenCalledWith(id);
  expect(JSON.stringify(mocks.table.mock.calls[0][0])).not.toContain("server-only-inventory");
  // 다른 탭에서 회사를 바꿔도 저장 내용은 읽을 수 있고 새 생성 링크는 숨긴다.
  mocks.current.mockResolvedValue({ id: "different-workspace" });
  view.rerender(<I18nProvider locale={locale}>{await Page(props())}</I18nProvider>);
  expect(screen.queryByRole("navigation", { name: t("inventory.actions.analyzeScan") })).not.toBeInTheDocument();
  expect(screen.getByText(t("inventory.detail.otherWorkspace", { name: "Other company" }))).toBeInTheDocument();
});

it.each(["pending", "failed", "empty", "missing-summary"] as const)("does not expose generation actions for a %s scan", async state => {
  mocks.current.mockResolvedValue({ id: "owner" });
  if (state === "pending" || state === "failed") {
    mocks.scan.mockResolvedValue({ ...record, status: state, summary: null, createdAt: new Date().toISOString(), errorCode: state === "failed" ? "internal" : null });
  } else if (state === "empty") {
    mocks.inventory.mockResolvedValue({ resources: [], containers: [], relations: [], skippedRows: 0 });
    mocks.scan.mockResolvedValue({ ...record, summary: summarizeInventory([], []) });
  } else {
    mocks.scan.mockResolvedValue({ ...record, summary: null });
  }
  await show();
  expect(screen.queryByRole("navigation", { name: "Analyze this scan" })).not.toBeInTheDocument();
});

it("adds an interactive explorer using only projected saved metadata", async()=>{
 await show();
 expect(screen.getByRole("table",{name:"Explore resources"})).toBeInTheDocument();
 expect(document.body.textContent).not.toContain("server-only-inventory");
});
