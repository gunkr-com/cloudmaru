import { reasonCodeSchema } from "@/lib/completion/schema";
import { createTranslator } from "@/i18n/translate";
import { fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { I18nProvider } from "@/i18n/provider";
import { renderWithI18n as render } from "@/test/render-with-i18n";
import { processedFixture, proposalCatalog, proposalInventory, proposalSupport } from "@/lib/extend/proposal.test-data";
import { buildExtensionDisplay } from "@/lib/extend-app/result";
import { ExtensionResultView } from "./extension-result";
const display = () => buildExtensionDisplay(processedFixture().result, { catalog: proposalCatalog, support: proposalSupport }, proposalInventory);
it.each(["en", "ko"] as const)("shows explicit deployment instances in %s and leaves legacy cardinality absent", locale => {
  const data = display();
  for (const plan of data.result.plans) for (const item of plan.newItems) item.instanceCount = 2;
  const label = locale === "en" ? "Deployment instances: 2" : "배포 인스턴스 수: 2";
  const view = render(<ExtensionResultView display={data} />, { locale });
  expect(screen.getAllByText(label).length).toBeGreaterThan(0);
  for (const plan of data.result.plans) for (const item of plan.newItems) delete item.instanceCount;
  view.rerender(<I18nProvider locale={locale}><ExtensionResultView display={data} /></I18nProvider>);
  expect(screen.queryByText(/Deployment instances:|배포 인스턴스 수:/)).not.toBeInTheDocument();
});
beforeEach(() => { window.history.replaceState(null, "", "/extensions/saved"); });
it.each(["en", "ko"] as const)("renders three saved options, reuse/new/increases and inert explanations in %s", locale => {
  const data = display();
  data.result.requestTitle = { en: '<script>alert("unsafe")</script>', ko: '<script>악성</script>' };
  render(<ExtensionResultView display={data} />, { locale });
  expect(screen.getAllByRole("button", { pressed: false, name: locale === "en" ? /Select / : /선택/ })).toHaveLength(2);
  expect(screen.getByRole("button", { pressed: true })).toHaveTextContent(locale === "en" ? "Balanced" : "균형");
  expect(screen.getAllByText(locale === "en" ? "Recommended" : "추천")).toHaveLength(1);
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(data.result.requestTitle[locale]);
  expect(document.querySelector("script")).toBeNull();
  expect(screen.getAllByText("sample-plan").length).toBeGreaterThan(0);
  expect(screen.getByRole("heading", { name: locale === "en" ? "Increased usage" : "증가 사용량" })).toBeInTheDocument();
  expect(screen.getByText(locale === "en" ? /Account benefits have not been measured/ : /계정의 혜택을 측정한 것이 아닙니다/)).toBeInTheDocument();
  expect(screen.getByText(locale === "en" ? /Existing recurring costs are excluded/ : /기존 리소스의 기본 비용은 제외/)).toBeInTheDocument();
  expect(screen.getAllByText(/10\.1\.0\.0\/16/).length).toBeGreaterThan(0);
  fireEvent.click(screen.getByText((text, node) => node?.tagName === "SUMMARY" && /^(Reference|근거) ·/.test(text)));
  for (const a of screen.getAllByRole("link").filter(a => a.getAttribute("target") === "_blank")) {
    expect(a).toHaveAttribute("rel", "noopener noreferrer"); expect(a).toHaveAccessibleName(/new tab|새 탭/);
    expect(a.getAttribute("href")).toMatch(/^https:\/\/learn\.microsoft\.com\//);
  }
});
it("selects by keyboard, keeps URL and locale selection, reopens tier, and publishes the artifact selection", async () => {
  const data = display();
  const panel = vi.fn(({ tier }: { tier: string }) => <div data-testid="integration">{tier}</div>);
  const view = render(<I18nProvider locale="en"><ExtensionResultView display={data} renderArtifacts={panel} /></I18nProvider>);
  const ha = screen.getByRole("button", { name: /Select High availability/ });
  ha.focus(); await userEvent.setup().keyboard("{Enter}");
  expect(ha).toHaveAttribute("aria-pressed", "true"); expect(window.location.search).toBe("?tier=ha");
  expect(panel).toHaveBeenLastCalledWith({ extensionId: data.result.id, sourceScanId: data.result.sourceScanId, tier: "ha" });
  view.rerender(<I18nProvider locale="ko"><ExtensionResultView display={data} renderArtifacts={panel} /></I18nProvider>);
  expect(screen.getByRole("button", { pressed: true })).toHaveTextContent("고가용성");
  expect(screen.getByTestId("integration")).toHaveTextContent("ha");
  view.unmount();
  render(<ExtensionResultView display={data} initialTier="ha" />);
  expect(screen.getByRole("button", { pressed: true })).toHaveTextContent("고가용성");
});
it("shows partial and unavailable prices without calling them zero, and preserves explicit free lines", () => {
  const data = display(); const result = data.result;
  const cost = result.plans[0].incrementalCost;
  if (!("data" in cost)) throw Error("fixture");
  result.plans[0].incrementalCost = { state: "partial", data: { ...cost.data, lines: [cost.data.lines[0]], total: cost.data.lines[0].amount }, reasons: ["price-unavailable"] };
  result.plans[1].incrementalCost = { state: "unavailable", reason: "unsupported-region" };
  render(<ExtensionResultView display={data} initialTier="low" />, { locale: "en" });
  expect(screen.getByRole("table", { name: "Cost breakdown" })).toHaveTextContent("Priced subtotal");
  expect(screen.getAllByText(/estimate is incomplete/).length).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole("button", { name: /Select Balanced/ }));
  expect(screen.queryByRole("table", { name: "Cost breakdown" })).not.toBeInTheDocument();
  expect(screen.getAllByText("Unavailable").length).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole("button", { name: /Select High availability/ }));
  const table = screen.getByRole("table", { name: "Cost breakdown" });
  expect(within(table).getAllByText("CA$0.00").length).toBeGreaterThan(0);
  expect(within(table).getAllByText("Free").length).toBeGreaterThan(0);
});
it("displays actual checks/evidence, structured new parent and independent coverage, never treats unknown as pass", () => {
  const data = display();
  data.result.contextCoverage = { total: 9, included: 4, excluded: 5, reasons: [{ code: "context-limit", count: 5 }] };
  data.result.plans[2].checks[0].verdict = "violation";
  render(<ExtensionResultView display={data} initialTier="ha" />, { locale: "en" });
  expect(screen.getByText("New VNet parent")).toBeInTheDocument();
  expect(screen.getByText(/10\.2\.0\.0\/16/)).toBeInTheDocument();
  expect(screen.getByText(/4 of 9/)).toBeInTheDocument();
  expect(screen.getByText(/Context limit.*5/)).toBeInTheDocument();
  expect(screen.getByText(/Collection completeness.*Complete/)).toBeInTheDocument();
  expect(screen.getAllByText("Violation").length).toBeGreaterThan(0);
  expect(screen.getAllByText("Unknown").length).toBeGreaterThan(0);
  expect(screen.getByText(/does not approve deployment/)).toBeInTheDocument();
  expect(document.body.textContent).toContain("/properties/");
});
it("shows complete explicit zero as an amount while new-only unknown remains unknown", () => {
  const data = display(); const plan = data.result.plans[0];
  const line = plan.incrementalCost;
  if (!("data" in line)) throw Error("fixture");
  line.data.lines = line.data.lines.map(l => ({ ...l, amount: 0 })); line.data.total = 0;
  plan.checks = plan.checks.map(c => ({ ...c, verdict: "unknown", reasonCodes: ["unsupported-path"], evidence: [] }));
  render(<ExtensionResultView display={data} initialTier="low" />, { locale: "en" });
  expect(screen.getByRole("table", { name: "Cost breakdown" })).toHaveTextContent("CA$0.00");
  expect(screen.getAllByText("Unknown")).toHaveLength(4);
  expect(screen.queryByText("Pass")).not.toBeInTheDocument();
});
it("shows only saved structured service cards and escapes resource, input and evidence text", () => {
  const data = display();
  data.result.input.description = '<img src=x onerror="alert(1)">';
  data.result.recommendationReason.en = "Invented Compute at CA$1: https://untrusted.invalid";
  const id = data.result.plans[0].reusedResources[0].resourceId;
  data.resources[id].name = '<a href="https://untrusted.invalid">resource</a>';
  render(<ExtensionResultView display={data} initialTier="low" />, { locale: "en" });
  expect(screen.getByText(data.result.input.description)).toBeInTheDocument();
  expect(screen.getAllByText(data.resources[id].name).length).toBeGreaterThan(0);
  expect(document.querySelector("img")).toBeNull();
  expect(document.querySelector('a[href="https://untrusted.invalid"]')).toBeNull();
  expect(screen.queryByRole("heading", { name: "Invented Compute" })).not.toBeInTheDocument();
});
it("restores selection on browser back and keeps unavailable price date from pinned evidence", () => {
  const data = display();
  data.result.plans[0].incrementalCost = { state: "unavailable", reason: "price-unavailable" };
  render(<ExtensionResultView display={data} />, { locale: "en" });
  fireEvent.click(screen.getByRole("button", { name: /Select Lowest cost/ }));
  expect(screen.getByText(`Price as of ${data.priceAsOf} · CAD`)).toBeInTheDocument();
  window.history.replaceState(null, "", "?tier=ha");
  fireEvent.popState(window);
  expect(screen.getByRole("button", { pressed: true })).toHaveTextContent("High availability");
});

