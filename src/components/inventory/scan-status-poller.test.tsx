import { StrictMode } from "react";
import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { renderWithI18n as render } from "@/test/render-with-i18n";
import { SCAN_STALE_AFTER_SECONDS } from "@/lib/scans/timing";
import { ScanStatusPoller, ScanCompletionFocus } from "./scan-status-poller";

const { router } = vi.hoisted(() => ({ router: { refresh: vi.fn() } }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
const start = new Date("2026-11-07T00:00:00Z");
const tick = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(start); vi.stubGlobal("fetch", vi.fn()); router.refresh.mockReset(); sessionStorage.clear(); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it.each(["succeeded", "failed"])("polls pending without cache and refreshes once on %s with a focus flag", async status => {
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({ status: "pending" })).mockResolvedValue(Response.json({ status }));
  render(<ScanStatusPoller id="scan-id" createdAt={start.toISOString()} />);
  await tick(4000);
  expect(fetch).toHaveBeenCalledWith("/api/scans/scan-id", { cache: "no-store" });
  expect(router.refresh).not.toHaveBeenCalled();
  await tick(12_000);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(router.refresh).toHaveBeenCalledTimes(1);
  expect(sessionStorage.getItem("cs-scan-focus:scan-id")).toBe("1");
});
it("refreshes and stops on 404", async () => {
  vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 404 }));
  render(<ScanStatusPoller id="gone" createdAt={start.toISOString()} />);
  await tick(20_000);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(router.refresh).toHaveBeenCalledTimes(1);
});
it("counts consecutive failures, stops after five, and resumes on retry", async () => {
  vi.mocked(fetch).mockRejectedValueOnce(new Error()).mockResolvedValueOnce(Response.json({ status: "pending" }))
    .mockResolvedValue(Response.json({ status: "invalid" }));
  render(<ScanStatusPoller id="scan" createdAt={start.toISOString()} />, { locale: "en" });
  await tick(24_000);
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  await tick(4000);
  expect(screen.getByRole("alert")).toHaveTextContent("Could not check the scan status.");
  await tick(20_000);
  expect(fetch).toHaveBeenCalledTimes(7);
  vi.mocked(fetch).mockResolvedValue(Response.json({ status: "succeeded" }));
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await tick(4000);
  expect(fetch).toHaveBeenCalledTimes(8);
  expect(router.refresh).toHaveBeenCalledTimes(2);
});
it("refreshes past the scan cutoff even with an in-flight request", async () => {
  vi.mocked(fetch).mockReturnValue(new Promise(() => {}));
  const createdAt = new Date(start.getTime() - SCAN_STALE_AFTER_SECONDS * 1000 + 5000).toISOString();
  render(<ScanStatusPoller id="old" createdAt={createdAt} />);
  await tick(4000);
  expect(fetch).toHaveBeenCalledTimes(1);
  await tick(8000);
  expect(router.refresh).toHaveBeenCalledTimes(1);
  expect(sessionStorage.getItem("cs-scan-focus:old")).toBe("1");
});
it("does not overlap requests or refresh after unmount", async () => {
  let finish!: (response: Response) => void;
  vi.mocked(fetch).mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const view = render(<ScanStatusPoller id="scan" createdAt={start.toISOString()} />);
  await tick(12_000);
  expect(fetch).toHaveBeenCalledTimes(1);
  view.unmount();
  await act(async () => { finish(Response.json({ status: "succeeded" })); });
  expect(router.refresh).not.toHaveBeenCalled();
});
it("focuses the terminal heading once under StrictMode and consumes the flag", async () => {
  sessionStorage.setItem("cs-scan-focus:scan", "1");
  render(<StrictMode><h1 id="scan-heading" tabIndex={-1}>Result</h1><ScanCompletionFocus id="scan" /></StrictMode>);
  await tick(1);
  expect(screen.getByRole("heading")).toHaveFocus();
  expect(sessionStorage.getItem("cs-scan-focus:scan")).toBeNull();
});
it("leaves focus alone without a completion flag", async () => {
  render(<><h1 id="scan-heading" tabIndex={-1}>Result</h1><ScanCompletionFocus id="scan" /></>);
  await tick(1);
  expect(screen.getByRole("heading")).not.toHaveFocus();
});
