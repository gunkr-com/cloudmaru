import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { renderWithI18n as render } from "@/test/render-with-i18n";
import { completeSnapshot, extension, ids } from "@/lib/completion/fixtures.test-data";
const mocks = vi.hoisted(() => ({ locale: "en", current: vi.fn(), owner: vi.fn(), list: vi.fn(), get: vi.fn(), scans: vi.fn(), push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: mocks.locale }) }) }));
vi.mock("next/navigation", () => ({ notFound: () => { throw Error("404"); }, useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }) }));
vi.mock("@/services/current-workspace", () => ({ getCurrentWorkspace: mocks.current }));
vi.mock("@/services/db/workspaces", () => ({ getWorkspace: mocks.owner }));
vi.mock("@/services/db/scans", () => ({ listScans: mocks.scans }));
vi.mock("@/services/extension-job", () => ({ extensionJobs: { get: mocks.get, list: mocks.list } }));
import History from "./page";
import New from "./new/page";
import Loading from "./loading";
import NotFound from "./not-found";
import ErrorPage from "./error";
const record = { id: extension.id, workspaceId: ids.workspace, sourceScanId: ids.scan, status: "succeeded", input: extension.input, result: extension, createdAt: extension.createdAt, error: null };
beforeEach(() => {
  vi.clearAllMocks(); mocks.locale = "en";
  mocks.current.mockResolvedValue({ id: ids.workspace, name: "Current", defaultRegion: "canadacentral" });
  mocks.owner.mockResolvedValue({ id: ids.workspace, name: "Saved owner" });
  mocks.list.mockResolvedValue([]); mocks.get.mockResolvedValue(record); mocks.scans.mockResolvedValue([completeSnapshot.record]);
});
it.each(["en", "ko"] as const)("renders empty history, new and localized load/error/not-found states in %s", async locale => {
  mocks.locale = locale;
  const view = render(await History(), { locale });
  expect(mocks.list).toHaveBeenCalledWith(ids.workspace, { limit: 21 });
  expect(screen.getByText(locale === "en" ? "No extensions yet." : "아직 확장이 없습니다.")).toBeInTheDocument(); view.unmount();
  render(await Loading(), { locale }).unmount();
  render(await NotFound(), { locale }).unmount();
  const retry = vi.fn(); const error = render(<ErrorPage retry={retry} error={Error("SECRET")} />, { locale });
  fireEvent.click(screen.getByRole("button")); expect(retry).toHaveBeenCalled(); expect(screen.getByRole("alert")).not.toHaveTextContent("SECRET"); error.unmount();
  render(await New({ searchParams: Promise.resolve({}) }), { locale });
  expect(screen.getAllByRole("combobox")[0]).toHaveValue("");
  expect(screen.getAllByRole("combobox").at(-1)!.querySelectorAll("option")).toHaveLength(3);
});
it("offers only successful own scans in collection order, including old successes, and preserves invalid explicit choice", async () => {
  const scan = completeSnapshot.record;
  mocks.scans.mockResolvedValue([{ ...scan, collectedAt: "2026-11-01T00:00:00Z" }, { ...scan, id: ids.oldScan, collectedAt: "2026-11-12T00:00:00Z" }, { ...scan, id: ids.network, status: "failed" }, { ...scan, id: ids.assessment, workspaceId: ids.otherWorkspace }]);
  render(await New({ searchParams: Promise.resolve({ sourceScanId: ids.network }) }), { locale: "en" });
  expect(mocks.scans).toHaveBeenCalledWith(ids.workspace, { limit: Number.MAX_SAFE_INTEGER });
  const select = screen.getAllByRole("combobox")[0]; expect(select).toHaveValue(ids.network);
  expect(Array.from(select.querySelectorAll("option")).map(o => o.value)).toEqual(["", ids.network, ids.oldScan, ids.scan]);
  fireEvent.click(screen.getByRole("button")); expect(screen.getAllByRole("alert").length).toBeGreaterThan(0);
});
it("prefills full saved input, pins source and original ID for reanalysis without reading inventory", async () => {
  render(await New({ searchParams: Promise.resolve({ from: extension.id }) }), { locale: "en" });
  expect(screen.getAllByRole("textbox")[0]).toHaveValue(extension.input.description);
  expect(screen.getAllByRole("combobox")[0]).toHaveValue(extension.input.sourceScanId);
  expect(screen.getAllByRole("combobox")[0]).toBeDisabled();
  expect(screen.getByRole("link", { name: "View original extension" })).toHaveAttribute("href", `/extensions/${extension.id}`);
});
it.each(["en", "ko"] as const)("keeps the inventory entry scan selected ahead of a newer scan in %s", async locale => {
  mocks.locale = locale;
  mocks.scans.mockResolvedValue([
    { ...completeSnapshot.record, id: ids.oldScan, collectedAt: "2026-11-12T00:00:00Z" },
    completeSnapshot.record,
  ]);
  render(await New({ searchParams: Promise.resolve({ sourceScanId: ids.scan }) }), { locale });
  expect(screen.getAllByRole("combobox")[0]).toHaveValue(ids.scan);
  expect(mocks.get).not.toHaveBeenCalled();
  expect(mocks.scans).toHaveBeenCalledWith(ids.workspace, { limit: Number.MAX_SAFE_INTEGER });
});
it("loads the correct saved input when navigation changes from new to a reanalysis query", async () => {
  const view = render(await New({ searchParams: Promise.resolve({}) }), { locale: "en" });
  fireEvent.change(screen.getAllByRole("textbox")[0], { target: { value: "Unrelated unsaved requirements" } });
  view.rerender(await New({ searchParams: Promise.resolve({ from: extension.id }) }));
  expect(screen.getAllByRole("textbox")[0]).toHaveValue(extension.input.description);
  expect(screen.getAllByRole("combobox")[0]).toHaveValue(extension.input.sourceScanId);
});
it("shows explicit safe foreign-owner route and never remaps the saved scan to current workspace", async () => {
  mocks.current.mockResolvedValue({ id: ids.otherWorkspace, name: "Other", defaultRegion: "westus2" });
  render(await New({ searchParams: Promise.resolve({ from: extension.id }) }), { locale: "en" });
  expect(screen.getByRole("alert")).toHaveTextContent("Saved owner");
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Manage workspaces" })).toHaveAttribute("href", "/workspaces");
  expect(mocks.scans).not.toHaveBeenCalled();
});
it("shows inventory path when no successes, and never falls back from missing/invalid reanalysis", async () => {
  mocks.scans.mockResolvedValue([]);
  const view = render(await New({ searchParams: Promise.resolve({}) }), { locale: "en" });
  expect(screen.getByRole("link", { name: "Go to inventory" })).toHaveAttribute("href", "/inventory"); view.unmount();
  mocks.get.mockResolvedValue(null);
  await expect(New({ searchParams: Promise.resolve({ from: extension.id }) })).rejects.toThrow("404");
  await expect(New({ searchParams: Promise.resolve({ from: [extension.id, ids.extension] }) })).rejects.toThrow("404");
});
it("uses shared job list for stale settlement and preserves returned order and saved titles", async () => {
  mocks.list.mockResolvedValue([record, { ...record, id: ids.assessment, status: "failed", result: null, error: { code: "timeout" } }]);
  render(await History(), { locale: "en" });
  const links = screen.getAllByRole("link").filter(link => /\/extensions\/[^/]+$/.test(link.getAttribute("href") ?? "") && !link.getAttribute("href")!.includes("?") && link.getAttribute("href") !== "/extensions/new");
  expect(links.map(link => link.getAttribute("href"))).toEqual([`/extensions/${record.id}`, `/extensions/${ids.assessment}`]);
  expect(screen.getByRole("alert")).toHaveTextContent("in time");
});

