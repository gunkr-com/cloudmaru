import { screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { renderWithI18n as render } from "@/test/render-with-i18n";
import { processedFixture, proposalCatalog, proposalSupport, proposalInventory } from "@/lib/extend/proposal.test-data";
import { buildExtensionDisplay } from "@/lib/extend-app/result";
import { artifactDisplayBasis } from "@/lib/extend-artifacts/render-file";
const mocks = vi.hoisted(() => ({ locale: "en", current: vi.fn(), owner: vi.fn(), get: vi.fn(), display: vi.fn(), refresh: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: mocks.locale }) }) }));
vi.mock("next/navigation", () => ({ notFound: () => { throw Error("404"); }, useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/services/current-workspace", () => ({ getCurrentWorkspace: mocks.current }));
vi.mock("@/services/db/workspaces", () => ({ getWorkspace: mocks.owner }));
vi.mock("@/services/extension-job", () => ({ extensionJobs: { get: mocks.get } }));
vi.mock("@/services/extension-job-result", () => ({ extensionResults: { getDisplay: mocks.display } }));
import Page from "./page";
const { result } = processedFixture();
const record = { id: result.id, workspaceId: result.workspaceId, sourceScanId: result.sourceScanId, input: result.input, result, sourceScan: result.sourceScan, status: "succeeded", error: null, createdAt: result.createdAt };
const props = { params: Promise.resolve({ id: record.id }), searchParams: Promise.resolve({ tier: "ha" }) };
beforeEach(() => {
  vi.clearAllMocks(); mocks.locale = "en";
  window.history.replaceState(null, "", `/extensions/${record.id}?tier=ha`);
  mocks.current.mockResolvedValue({ id: "other", name: "Current workspace" });
  mocks.owner.mockResolvedValue({ id: result.workspaceId, name: "Saved owner <img>" });
  mocks.get.mockResolvedValue(record);
  mocks.display.mockResolvedValue(buildExtensionDisplay(result, { catalog: proposalCatalog, support: proposalSupport }, proposalInventory));
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({
    basis: artifactDisplayBasis(result, { catalog: proposalCatalog, support: proposalSupport }, "ha"), artifacts: [],
  })));
});
afterEach(() => vi.unstubAllGlobals());
it.each(["en", "ko"] as const)("opens saved success in %s with the stored owner, scan and selected tier", async locale => {
  mocks.locale = locale;
  render(await Page(props), { locale });
  expect(mocks.get).toHaveBeenCalledWith(record.id); expect(mocks.display).toHaveBeenCalledWith(record.id);
  expect(screen.getByRole("button", { pressed: true })).toHaveTextContent(locale === "en" ? "High availability" : "고가용성");
  expect(screen.getAllByRole("status").some(node => node.textContent?.includes("Saved owner <img>"))).toBe(true);
  expect(await screen.findByRole("heading", { name: locale === "en" ? "Extension artifacts" : "확장 구축 결과물" })).toBeInTheDocument();
  expect(fetch).toHaveBeenCalledWith(`/api/extensions/${record.id}/artifacts?tier=ha`, expect.objectContaining({ cache: "no-store" }));
  expect(screen.getByRole("link", { name: new RegExp(record.sourceScanId) })).toHaveAttribute("href", `/inventory/scans/${record.sourceScanId}`);
  expect(document.querySelector("img")).toBeNull();
});
it("renders pending with pinned input and never requests display evidence", async () => {
  mocks.get.mockResolvedValue({ ...record, status: "pending", result: null });
  render(await Page(props));
  expect(screen.getAllByRole("status").length).toBeGreaterThan(0);
  expect(mocks.display).not.toHaveBeenCalled();
  expect(screen.getByText(result.input.description)).toBeInTheDocument();
});
it.each(["timeout", "interrupted", "validation-failed", "not-configured", "auth-failed", "forbidden", "internal"])("offers same-owner retry for %s without API prose", async code => {
  mocks.get.mockResolvedValue({ ...record, status: "failed", result: null, error: { code, detail: "SECRET" } });
  render(await Page(props));
  expect(screen.getByRole("alert")).not.toHaveTextContent("SECRET");
  expect(screen.getByRole("link", { name: "Retry" })).toHaveAttribute("href", `/extensions/new?from=${record.id}`);
  if (["not-configured", "auth-failed", "forbidden"].includes(code)) expect(screen.getByRole("link", { name: "Configure Claude key" })).toHaveAttribute("href", `/workspaces/${record.workspaceId}/claude`);
  expect(mocks.display).not.toHaveBeenCalled();
});
it("rejects absent records and shows a safe error for absent evidence rather than using latest labels", async () => {
  mocks.get.mockResolvedValueOnce(null);
  await expect(Page(props)).rejects.toThrow("404");
  mocks.display.mockResolvedValueOnce(null);
  render(await Page(props));
  expect(screen.getByRole("alert")).toHaveTextContent("saved catalog evidence");
  expect(screen.queryByRole("button", { pressed: true })).not.toBeInTheDocument();
});
