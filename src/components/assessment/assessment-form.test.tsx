import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { renderWithI18n as render } from "@/test/render-with-i18n";
import { AssessmentForm } from "./assessment-form";
const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
const scans = [
  { id: "new", collectedAt: "2026-11-12T12:00:00Z", source: "import" as const },
  { id: "old", collectedAt: "2026-11-11T12:00:00Z", source: "live" as const },
  { id: "equal", collectedAt: "2026-11-12T12:00:00Z", source: "live" as const },
];
beforeEach(() => { vi.stubGlobal("fetch", vi.fn()); router.push.mockReset(); });
it.each(["en", "ko"] as const)("requires explicit source, clears errors on edit and focuses failed submit in %s", async locale => {
  render(<AssessmentForm workspaceId="saved-owner" scans={scans} />, { locale });
  const source = screen.getAllByRole("combobox")[0];
  fireEvent.submit(source.closest("form")!);
  expect(fetch).not.toHaveBeenCalled();
  expect(source).toHaveFocus();
  expect(source).toHaveAttribute("aria-invalid", "true");
  fireEvent.change(source, { target: { value: "new" } });
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.getAllByRole("combobox")[1].querySelectorAll("option")).toHaveLength(2);
  fireEvent.change(screen.getAllByRole("combobox")[1], { target: { value: "old" } });
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({ code: "workspace-changed", detail: "provider secret" }, { status: 409 }));
  fireEvent.submit(source.closest("form")!);
  await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
  expect(source).toHaveFocus();
  expect(screen.queryByText("provider secret")).not.toBeInTheDocument();
  fireEvent.change(source, { target: { value: "old" } });
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({ id: "new-assessment" }, { status: 202 }));
  fireEvent.submit(source.closest("form")!);
  await waitFor(() => expect(router.push).toHaveBeenCalledWith("/assessments/new-assessment"));
  expect(JSON.parse(vi.mocked(fetch).mock.calls[1][1]!.body as string)).toEqual({ workspaceId: "saved-owner", sourceScanId: "old", previousScanId: null });
});
it("submits fixed retry scans as a new assessment and locks cross-owner submission", async () => {
  const view = render(<AssessmentForm workspaceId="owner" scans={scans} initialSource="new" initialPrevious="old" />, { locale: "en" });
  vi.mocked(fetch).mockResolvedValue(Response.json({ id: "fresh" }, { status: 202 }));
  fireEvent.click(screen.getByRole("button", { name: "Run assessment" }));
  await waitFor(() => expect(router.push).toHaveBeenCalledWith("/assessments/fresh"));
  expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string)).toEqual({ workspaceId: "owner", sourceScanId: "new", previousScanId: "old" });
  view.unmount();
  render(<AssessmentForm workspaceId="owner" scans={scans} disabled />, { locale: "en" });
  expect(screen.getByRole("button")).toBeDisabled();
});
it("moves focus from the submit button back to the source after an async error", async () => {
  render(<AssessmentForm workspaceId="owner" scans={scans} initialSource="new" />, { locale: "en" });
  const button = screen.getByRole("button"); button.focus();
  vi.mocked(fetch).mockResolvedValue(Response.json({ code: "internal" }, { status: 500 }));
  fireEvent.click(button);
  await waitFor(() => expect(screen.getAllByRole("combobox")[0]).toHaveFocus());
});
