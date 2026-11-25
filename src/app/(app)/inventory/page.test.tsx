import { render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { I18nProvider } from "@/i18n/provider";
import { createTranslator } from "@/i18n/translate";
import { summarizeInventory } from "@/lib/inventory/summarize";
import type { ScanRecord } from "@/types/scan";
import Page, { generateMetadata } from "./page";

const mocks = vi.hoisted(() => ({
  current: vi.fn(), settings: vi.fn(), list: vi.fn(), latest: vi.fn(), certificate: vi.fn(),
}));
vi.mock("@/i18n/server", () => ({ getI18n: async () => ({ locale: "en", t: createTranslator("en") }) }));
vi.mock("@/services/current-workspace", () => ({ getCurrentWorkspace: mocks.current }));
vi.mock("@/services/db/workspace-azure", () => ({ getWorkspaceAzureSettings: mocks.settings }));
vi.mock("@/services/db/scans", () => ({ listScans: mocks.list, getLatestSucceededScan: mocks.latest }));
vi.mock("@/services/azure/credential", () => ({ checkConnectionCertificate: mocks.certificate }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
const row: ScanRecord = { id: "old-success", workspaceId: "fake-workspace", source: "import", status: "succeeded", subscriptionIds: [], summary: summarizeInventory([], []), collectedAt: "2026-01-01T00:00:00Z", errorCode: null, createdAt: "2026-01-01T00:00:00Z", completedAt: "2026-01-01T00:00:00Z" };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.current.mockResolvedValue({ id: "fake-workspace", name: "Fake company" });
  mocks.settings.mockResolvedValue(null);
  mocks.list.mockResolvedValue([]);
  mocks.latest.mockResolvedValue(null);
});
const show = async () => render(<I18nProvider locale="en">{await Page()}</I18nProvider>);
it("renders an empty workspace with only import as its primary action and localized metadata", async () => {
  await show();
  expect(await generateMetadata()).toEqual({ title: "Inventory · CloudMaru" });
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Inventory");
  expect(screen.queryByRole("button", { name: "Run scan" })).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Set up connection" })).toHaveAttribute("href", "/workspaces/fake-workspace/connection");
  expect(screen.getByText("No scans yet.")).toBeInTheDocument();
  expect(screen.queryByText("Latest scan")).not.toBeInTheDocument();
  expect(mocks.certificate).not.toHaveBeenCalled();
  expect(mocks.list).toHaveBeenCalledWith("fake-workspace", { limit: 20 });
});
it("shows a separate latest success and only fresh pending progress, while truncating the tenant", async () => {
  const connection = { tenantId: "00000000-0000-0000-0000-0000000000aa", clientId: "fake", certificatePath: "/fake", certificatePasswordEnv: null };
  mocks.settings.mockResolvedValue({ connection, subscriptionIds: ["sub-a", "sub-b"] });
  mocks.certificate.mockResolvedValue({ ok: true, validTo: "2030-01-01T00:00:00Z" });
  mocks.latest.mockResolvedValue({ ...row, subscriptionIds: ["unread"] });
  mocks.list.mockResolvedValue([
    { ...row, id: "stale", status: "pending", summary: null },
    { ...row, id: "fresh", status: "pending", summary: null, createdAt: new Date().toISOString() },
  ]);
  await show();
  expect(screen.getByText("Tenant 00000000… · 2 target subscriptions")).toBeInTheDocument();
  expect(screen.getByText(/Certificate valid until/)).toBeInTheDocument();
  expect(mocks.certificate).toHaveBeenCalledWith(connection);
  expect(screen.getByRole("link", { name: "View progress" })).toHaveAttribute("href", "/inventory/scans/fresh");
  expect(screen.getByText("A scan is running.")).not.toHaveAttribute("role", "status");
  expect(screen.getByRole("link", { name: "View inventory" })).toHaveAttribute("href", "/inventory/scans/old-success");
  expect(screen.getByText("unread")).toBeInTheDocument();
  expect(screen.getByText(/The scan stopped before it finished/)).toBeInTheDocument();
  expect(document.querySelectorAll('button[data-variant="default"]')).toHaveLength(1);
  expect(mocks.latest).toHaveBeenCalledWith("fake-workspace");
});
it("renders certificate errors as warning copy and does not show stale scans as running", async () => {
  mocks.settings.mockResolvedValue({ connection: { tenantId: "00000000-fake" }, subscriptionIds: [] });
  mocks.certificate.mockResolvedValue({ ok: false, code: "certificate-expired" });
  mocks.list.mockResolvedValue([{ ...row, status: "pending" }]);
  await show();
  expect(screen.getByText(/The certificate has expired/)).toHaveClass("text-warning");
  expect(screen.queryByRole("link", { name: "View progress" })).not.toBeInTheDocument();
});
