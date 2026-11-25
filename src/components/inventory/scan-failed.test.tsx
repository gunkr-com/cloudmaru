import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { createTranslator } from "@/i18n/translate";
import { I18nProvider } from "@/i18n/provider";
import { CONNECTION_ERROR_CODES } from "@/lib/scans/error-messages";
import { ScanFailed } from "./scan-failed";
vi.mock("@/i18n/server", () => ({ getI18n: async () => ({ locale: "en", t: createTranslator("en") }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

it.each(CONNECTION_ERROR_CODES)("offers connection editing and live retry for %s", async errorCode => {
  render(<I18nProvider locale="en">{await ScanFailed({ workspaceId: "owner", source: "live", errorCode, isCurrentWorkspace: true })}</I18nProvider>);
  expect(screen.getByRole("alert")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Edit connection" })).toHaveAttribute("href", "/workspaces/owner/connection");
  expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Import file" })).not.toBeInTheDocument();
});
it("does not run a scan in another workspace", async () => {
  render(await ScanFailed({ workspaceId: "owner", source: "live", errorCode: "timeout", isCurrentWorkspace: false }));
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Edit connection" })).not.toBeInTheDocument();
  expect(screen.getByText("Switch to this scan's workspace to run it again.")).toBeInTheDocument();
});
it.each([null, "connection-missing"] as const)("renders an error and only an inventory link for imports (%s)", async errorCode => {
  render(await ScanFailed({ workspaceId: "owner", source: "import", errorCode, isCurrentWorkspace: true }));
  expect(screen.getByRole("alert")).toBeInTheDocument();
  if (errorCode === null) expect(screen.getByRole("alert")).toHaveTextContent("The scan could not be completed.");
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
  expect(screen.getByRole("link")).toHaveAttribute("href", "/inventory");
});
