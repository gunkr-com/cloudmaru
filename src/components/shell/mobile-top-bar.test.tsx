import { renderWithI18n as render } from "@/test/render-with-i18n";
import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MobileTopBar } from "./mobile-top-bar";
import userEvent from "@testing-library/user-event";
import { createTranslator } from "@/i18n/translate";

vi.mock("@/app/(app)/workspace-actions", () => ({ selectWorkspace: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => "/analyses", useSearchParams: () => new URLSearchParams() }));
const props = { workspace: { id: "w1", name: "우리 회사", companyName: "Company" }, workspaces: [{ id: "w1", name: "우리 회사", companyName: "Company" }, { id: "w2", name: "고객 A", companyName: null }], monthlyCost: { totalUsd: 0.42, uncountedCalls: 0 } };

describe("MobileTopBar", () => {
  it("메뉴를 열고 링크 선택 또는 Escape로 닫는다", () => {
    render(<MobileTopBar {...props} />);
    const trigger = screen.getByRole("button", { name: "메뉴" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("navigation", { name: "대시보드" })).not.toBeInTheDocument();
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(screen.getByRole("link", { name: "새 분석" }));
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(trigger);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("메뉴 안에서 Escape로 닫으면 포커스를 메뉴 버튼으로 돌린다", () => {
    render(<MobileTopBar {...props} />);
    const trigger = screen.getByRole("button", { name: "메뉴" });
    fireEvent.click(trigger);
    const link = screen.getByRole("link", { name: "분석 기록" });
    link.focus();
    fireEvent.keyDown(link, { key: "Escape" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveFocus();
  });

  it("상단에 현재 워크스페이스를 표시한다", () => {
    render(<MobileTopBar {...props} />);
    expect(screen.getAllByText("우리 회사")[0]).toBeVisible();
    expect(screen.queryByText(/남은 분석/)).not.toBeInTheDocument();
  });
});

it("영어 셸을 렌더링한다", () => {
  render(<MobileTopBar {...props} />, { locale: "en" });
  expect(screen.getByRole("button", { name: "Menu" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "EN" })).toBeVisible();
});

it("모바일 메뉴에서도 인벤토리가 활성이고 선택하면 메뉴를 닫는다", () => {
  render(<MobileTopBar {...props} currentPath="/inventory/scans/abc" />);
  const trigger = screen.getByRole("button", { name: "메뉴" });
  fireEvent.click(trigger);
  expect(screen.getByRole("group", { name: "구축" })).toBeVisible();
  expect(screen.getByRole("group", { name: "점검" })).toBeVisible();
  const link = screen.getByRole("link", { name: "인벤토리" });
  expect(link).toHaveAttribute("aria-current", "page");
  fireEvent.click(link);
  expect(trigger).toHaveAttribute("aria-expanded", "false");
});

it.each(["en","ko"] as const)("mobile completed-mode links retain active path and close the menu %s",locale=>{
 render(<MobileTopBar {...props} currentPath="/network/example"/>,{locale});
 const button=screen.getByRole("button",{name:locale==="en"?"Menu":"메뉴"});
 fireEvent.click(button);
 const link=screen.getByRole("link",{name:locale==="en"?"Network diagnostics":"경로 진단"});
 expect(link).toHaveAttribute("aria-current","page");
 expect(link).toHaveAttribute("href","/network");
 expect(screen.getByRole("group",{name:locale==="en"?"Extend":"확장"})).toBeVisible();
 fireEvent.click(link); expect(button).toHaveAttribute("aria-expanded","false");
});

describe.each(["en", "ko"] as const)("completed mobile navigation in %s", locale => {
  it.each([
    ["/assessments/saved/report", "shell.nav.assessments", "/assessments"],
    ["/network/saved", "shell.nav.network", "/network"],
    ["/extensions/saved", "shell.nav.extensions", "/extensions"],
  ] as const)("supports keyboard open, dismiss and navigation from %s", async (path, key, href) => {
    const user = userEvent.setup();
    const t = createTranslator(locale);
    render(<MobileTopBar {...props} currentPath={path} />, { locale });
    const trigger = screen.getByRole("button", { name: t("shell.menu") });
    trigger.focus();
    await user.keyboard("{Enter}");
    const menu = document.getElementById(trigger.getAttribute("aria-controls")!)!;
    expect(menu).toBeVisible();
    const link = screen.getByRole("link", { name: t(key) });
    expect(link).toHaveAttribute("href", href);
    expect(link).toHaveAttribute("aria-current", "page");
    expect(menu.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
    for (let i = 0; i < 20 && document.activeElement !== link; i++) await user.tab();
    expect(link).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(menu).not.toBeVisible();
    await user.keyboard("{Enter}");
    for (let i = 0; i < 20 && document.activeElement !== link; i++) await user.tab();
    expect(link).toHaveFocus();
    // jsdom에는 문서 이동이 없으므로 기본 이동만 막고 실제 React 클릭은 실행한다.
    link.addEventListener("click", event => event.preventDefault(), { once: true });
    await user.keyboard("{Enter}");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(menu).not.toBeVisible();
  });
});
