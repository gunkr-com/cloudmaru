import { act, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { I18nProvider } from "@/i18n/provider";
import { ScanPending } from "./scan-pending";

afterEach(() => vi.useRealTimers());
it.each(["en", "ko"] as const)("shows elapsed time outside the live region and long-running copy in %s", async locale => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-07T00:00:00Z"));
  render(<I18nProvider locale={locale}><ScanPending createdAt={new Date().toISOString()} /></I18nProvider>);
  const status = screen.getByRole("status");
  expect(status).toHaveTextContent(locale === "en" ? "Scanning." : "스캔 중입니다.");
  expect(screen.getByRole("progressbar")).toHaveClass("motion-reduce:hidden");
  expect(status).not.toContainElement(screen.getByText("0:00", { exact: false }));
  await act(async () => { await vi.advanceTimersByTimeAsync(300_000); });
  expect(status).toHaveTextContent(locale === "en" ? "This is taking longer than usual." : "평소보다 오래 걸리고 있습니다.");
  expect(screen.getByText("5:00", { exact: false })).toBeInTheDocument();
});
