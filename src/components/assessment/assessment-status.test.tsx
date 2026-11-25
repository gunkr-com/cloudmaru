import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { renderWithI18n as render } from "@/test/render-with-i18n";
import { AssessmentStatus, AssessmentCompletionFocus } from "./assessment-status";
const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
const start = Date.parse("2026-11-12T00:00:00Z");
const tick = async (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(start); vi.stubGlobal("fetch", vi.fn()); router.refresh.mockReset(); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
it.each(["succeeded", "failed"])("polls pending then stops and refreshes on %s", async status => {
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({ id: "saved", status: "pending", workspaceMismatch: true })).mockResolvedValue(Response.json({ id: "saved", status }));
  render(<AssessmentStatus id="saved" startedAt={start} expiresAt={start + 300000} />, { locale: "en" });
  await tick(4000);
  expect(screen.getByRole("alert")).toHaveTextContent("workspace");
  await tick(16000);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(router.refresh).toHaveBeenCalledTimes(1);
});
it("stops on repeated malformed/error responses with localized alert", async () => {
  vi.mocked(fetch).mockResolvedValue(Response.json({ status: "succeeded" }));
  render(<AssessmentStatus id="saved" startedAt={start} expiresAt={start + 300000} />, { locale: "ko" });
  await tick(30000);
  expect(fetch).toHaveBeenCalledTimes(3);
  expect(screen.getByRole("alert")).toHaveTextContent("상태");
});
it("bounds hung requests, aborts at stale cutoff, and never polls after unmount", async () => {
  vi.mocked(fetch).mockReturnValue(new Promise(() => {}));
  const view = render(<AssessmentStatus id="saved" startedAt={start} expiresAt={start + 6000} />, { locale: "en" });
  await tick(16000);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect((vi.mocked(fetch).mock.calls[0][1]!.signal as AbortSignal).aborted).toBe(true);
  expect(screen.getByRole("alert")).toBeInTheDocument();
  view.unmount();
  await tick(8000);
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("focuses the terminal server heading only after pending completion", async () => {
  sessionStorage.setItem("cs-assessment-focus:saved", "1");
  render(<><h1 id="assessment-heading" tabIndex={-1}>Saved result</h1><AssessmentCompletionFocus id="saved" /></>);
  await tick(1);
  expect(screen.getByRole("heading")).toHaveFocus();
  expect(sessionStorage.getItem("cs-assessment-focus:saved")).toBeNull();
});
it("resumes polling after status reload while the same saved row is still pending", async () => {
  vi.mocked(fetch).mockResolvedValue(Response.json({ code: "internal" }, { status: 500 }));
  render(<AssessmentStatus id="saved" startedAt={start} expiresAt={start + 300000} />, { locale: "en" });
  await tick(16000);
  expect(screen.getByRole("alert")).toBeInTheDocument();
  vi.mocked(fetch).mockResolvedValue(Response.json({ id: "saved", status: "succeeded" }));
  fireEvent.click(screen.getByRole("button", { name: "Reload status" }));
  await tick(4000);
  expect(fetch).toHaveBeenCalledTimes(4);
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("measures elapsed time from the saved start rather than a presumed stale duration", async () => {
  vi.mocked(fetch).mockResolvedValue(Response.json({id:"saved",status:"pending"}));
  render(<AssessmentStatus id="saved" startedAt={start-10000} expiresAt={start+60000} />);
  await tick(4000);
  expect(screen.getByText(/14/)).toBeInTheDocument();
});
