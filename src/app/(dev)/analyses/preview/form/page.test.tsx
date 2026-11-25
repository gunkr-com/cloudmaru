import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { renderWithI18n } from "@/test/render-with-i18n";
import AnalysisFormPreviewPage from "./page";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

// Radix radios measure their size once a value is checked.
vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
afterEach(() => { vi.useRealTimers(); });

it("shows the preview failure message when the next submission fails", async () => {
  vi.useFakeTimers();
  renderWithI18n(<AnalysisFormPreviewPage />, { locale: "en" });
  fireEvent.click(screen.getByRole("button", { name: "Load existing input" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Fail next submission" }));
  fireEvent.click(screen.getByRole("button", { name: "Run analysis" }));
  await act(async () => { await vi.advanceTimersByTimeAsync(1600); });
  expect(screen.getByRole("alert")).toHaveTextContent("Could not complete the analysis. Try again in a moment.");
});
