import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { renderWithI18n as render } from "@/test/render-with-i18n";
import { RoadmapPanel } from "./roadmap-panel";
import type { RoadmapStatusData } from "@/lib/assessment/roadmap/job";
const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
const start = Date.parse("2026-11-12T10:00:00Z");
const initial: RoadmapStatusData = { id: "saved", workspaceId: "owner", sourceScanId: "scan", workspaceMismatch: false,
  availability: "ready", coverage: { unit: "findings", total: 4, included: 3, excluded: 1, reasons: [{ code: "pass-finding", count: 1 }] },
  roadmap: { status: "not-requested", attemptId: null, content: null, error: null, usage: null, createdAt: null, completedAt: null } };
const pending = (): RoadmapStatusData => ({ ...initial, roadmap: { ...initial.roadmap, status: "pending", attemptId: "attempt", createdAt: new Date(start).toISOString() } });
const tick = async (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(start); vi.stubGlobal("fetch", vi.fn()); router.refresh.mockReset(); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
it.each(["en", "ko"] as const)("renders local-preserved and no-data without generate for %s", locale => {
  render(<RoadmapPanel initial={{ ...initial, availability: "no-data" }} />, { locale });
  expect(screen.getByRole("status")).toHaveTextContent(locale === "en" ? "No actionable" : "조치");
  expect(screen.queryByRole("button", { name: /Generate|로드맵 생성/ })).not.toBeInTheDocument();
  expect(screen.getByText(locale === "en" ? /Local check results remain/ : /로드맵 생성이 실패해도/)).toBeInTheDocument();
});
it("submits strict owner only, locks while submitting and shows correct owner key link", async () => {
  vi.mocked(fetch).mockResolvedValue(Response.json({ code: "key-unavailable", workspaceId: "owner" }, { status: 409 }));
  render(<RoadmapPanel initial={initial} />, { locale: "en" });
  fireEvent.click(screen.getByRole("button", { name: "Generate roadmap" }));
  expect(screen.getByRole("button", { name: "Generate roadmap" })).toBeDisabled();
  await tick(0);
  expect(screen.getByRole("alert")).toHaveTextContent("Claude key");
  expect(screen.getByRole("link", { name: /Claude/ })).toHaveAttribute("href", "/workspaces/owner/claude");
  expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string)).toEqual({ workspaceId: "owner" });
});
it("polls only pending, stops on terminal result and on unmount", async () => {
  const done = { ...pending(), roadmap: { ...pending().roadmap, status: "failed", error: { schemaVersion: 1, code: "timeout" } } };
  vi.mocked(fetch).mockResolvedValueOnce(Response.json(pending())).mockResolvedValue(Response.json(done));
  const view = render(<RoadmapPanel initial={pending()} />, { locale: "en" });
  expect(screen.getByRole("status")).toHaveTextContent("Generating roadmap");
  await tick(4000); await tick(4000); await tick(20000);
  expect(fetch).toHaveBeenCalledTimes(2); expect(screen.getByRole("alert")).toHaveTextContent("in time");
  expect(screen.getByRole("heading", { name: "Improvement roadmap" })).toHaveFocus();
  expect(screen.getByRole("button", { name: "Retry roadmap" })).not.toBeDisabled();
  view.unmount(); await tick(8000); expect(fetch).toHaveBeenCalledTimes(2);
});
it("bounds ignored fetch abort, stops after repeated errors and retries status without paid POST", async () => {
  vi.mocked(fetch).mockReturnValue(new Promise(() => {}));
  const view = render(<RoadmapPanel initial={pending()} />, { locale: "en" });
  await tick(45000);
  expect(fetch).toHaveBeenCalledTimes(3);
  expect(screen.getByRole("alert")).toHaveTextContent("status");
  const signal = vi.mocked(fetch).mock.calls[2][1]!.signal!;
  expect(signal.aborted).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Reload status" }));
  await tick(4000); expect(fetch).toHaveBeenCalledTimes(4);
  view.unmount(); expect(vi.mocked(fetch).mock.calls[3][1]!.signal!.aborted).toBe(true);
});
it("disables mutations for workspace mismatch and disabled parent, keeps saved state readable", () => {
  render(<RoadmapPanel initial={{ ...initial, workspaceMismatch: true }} />, { locale: "en" });
  expect(screen.getByRole("button", { name: "Generate roadmap" })).toBeDisabled();
  expect(screen.getByRole("alert")).toHaveTextContent("workspace");
});
it("uses current language for stored content and never requests generation when reopened", () => {
  const content = { schemaVersion: 1 as const, generatedAt: new Date(start).toISOString(), summary: { en: "HTTPS review", ko: "HTTPS 검토" },
    phases: [{ id: "first", title: { en: "Review first", ko: "우선 검토" }, findingIds: ["finding"], actions: [{ en: "Catalog action", ko: "카탈로그 조치" }] }] };
  render(<RoadmapPanel initial={{ ...initial, roadmap: { ...initial.roadmap, status: "succeeded", content } }} />, { locale: "ko" });
  expect(screen.getByText("HTTPS 검토")).toBeInTheDocument(); expect(screen.getByText("카탈로그 조치")).toBeInTheDocument();
  expect(fetch).not.toHaveBeenCalled(); expect(screen.queryByRole("button")).not.toBeInTheDocument();
});
it("bounds a stalled response body as well as stalled fetch", async () => {
  vi.mocked(fetch).mockResolvedValue({ ok: true, json: () => new Promise(() => {}) } as Response);
  render(<RoadmapPanel initial={pending()} />, { locale: "en" });
  await tick(45000);
  expect(fetch).toHaveBeenCalledTimes(3);
  expect(screen.getByRole("alert")).toHaveTextContent("status");
});
it("unlocks submission after a transport that ignores abort", async () => {
  vi.mocked(fetch).mockReturnValue(new Promise(() => {}));
  render(<RoadmapPanel initial={initial} />, { locale: "en" });
  fireEvent.click(screen.getByRole("button", { name: "Generate roadmap" }));
  await tick(10001);
  expect(screen.getByRole("alert")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Generate roadmap" })).not.toBeDisabled();
});
it("aborts an in-flight status read on parent navigation and ignores its late result", async () => {
  let finish!: (response: Response) => void;
  vi.mocked(fetch).mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const view = render(<RoadmapPanel initial={pending()} />, { locale: "en" });
  await tick(4000);
  const signal = vi.mocked(fetch).mock.calls[0][1]!.signal!;
  view.unmount(); expect(signal.aborted).toBe(true);
  finish(Response.json({ ...initial, roadmap: { ...initial.roadmap, status: "failed", error: { schemaVersion: 1, code: "timeout" } } }));
  await tick(12000);
  expect(fetch).toHaveBeenCalledTimes(1); expect(router.refresh).not.toHaveBeenCalled();
});
it("aborts a submission when a different saved assessment replaces the panel", async () => {
  let finish!: (response: Response) => void;
  vi.mocked(fetch).mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const view = render(<RoadmapPanel initial={initial} />, { locale: "en" });
  fireEvent.click(screen.getByRole("button", { name: "Generate roadmap" }));
  const signal = vi.mocked(fetch).mock.calls[0][1]!.signal!;
  view.rerender(<RoadmapPanel initial={{ ...initial, id: "different-saved-assessment" }} />);
  expect(signal.aborted).toBe(true);
  finish(Response.json({ id: initial.id })); await tick(12000);
  expect(fetch).toHaveBeenCalledTimes(1); expect(router.refresh).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Generate roadmap" })).not.toBeDisabled();
});
it("retains completion heading focus when the server refresh supplies the terminal snapshot", async () => {
  const done: RoadmapStatusData = { ...pending(), roadmap: { ...pending().roadmap, status: "failed", error: { schemaVersion: 1, code: "timeout" } } };
  vi.mocked(fetch).mockResolvedValue(Response.json(done));
  const view = render(<RoadmapPanel initial={pending()} />, { locale: "en" });
  await tick(4000);
  expect(screen.getByRole("heading", { name: "Improvement roadmap" })).toHaveFocus();
  view.rerender(<RoadmapPanel initial={done} />);
  expect(screen.getByRole("heading", { name: "Improvement roadmap" })).toHaveFocus();
});
