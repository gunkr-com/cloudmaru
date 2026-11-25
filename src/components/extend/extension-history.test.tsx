import { act, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { renderWithI18n as render } from "@/test/render-with-i18n";
import { ExtensionHistory } from "./extension-history";
import { extension } from "@/lib/completion/fixtures.test-data";
const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
const row = { id: extension.id, status: "pending" as const, sourceScanId: extension.sourceScanId, createdAt: extension.createdAt, description: extension.input.description, title: null, errorCode: null };
beforeEach(() => { vi.stubGlobal("fetch", vi.fn()); router.refresh.mockReset(); });
afterEach(() => { vi.useRealTimers(); });
it.each(["en", "ko"] as const)("distinguishes empty and all saved states, with reopen and rerun links in %s", locale => {
  const view = render(<ExtensionHistory items={[]} />, { locale });
  expect(screen.getByText(locale === "en" ? "No extensions yet." : "아직 확장이 없습니다.")).toBeInTheDocument();
  view.rerender(<ExtensionHistory items={[row, { ...row, id: "success", status: "succeeded", title: extension.requestTitle }, { ...row, id: "failed", status: "failed", errorCode: "interrupted" }]} />);
  expect(screen.getByRole("status")).toBeInTheDocument();
  expect(screen.getByRole("alert")).toHaveTextContent(locale === "en" ? "interrupted" : "중단");
  expect(screen.getAllByRole("link").filter(link => link.getAttribute("href") === `/extensions/${row.id}`)).toHaveLength(1);
  expect(screen.getAllByRole("link").filter(link => link.getAttribute("href") === `/extensions/new?from=${row.id}`)).toHaveLength(1);
});
it("polls pending only, refreshes terminal status and aborts unmounted reads", async () => {
  vi.useFakeTimers();
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({ status: "succeeded", workspaceMismatch: false }));
  const view = render(<ExtensionHistory items={[row]} />, { locale: "en" });
  await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
  expect(fetch).toHaveBeenCalledTimes(1); expect(router.refresh).toHaveBeenCalledTimes(1);
  view.unmount();
  vi.mocked(fetch).mockImplementation(() => new Promise(() => {}));
  const second = render(<ExtensionHistory items={[row]} />, { locale: "en" });
  await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
  const signal = vi.mocked(fetch).mock.calls[1][1]!.signal!;
  second.unmount(); expect(signal.aborted).toBe(true);
  await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
  expect(fetch).toHaveBeenCalledTimes(2);
});
it("stops polling at the deadline and on a read error without showing payload details", async () => {
  vi.useFakeTimers();
  vi.mocked(fetch).mockResolvedValue(Response.json({ status: "pending", workspaceMismatch: false }));
  const view = render(<ExtensionHistory items={[row]} />, { locale: "en" });
  await act(async () => { await vi.advanceTimersByTimeAsync(340_000); });
  const calls = vi.mocked(fetch).mock.calls.length;
  expect(calls).toBeLessThanOrEqual(110);
  expect(screen.getByText(/Automatic updates stopped/)).toBeInTheDocument();
  await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
  expect(fetch).toHaveBeenCalledTimes(calls); view.unmount();
  vi.mocked(fetch).mockResolvedValue(Response.json({ message: "SECRET" }, { status: 500 }));
  render(<ExtensionHistory items={[row]} />, { locale: "en" });
  await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
  expect(screen.getByRole("alert")).not.toHaveTextContent("SECRET");
});
it("does not poll terminal histories", async () => {
  vi.useFakeTimers(); render(<ExtensionHistory items={[{ ...row, status: "failed", errorCode: "internal" }]} />);
  await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
  expect(fetch).not.toHaveBeenCalled();
  expect(screen.getByRole("link", { name: /다시 분석/ })).toHaveAttribute("href", `/extensions/new?from=${row.id}`);
});

it.each(["en", "ko"] as const)("offers saved-owner key recovery for every credential failure in %s", locale => {
  const workspaceId = extension.workspaceId;
  render(<ExtensionHistory items={["auth-failed", "forbidden", "not-configured"].map((code, i) => ({ ...row, id: String(i), workspaceId, status: "failed", errorCode: code }))} />, { locale });
  expect(screen.getAllByRole("alert")).toHaveLength(3);
  for (const alert of screen.getAllByRole("alert")) expect(alert).toHaveTextContent(locale === "en" ? "Claude key" : "Claude 키");
  const links = screen.getAllByRole("link", { name: locale === "en" ? "Configure Claude key" : "Claude 키 설정" });
  expect(links).toHaveLength(3);
  for (const link of links) expect(link).toHaveAttribute("href", `/workspaces/${workspaceId}/claude`);
});
