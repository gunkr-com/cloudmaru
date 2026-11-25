import { renderWithI18n as render } from "@/test/render-with-i18n";
import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Sidebar } from "./sidebar";
import { createTranslator } from "@/i18n/translate";
vi.mock("next/navigation", () => ({ usePathname: () => "/analyses/new" }));
vi.mock("@/app/(app)/workspace-actions", () => ({ selectWorkspace: vi.fn() }));
const props = { workspace: { id: "w1", name: "우리 회사", companyName: "Company" }, workspaces: [{ id: "w1", name: "우리 회사", companyName: "Company" }, { id: "w2", name: "고객 A", companyName: null }], monthlyCost: { totalUsd: 0.42, uncountedCalls: 0 } };
describe("Sidebar", () => {
  it("개요를 다른 메뉴보다 먼저 두고 현재 위치로 표시한다", () => {
    render(<Sidebar {...props} currentPath="/overview" />);
    const nav = screen.getByRole("navigation");
    expect(within(nav).getAllByRole("link")[0]).toHaveTextContent("개요");
    expect(within(nav).getByRole("link", { name: "개요" })).toHaveAttribute("aria-current", "page");
  });
  it("내비게이션과 현재 위치를 표시한다", () => {
    render(<Sidebar {...props} currentPath="/workspaces" />);
    expect(screen.getByRole("link", { name: "새 분석" })).toHaveAttribute("href", "/analyses/new");
    expect(screen.getByRole("link", { name: "분석 기록" })).toHaveAttribute("href", "/analyses");
    expect(screen.getByRole("link", { name: "워크스페이스" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "개요" })).toHaveAttribute("href", "/overview");
    expect(screen.getByRole("link", { name: "개요" })).not.toHaveAttribute("aria-current");
    expect(screen.queryByText("로그아웃")).not.toBeInTheDocument();
    expect(screen.queryByText("구독 관리")).not.toBeInTheDocument();
  });
  it("펼친 목록에서 각 워크스페이스 선택 폼과 관리 링크를 제공한다", () => {
    render(<Sidebar {...props} />);
    fireEvent.click(document.querySelector("summary")!);
    expect(screen.getByRole("link", { name: "워크스페이스 관리" })).toHaveAttribute("href", "/workspaces");
    const button = screen.getByRole("button", { name: "고객 A" });
    expect(button.closest("form")?.querySelector('input[name="workspaceId"]')).toHaveValue("w2");
    expect(screen.getByRole("button", { name: /우리 회사/ })).toHaveAttribute("aria-current", "true");
  });
  it("USD 비용과 단가 없는 호출 수를 표시한다", () => {
    render(<Sidebar {...props} monthlyCost={{ totalUsd: 12.3, uncountedCalls: 2 }} />);
    expect(screen.getByText("이번 달 · Claude API")).toBeInTheDocument();
    expect(screen.getByText("US$12.30")).toBeInTheDocument();
    expect(screen.getByText("단가를 알 수 없는 호출 2건 제외")).toBeInTheDocument();
  });
  it("제외한 호출이 없으면 안내를 생략하고 경로를 자동 판정한다", () => {
    render(<Sidebar {...props} />);
    expect(screen.getByText("US$0.42")).toBeInTheDocument();
    expect(screen.queryByText(/단가를 알 수 없는/)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "새 분석" })).toHaveAttribute("aria-current", "page");
  });
});

it("영어 셸을 렌더링한다", () => {
  render(<Sidebar {...props} />, { locale: "en" });
  expect(screen.getByRole("link", { name: "New analysis" })).toBeInTheDocument();
});

it.each(["en", "ko"] as const)("인벤토리 활성 표시와 이름 붙인 메뉴 묶음 %s", locale => {
  render(<Sidebar {...props} currentPath="/inventory/scans/abc" />, { locale });
  const nav = screen.getByRole("navigation");
  const build = within(nav).getByRole("group", { name: locale === "en" ? "Build" : "구축" });
  const assess = within(nav).getByRole("group", { name: locale === "en" ? "Assess" : "점검" });
  expect(within(build).getAllByRole("link").map(link => link.getAttribute("href"))).toEqual(["/analyses/new", "/analyses"]);
  expect(within(assess).getByRole("link", { name: locale === "en" ? "Inventory" : "인벤토리" })).toHaveAttribute("href", "/inventory");
  expect(within(assess).getByRole("link", { name: locale === "en" ? "Inventory" : "인벤토리" })).toHaveAttribute("aria-current", "page");
  expect(within(nav).getAllByRole("link").map(link => link.getAttribute("href"))).toEqual(["/overview", "/analyses/new", "/analyses", "/inventory", "/assessments", "/network", "/extensions", "/workspaces"]);
  expect(within(nav).getAllByRole("link").filter(link => link.hasAttribute("aria-current"))).toHaveLength(1);
});


it.each(["en","ko"] as const)("exposes completed modes with localized groups and one active nested route %s",locale=>{
 render(<Sidebar {...props} currentPath="/extensions/example"/>,{locale});
 const nav=screen.getByRole("navigation");
 const assess=within(nav).getByRole("group",{name:locale==="en"?"Assess":"점검"});
 expect(within(assess).getAllByRole("link").map(a=>a.getAttribute("href"))).toEqual(["/inventory","/assessments","/network"]);
 const extend=within(nav).getByRole("group",{name:locale==="en"?"Extend":"확장"});
 expect(within(extend).getByRole("link",{name:locale==="en"?"Extension history":"확장 기록"})).toHaveAttribute("aria-current","page");
 expect(within(nav).getAllByRole("link").filter(a=>a.hasAttribute("aria-current"))).toHaveLength(1);
});

it.each(["en", "ko"] as const)("keeps every completed nested route active across navigation in %s", locale => {
  const t = createTranslator(locale);
  const routes = [
    ["/overview", "shell.nav.overview", "/overview"],
    ["/analyses/new", "shell.nav.newAnalysis", "/analyses/new"],
    ["/analyses/saved", "shell.nav.history", "/analyses"],
    ["/inventory/scans/saved", "shell.nav.inventory", "/inventory"],
    ["/assessments/saved/report", "shell.nav.assessments", "/assessments"],
    ["/network/saved", "shell.nav.network", "/network"],
    ["/extensions/saved", "shell.nav.extensions", "/extensions"],
    ["/workspaces/saved/claude", "shell.nav.workspaces", "/workspaces"],
  ] as const;
  const view = render(<Sidebar {...props} />, { locale });
  for (const [path, key, href] of routes) {
    view.rerender(<Sidebar {...props} currentPath={path} />);
    const nav = screen.getByRole("navigation", { name: t("shell.navigation") });
    const current = within(nav).getByRole("link", { name: t(key) });
    expect(current).toHaveAttribute("href", href);
    expect(current).toHaveAttribute("aria-current", "page");
    expect(nav.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
    expect(within(nav).getAllByRole("link")).toHaveLength(8);
  }
});