it.each(["en", "ko"] as const)("distinguishes saved runs with identical prose and different assumptions in %s", locale => {
  const first = display(), second = display();
  first.result.input.expectedUsers = "under-100"; first.result.input.availability = "low";
  second.result.input.expectedUsers = "over-100k"; second.result.input.availability = "high";
  const view = render(<ExtensionResultView display={first} />, { locale });
  const t = createTranslator(locale);
  expect(screen.getByText(`${t("analysis.usersLabel")} · ${t("analysis.users100")}`)).toBeInTheDocument();
  expect(screen.getByText(`${t("analysis.availabilityLabel")} · ${t("analysis.availabilityLow")}`)).toBeInTheDocument();
  const before = view.container.textContent;
  view.rerender(<I18nProvider locale={locale}><ExtensionResultView display={second} /></I18nProvider>);
  expect(view.container.textContent).not.toBe(before);
  expect(screen.getByText(`${t("analysis.usersLabel")} · ${t("analysis.usersOver100k")}`)).toBeInTheDocument();
  expect(screen.getByText(`${t("analysis.availabilityLabel")} · ${t("analysis.availabilityHigh")}`)).toBeInTheDocument();
  expect(screen.getByText(first.result.input.description)).toBeInTheDocument();
});

it.each(["en", "ko"] as const)("renders all saved coverage reasons and code-check kinds in %s", locale => {
 const data=display();
 data.result.contextCoverage={total:reasonCodeSchema.options.length,included:0,excluded:reasonCodeSchema.options.length,
  reasons:reasonCodeSchema.options.map(code=>({code,count:1}))};
 const {container}=render(<ExtensionResultView display={data}/>,{locale});
 const t=createTranslator(locale);
 for(const code of reasonCodeSchema.options)expect(container.textContent).toContain(t(`extension.reasons.${code}`));
 for(const check of data.result.plans.find(p=>p.tier===data.result.recommendedTier)!.checks)
  expect(container.textContent).toContain(t(`extension.result.${check.kind}`));
 expect(container.textContent).not.toMatch(/extension\.(reasons|result|verdict)\./);
});

it("compares saved reuse/new counts and explores selected additions", () => {
 render(<ExtensionResultView display={display()}/>,{locale:"en"});
 expect(screen.getByRole("table",{name:"Option comparison"})).toBeInTheDocument();
 expect(screen.getByRole("table",{name:"Explore components"})).toBeInTheDocument();
});

it.each(["en", "ko"] as const)("links the saved %s Extend result to its report for the selected option", locale => {
  const data = display();
  render(<ExtensionResultView display={data} />, { locale });
  const name = locale === "en" ? "View report" : "보고서 보기";
  expect(screen.getByRole("link", { name })).toHaveAttribute("href", `/extensions/${data.result.id}/report?lang=${locale}&tier=${data.result.recommendedTier}`);
  const other = data.result.plans.find(p => p.tier !== data.result.recommendedTier)!;
  fireEvent.click(screen.getByRole("button", { pressed: false, name: new RegExp(createTranslator(locale)(`common.tiers.${other.tier}`)) }));
  expect(screen.getByRole("link", { name })).toHaveAttribute("href", `/extensions/${data.result.id}/report?lang=${locale}&tier=${other.tier}`);
});
