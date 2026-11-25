import { beforeEach, expect, it, vi } from "vitest";
import { assessment, completeSnapshot, extension, ids, networkDiagnostic } from "@/lib/completion/fixtures.test-data";

// 고정 합성 자료와 목 저장소만 쓴다. Azure·Claude·가격 API를 부르지 않는다.
const mocks = vi.hoisted(() => ({
  claude: vi.fn(), azure: vi.fn(), scans: vi.fn(), latest: vi.fn(), assessments: vi.fn(), analyses: vi.fn(), extensions: vi.fn(), network: vi.fn(), expiringList: vi.fn(),
}));
vi.mock("@/services/workspace-setup", () => ({ getWorkspaceClaudeOverview: mocks.claude }));
vi.mock("@/services/db/workspace-azure", () => ({ getWorkspaceAzureSettings: mocks.azure }));
vi.mock("@/services/db/scans", () => ({ listScans: mocks.scans, getLatestSucceededScan: mocks.latest }));
vi.mock("@/services/db/assessments", () => ({ listAssessments: mocks.assessments }));
vi.mock("@/services/db/analyses", () => ({ listAnalyses: mocks.analyses }));
vi.mock("@/services/db/extensions", () => ({ listExtensions: mocks.extensions }));
vi.mock("@/services/db/network-diagnostics", () => ({ peekNetworkDiagnostics: mocks.network, listNetworkDiagnostics: mocks.expiringList }));
import { loadWorkspaceOverview } from "./workspace-overview";

const now = new Date("2026-11-13T12:00:00Z");
const scan = completeSnapshot.record;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.claude.mockResolvedValue({ source: "env", apiKeyEnv: "SYNTHETIC_KEY", model: "", available: true, needsSetup: false });
  mocks.azure.mockResolvedValue({ connection: { tenantId: ids.subscription, clientId: ids.subscription, certificatePath: "/synthetic.pem", certificatePasswordEnv: null }, subscriptionIds: [ids.subscription] });
  mocks.scans.mockResolvedValue([scan]);
  mocks.latest.mockResolvedValue(scan);
  mocks.assessments.mockResolvedValue([{ id: ids.assessment, workspaceId: ids.workspace, sourceScanId: ids.scan, status: "succeeded", result: assessment, createdAt: assessment.createdAt }]);
  mocks.analyses.mockResolvedValue([{ id: "analysis-1", status: "succeeded", createdAt: "2026-11-12T00:00:00Z", requestTitle: { en: "Web app", ko: "웹 앱" } }]);
  mocks.extensions.mockResolvedValue([{ id: ids.extension, status: "succeeded", createdAt: extension.createdAt, input: extension.input, result: extension }]);
  mocks.network.mockResolvedValue([{ id: ids.network, status: "succeeded", createdAt: networkDiagnostic.createdAt, result: networkDiagnostic }]);
});

it("reads only current-workspace saved records with bounded queries and summarizes them", async () => {
  const view = await loadWorkspaceOverview(ids.workspace, now);
  for (const mock of [mocks.claude, mocks.azure, mocks.latest]) expect(mock).toHaveBeenCalledWith(ids.workspace);
  expect(mocks.scans).toHaveBeenCalledWith(ids.workspace, { limit: 20 });
  expect(mocks.assessments).toHaveBeenCalledWith(ids.workspace, { limit: 20 });
  expect(mocks.analyses).toHaveBeenCalledWith(ids.workspace, { limit: 1 });
  expect(mocks.extensions).toHaveBeenCalledWith(ids.workspace, { limit: 1 });
  expect(mocks.network).toHaveBeenCalledWith(ids.workspace, { limit: 1 });
  expect(mocks.expiringList).not.toHaveBeenCalled();
  expect(view.inventory.latest?.id).toBe(ids.scan);
  expect(view.assessment.latest).toMatchObject({ id: ids.assessment, onLatestScan: true, violationTotal: 11 });
  expect(view.build).toEqual({ id: "analysis-1", status: "succeeded", createdAt: "2026-11-12T00:00:00Z", title: { en: "Web app", ko: "웹 앱" } });
  expect(view.extend).toEqual({ id: ids.extension, status: "succeeded", createdAt: extension.createdAt, title: extension.requestTitle });
  expect(view.network).toEqual({ id: ids.network, status: "succeeded", createdAt: networkDiagnostic.createdAt, verdict: "unknown" });
});

it("keeps failed and pending records without results and an unreadable Claude setting as unknown", async () => {
  mocks.claude.mockRejectedValue(new Error("storage"));
  mocks.azure.mockResolvedValue(null);
  mocks.extensions.mockResolvedValue([{ id: ids.extension, status: "failed", createdAt: extension.createdAt, input: extension.input, result: null }]);
  mocks.network.mockResolvedValue([{ id: ids.network, status: "failed", createdAt: networkDiagnostic.createdAt, result: null }]);
  const view = await loadWorkspaceOverview(ids.workspace, now);
  expect(view.gaps).toContainEqual({ key: "claude-unknown" });
  expect(view.extend).toMatchObject({ status: "failed", title: null });
  expect(view.network).toMatchObject({ status: "failed", verdict: null });
});

it("does not ask for an Azure connection when settings exist without a connection but a scan was imported", async () => {
  mocks.azure.mockResolvedValue({ connection: null, subscriptionIds: [] });
  const view = await loadWorkspaceOverview(ids.workspace, now);
  expect(view.actions.map(action => action.key)).not.toContain("connect-azure");
});
