import { screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { renderWithI18n as render } from "@/test/render-with-i18n";
import type { WorkspaceOverview } from "@/types/overview";

// 목 서비스와 합성 값만 쓴다.
const mocks = vi.hoisted(() => ({ locale: "en", current: vi.fn(), load: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: mocks.locale }) }) }));
vi.mock("@/services/current-workspace", () => ({ getCurrentWorkspace: mocks.current }));
vi.mock("@/services/workspace-overview", () => ({ loadWorkspaceOverview: mocks.load }));
import OverviewPage, { generateMetadata } from "./page";

const overview: WorkspaceOverview = {
  inventory: { latest: null, pendingScanId: null, latestAttemptFailure: null },
  assessment: { latestAttempt: null, latest: null },
  build: null, extend: null, network: null,
  actions: [{ key: "run-scan", href: "/inventory" }],
  gaps: [{ key: "no-scan" }],
};
beforeEach(() => {
  vi.clearAllMocks(); mocks.locale = "en";
  mocks.current.mockResolvedValue({ id: "00000000-0000-4000-8000-00000000c001", name: "Synthetic workspace" });
  mocks.load.mockResolvedValue(overview);
});

it.each(["en", "ko"] as const)("summarizes only the current workspace in %s", async locale => {
  mocks.locale = locale;
  render(await OverviewPage(), { locale });
  expect(mocks.load).toHaveBeenCalledWith("00000000-0000-4000-8000-00000000c001");
  expect(screen.getByText("Synthetic workspace")).toBeInTheDocument();
  expect(screen.getByRole("heading", { level: 1, name: locale === "en" ? "Overview" : "개요" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: locale === "en" ? "Run or import a scan" : "스캔 실행 또는 가져오기" })).toHaveAttribute("href", "/inventory");
});

it("uses a localized document title", async () => {
  mocks.locale = "ko";
  expect(await generateMetadata()).toEqual({ title: "개요 · CloudMaru" });
});