it.each(["en", "ko"] as const)("offers bounded older/latest navigation in %s", async locale => {
  mocks.locale = locale;
  const rows = Array.from({ length: 21 }, (_, i) => ({ ...record, id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}` }));
  mocks.list.mockResolvedValue(rows);
  const view = render(await History(), { locale });
  const older = screen.getByRole("link", { name: locale === "en" ? "Older extensions" : "이전 확장 기록" });
  expect(older).toHaveAttribute("href", `/extensions?before=${ids.workspace}.${rows[19].id}`);
  expect(screen.queryByRole("link", { name: locale === "en" ? "Latest extensions" : "최신 확장 기록" })).not.toBeInTheDocument();
  view.unmount(); mocks.list.mockResolvedValue([record]);
  render(await History({ searchParams: Promise.resolve({ before: `${ids.workspace}.${rows[19].id}` }) }), { locale });
  expect(mocks.list).toHaveBeenLastCalledWith(ids.workspace, { limit: 21, beforeId: rows[19].id });
  expect(screen.getByRole("link", { name: locale === "en" ? "Latest extensions" : "최신 확장 기록" })).toHaveAttribute("href", "/extensions");
  expect(screen.queryByRole("link", { name: locale === "en" ? "Older extensions" : "이전 확장 기록" })).not.toBeInTheDocument();
});
it("rejects invalid, repeated and foreign cursors without querying and recovers deleted anchors safely", async () => {
  for (const before of ["private-raw", [`${ids.workspace}.${record.id}`], `${ids.otherWorkspace}.${record.id}`]) {
    mocks.list.mockClear();
    const view = render(await History({ searchParams: Promise.resolve({ before }) }), { locale: "en" });
    expect(mocks.list).not.toHaveBeenCalled(); expect(screen.getByRole("alert")).not.toHaveTextContent("private-raw");
    expect(screen.getByRole("link", { name: "Latest extensions" })).toHaveAttribute("href", "/extensions"); view.unmount();
  }
  mocks.list.mockRejectedValueOnce(Error("PRIVATE DATABASE"));
  render(await History({ searchParams: Promise.resolve({ before: `${ids.workspace}.${record.id}` }) }), { locale: "en" });
  expect(screen.getByRole("alert")).not.toHaveTextContent("PRIVATE DATABASE");
  expect(screen.getByRole("link", { name: "Latest extensions" })).toBeInTheDocument();
});
