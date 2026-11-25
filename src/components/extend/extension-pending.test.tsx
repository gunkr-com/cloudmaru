import { act, fireEvent, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { renderWithI18n as render } from "@/test/render-with-i18n";
import { ExtensionPending, ExtensionCompletionFocus } from "./extension-pending";
const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal("fetch", vi.fn()); router.refresh.mockReset(); sessionStorage.clear(); });
afterEach(() => { vi.useRealTimers(); });
const props = { id: "saved", createdAt: new Date().toISOString() };
it.each(["en", "ko"] as const)("polls pending without rendering API prose and refreshes only terminal state in %s", async locale => {
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({ id: props.id, status: "pending" })).mockResolvedValueOnce(Response.json({ id: props.id, status: "succeeded", secret: "SECRET" }));
  render(<ExtensionPending {...props} />, { locale });
  expect(screen.getByRole("status")).toBeInTheDocument();
  await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
  expect(router.refresh).not.toHaveBeenCalled();
  await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
  expect(router.refresh).toHaveBeenCalledTimes(1);
  expect(document.body.textContent).not.toContain("SECRET");
});
it("bounds a hung request, supports retry and aborts on unmount", async () => {
  vi.mocked(fetch).mockReturnValue(new Promise(() => {}));
  const view = render(<ExtensionPending {...props} />, { locale: "en" });
  await act(async () => { await vi.advanceTimersByTimeAsync(13_000); });
  expect(screen.getByRole("alert")).toHaveTextContent("Automatic updates stopped");
  expect(vi.mocked(fetch).mock.calls[0][1]?.signal?.aborted).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
  expect(fetch).toHaveBeenCalledTimes(2);
  const signal = vi.mocked(fetch).mock.calls[1][1]?.signal;
  view.unmount(); expect(signal?.aborted).toBe(true);
});
it("requests stale recovery once and stops even if refresh leaves the old pending mounted", async () => {
  render(<ExtensionPending {...props} createdAt={new Date(Date.now() - 331_000).toISOString()} />, { locale: "en" });
  await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
  expect(router.refresh).toHaveBeenCalledTimes(1); expect(fetch).not.toHaveBeenCalled();
  expect(screen.getByRole("alert")).toBeInTheDocument();
});
it("ignores a mismatched response and never updates after unmount", async () => {
  let resolve!: (r: Response) => void;
  vi.mocked(fetch).mockReturnValue(new Promise(r => { resolve = r; }));
  const view = render(<ExtensionPending {...props} />);
  await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
  view.unmount();
  await act(async () => { resolve(Response.json({ id: props.id, status: "failed" })); });
  expect(router.refresh).not.toHaveBeenCalled();
});
it("focuses terminal heading after actual transition with StrictMode and preserves ordinary reopen focus", async () => {
  vi.mocked(fetch).mockResolvedValue(Response.json({ id: props.id, status: "failed" }));
  const view = render(<ExtensionPending {...props} />);
  await act(async () => { await vi.advanceTimersByTimeAsync(3000); }); view.unmount();
  const complete = render(<StrictMode><h1 id="extension-heading" tabIndex={-1}>Saved</h1><ExtensionCompletionFocus id={props.id} /></StrictMode>);
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(screen.getByRole("heading")).toHaveFocus();
  complete.unmount();
  render(<><button>Other</button><h1 id="extension-heading" tabIndex={-1}>Saved</h1><ExtensionCompletionFocus id={props.id} /></>);
  screen.getByRole("button").focus();
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(screen.getByRole("button")).toHaveFocus();
});
it.each([{ id: "different", status: "succeeded" }, { id: "saved", status: "invented" }])("rejects a malformed status response %j", async body => {
  vi.mocked(fetch).mockResolvedValue(Response.json(body));
  render(<ExtensionPending {...props} />, { locale: "en" });
  await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
  expect(router.refresh).not.toHaveBeenCalled();
  expect(screen.getByRole("alert")).toBeInTheDocument();
});
