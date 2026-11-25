vi.mock("@/services/workspace-azure-diagnostics", () => ({getAzureLocalDiagnostic: vi.fn(async()=>({status:"missing",subscriptionCount:0}))}));
vi.mock("../../../setup/actions", () => ({testAzureAction:vi.fn()}));
import { screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  getWorkspace: vi.fn(), getCurrentWorkspace: vi.fn(), getWorkspaceAzureSettings: vi.fn(), checkConnectionCertificate: vi.fn(),
  notFound: vi.fn((): never => { throw new Error("NOT_FOUND"); }),
}));
vi.mock("@/services/db/workspaces", () => mocks);
vi.mock("@/services/current-workspace", () => mocks);
vi.mock("@/services/db/workspace-azure", () => mocks);
vi.mock("@/services/azure/credential", () => mocks);
vi.mock("next/navigation", () => mocks);
vi.mock("./actions", () => ({ saveAzureConnectionAction: vi.fn(), removeAzureConnectionAction: vi.fn() }));
vi.mock("@/components/workspace/azure-connection-form", () => ({ AzureConnectionForm: () => <div data-testid="connection-form" /> }));
vi.mock("@/i18n/server", async () => {
  const { createTranslator } = await import("@/i18n/translate");
  return { getI18n: async () => ({ locale: "en", t: createTranslator("en") }) };
});
import Page, { generateMetadata } from "./page";
import { renderWithI18n } from "@/test/render-with-i18n";
const id = "00000000-0000-0000-0000-000000000011";
const settings = { connection: { tenantId: "00000000-0000-0000-0000-0000000000aa", clientId: "00000000-0000-0000-0000-0000000000bb", certificatePath: "/fake/cert.pem", certificatePasswordEnv: null }, subscriptionIds: ["00000000-0000-0000-0000-000000000001"] };
const props = (query: Record<string, string> = {}, workspaceId = id) => ({ params: Promise.resolve({ id: workspaceId }), searchParams: Promise.resolve(query) });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.getWorkspace.mockResolvedValue({ id, name: "Fake company" });
  mocks.getCurrentWorkspace.mockResolvedValue({ id });
  mocks.getWorkspaceAzureSettings.mockResolvedValue(settings);
  mocks.checkConnectionCertificate.mockResolvedValue({ ok: true, validTo: "2027-11-05T12:00:00.000Z" });
});
it("renders connection metadata and saved certificate status with navigation", async () => {
  expect(await generateMetadata(props())).toEqual({ title: "Azure connection · CloudMaru" });
  renderWithI18n(await Page(props({ saved: "1" })), { locale: "en" });
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Azure connection");
  expect(screen.getByText("Workspace · Fake company")).toBeInTheDocument();
  expect(screen.getByText(/^Certificate valid until/)).toHaveTextContent("Certificate valid until 2027-11-05");
  expect(screen.getByRole("status")).toHaveTextContent("Connection saved.");
  expect(screen.getByRole("button", { name: "Remove connection" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Go to inventory" })).toHaveAttribute("href", "/inventory");
  expect(mocks.checkConnectionCertificate).toHaveBeenCalledWith(settings.connection);
});
it("renders an unconnected workspace without a certificate check or removal", async () => {
  mocks.getWorkspaceAzureSettings.mockResolvedValue({ connection: null, subscriptionIds: [] });
  mocks.getCurrentWorkspace.mockResolvedValue({ id: "another" });
  renderWithI18n(await Page(props({ removed: "1" })), { locale: "en" });
  expect(screen.getByText("Not connected")).toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("Connection removed.");
  expect(screen.queryByRole("button", { name: "Remove connection" })).toBeNull();
  expect(screen.queryByRole("link", { name: "Go to inventory" })).toBeNull();
  expect(screen.getByRole("link", { name: "Back to workspaces" })).toHaveAttribute("href", "/workspaces");
  expect(mocks.checkConnectionCertificate).not.toHaveBeenCalled();
});
it("shows only a translated certificate error and safe removal failure", async () => {
  mocks.checkConnectionCertificate.mockResolvedValue({ ok: false, code: "certificate-not-found", error: "private certificate contents" });
  renderWithI18n(await Page(props({ error: "save" })), { locale: "en" });
  expect(screen.getByText(/The certificate file could not be read/)).toHaveClass("text-warning");
  expect(screen.getByRole("alert")).toHaveTextContent("Could not save. Try again.");
  expect(screen.queryByText("private certificate contents")).toBeNull();
});
it("rejects malformed IDs before reading storage and missing workspaces", async () => {
  await expect(Page(props({}, "bad"))).rejects.toThrow("NOT_FOUND");
  expect(mocks.getWorkspace).not.toHaveBeenCalled();
  expect(mocks.getWorkspaceAzureSettings).not.toHaveBeenCalled();
  mocks.getWorkspace.mockResolvedValue(null);
  await expect(Page(props())).rejects.toThrow("NOT_FOUND");
});
it("titles malformed IDs and missing workspaces as not found", async () => {
  expect(await generateMetadata(props({}, "not-a-guid"))).toEqual({ title: "Page not found · CloudMaru" });
  expect(mocks.getWorkspace).not.toHaveBeenCalled();
  mocks.getWorkspace.mockResolvedValue(null);
  expect(await generateMetadata(props())).toEqual({ title: "Page not found · CloudMaru" });
});
