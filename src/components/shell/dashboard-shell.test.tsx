import { renderWithI18n as render } from "@/test/render-with-i18n";
import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DashboardShell } from "./dashboard-shell";

vi.mock("@/app/(app)/workspace-actions", () => ({ selectWorkspace: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => "/analyses/new", useSearchParams: () => new URLSearchParams() }));
describe("DashboardShell", () => {
  it("skip link와 main 안에 children을 두고 두 내비를 렌더링한다", () => {
    render(<DashboardShell {...{ workspace: { id: "w1", name: "우리 회사", companyName: "Company" }, workspaces: [{ id: "w1", name: "우리 회사", companyName: "Company" }, { id: "w2", name: "고객 A", companyName: null }], monthlyCost: { totalUsd: 0.42, uncountedCalls: 0 } }}><h1>새 분석</h1></DashboardShell>);
    expect(screen.getByRole("link", { name: "본문으로 건너뛰기" })).toHaveAttribute("href", "#main");
    expect(screen.getByRole("main")).toHaveAttribute("id", "main");
    expect(screen.getByRole("main")).toContainElement(screen.getByRole("heading", { name: "새 분석" }));
    expect(document.querySelectorAll('nav[aria-label="대시보드"]')).toHaveLength(2);
    expect(screen.getByRole("button", { name: "메뉴" })).toBeInTheDocument();
  });
});

it("영어 셸을 렌더링한다", () => {
  render(<DashboardShell workspace={{ id: "w", name: "Company", companyName: null }} workspaces={[]} monthlyCost={{ totalUsd: 0, uncountedCalls: 0 }}>content</DashboardShell>, { locale: "en" });
  expect(screen.getByRole("link", { name: "Skip to content" })).toBeInTheDocument();
});

it("collapses and restores desktop navigation while keeping the control focused", () => {
  const props = { workspace: { id: "w", name: "Company", companyName: null }, workspaces: [], monthlyCost: { totalUsd: 0, uncountedCalls: 0 } };
  render(<DashboardShell {...props}>content</DashboardShell>, { locale: "en" });
  const sidebar = screen.getByRole("complementary");
  const toggle = within(sidebar).getByRole("button", { name: "Collapse sidebar" });
  toggle.focus();
  fireEvent.click(toggle);
  expect(toggle).toHaveAccessibleName("Expand sidebar");
  expect(toggle).toHaveAttribute("aria-expanded", "false");
  expect(toggle).toHaveFocus();
  expect(within(sidebar).queryByRole("navigation")).not.toBeInTheDocument();
  expect(screen.getByRole("main").parentElement?.parentElement).toHaveAttribute("data-sidebar-collapsed", "true");
  fireEvent.click(toggle);
  expect(toggle).toHaveAttribute("aria-expanded", "true");
  expect(within(sidebar).getByRole("link", { name: "Inventory" })).toBeInTheDocument();
});
