import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { I18nProvider } from "@/i18n/provider";
import { ResultsExplorer } from "./results-explorer";
const rows = [
  { id: "a", values: { name: "Alpha", verdict: "unknown", amount: 2 } },
  { id: "b", values: { name: "Beta", verdict: "pass", amount: 10 } },
];
const props = { scope: "test", title: "Saved checks", rows, columns: [{ key: "name", label: "Name" }, { key: "verdict", label: "Verdict" }, { key: "amount", label: "Amount" }], facets: [{ key: "verdict", label: "Filter verdict", chart: true }] };
beforeEach(() => window.history.replaceState(null, "", "/?tier=ha"));
it("expands evidence in a full row, preserves the record context and supports keyboard dismissal", () => {
  render(<I18nProvider locale="en"><ResultsExplorer {...props} renderDetails={row => <p>{row.id} saved evidence</p>}/></I18nProvider>);
  const trigger = screen.getByRole("button", {name:"Alpha"});
  expect(trigger).toHaveAttribute("aria-expanded","false");
  expect(screen.queryByText("a saved evidence")).not.toBeVisible();
  fireEvent.click(trigger);
  expect(trigger).toHaveAttribute("aria-expanded","true");
  expect(screen.getByText("a saved evidence")).toBeVisible();
  expect(screen.getByText("a saved evidence").closest("td")).toHaveAttribute("colspan","3");
  fireEvent.keyDown(screen.getByText("a saved evidence"),{key:"Escape"});
  expect(trigger).toHaveFocus();
  expect(trigger).toHaveAttribute("aria-expanded","false");
});
it("keeps the wide table keyboard reachable and explains its horizontal navigation", () => {
  render(<I18nProvider locale="en"><ResultsExplorer {...props}/></I18nProvider>);
  const region = document.getElementById("test-table")!;
  expect(region).toHaveAttribute("tabindex", "0");
  expect(region).toHaveAccessibleDescription("Scroll horizontally to see all columns. The first column stays visible.");
  region.focus();
  expect(region).toHaveFocus();
  fireEvent.keyDown(region, {key:"ArrowRight"});
  expect(region.scrollLeft).toBeGreaterThan(0);
  fireEvent.keyDown(region, {key:"ArrowLeft"});
  expect(region.scrollLeft).toBe(0);
  fireEvent.keyDown(within(region).getByRole("button", {name:"Sort by Name"}), {key:"ArrowRight"});
  expect(region.scrollLeft).toBe(0);
});

it("keeps full long identifiers and plain status labels while assigning readable column geometry", () => {
  const identifier = `/subscriptions/${"a".repeat(200)}/resources/long-name`;
  render(<I18nProvider locale="en"><ResultsExplorer {...props}
    columns={[{key:"name", label:"Name"}, {key:"resource", label:"Resource", kind:"identifier"}, {key:"verdict", label:"Verdict", kind:"status"}]}
    rows={[{id:"long", values:{name:"A readable check title", resource:identifier, verdict:"unknown"}, labels:{verdict:"Unknown"}}]}/></I18nProvider>);
  const table = screen.getByRole("table");
  expect(within(table).getByText(identifier)).toBeInTheDocument();
  expect(within(table).getByText("Unknown")).toBeInTheDocument();
  expect(table.querySelectorAll("col")).toHaveLength(3);
  expect(table).toHaveStyle({tableLayout:"fixed"});
});
it.each(["en", "ko"] as const)("filters by chart, persists URL, restores back/forward, sorts and resets in %s", locale => {
  render(<I18nProvider locale={locale}><ResultsExplorer {...props}/></I18nProvider>);
  fireEvent.click(screen.getByRole("button", { name: "unknown · 1 / 2" }));
  expect(window.location.search).toContain("test_verdict=unknown"); expect(window.location.search).toContain("tier=ha");
  const table = screen.getByRole("table", { name: "Saved checks" });
  expect(within(table).queryByText("Beta")).toBeNull(); expect(within(table).getByText("Alpha")).toBeInTheDocument();
  act(() => { window.history.replaceState(null, "", "/?test_q=Beta&test_sort=amount&test_direction=desc"); window.dispatchEvent(new PopStateEvent("popstate")); });
  expect(screen.getByRole("searchbox")).toHaveValue("Beta"); expect(within(table).getByText("Beta")).toBeInTheDocument();
  expect(within(table).getByRole("columnheader", { name: /Amount/ })).toHaveAttribute("aria-sort", "descending");
  fireEvent.click(screen.getByRole("button", { name: locale === "en" ? "Reset filters" : "필터 초기화" }));
  expect(screen.getByRole("searchbox")).toHaveValue(""); expect(within(table).getByText("Alpha")).toBeInTheDocument();
});
it("exports all filtered rows, rather than the current page, and releases the download URL", async () => {
  const create = vi.fn((blob: Blob) => blob instanceof Blob ? "blob:fixture" : "blob:invalid"); const revoke = vi.fn();
  Object.defineProperty(URL, "createObjectURL", { value: create, configurable: true }); Object.defineProperty(URL, "revokeObjectURL", { value: revoke, configurable: true });
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  render(<I18nProvider locale="en"><ResultsExplorer {...props} rows={[...Array.from({ length: 75 }, (_, i) => ({ id: String(i), values: { name: `Alpha ${i}`, verdict: "unknown", amount: i } })), { id:"excluded",values:{name:"Excluded",verdict:"pass",amount:0} }]}/></I18nProvider>);
  fireEvent.click(screen.getByRole("button", { name: "unknown · 75 / 76" }));
  expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(51);
  fireEvent.click(screen.getByRole("button", { name: "Export filtered CSV" }));
  expect(create).toHaveBeenCalledOnce(); const csv = await new Promise<string>((resolve, reject) => { const reader=new FileReader(); reader.onload=()=>resolve(String(reader.result)); reader.onerror=reject; reader.readAsText(create.mock.calls[0][0]); });
  expect(csv.split("\r\n")).toHaveLength(76); expect(csv).toContain("Alpha 74"); expect(csv).not.toContain("Excluded"); expect(click).toHaveBeenCalledOnce(); expect(revoke).toHaveBeenCalledWith("blob:fixture"); click.mockRestore();
});
it("does not silently replace invalid URL facet values with an empty result", () => {
  window.history.replaceState(null, "", "/?test_verdict=invalid&test_page=999");
  render(<I18nProvider locale="en"><ResultsExplorer {...props}/></I18nProvider>);
  expect(screen.getByLabelText("Filter verdict")).toHaveValue("");
  expect(within(screen.getByRole("table")).getByText("Alpha")).toBeInTheDocument();
});

it("keeps tiny signed numeric evidence visible and distinguishes missing from a literal unknown", () => {
 render(<I18nProvider locale="en"><ResultsExplorer {...props} rows={[
  { id:"tiny", values:{name:"Tiny",verdict:null,amount:-1e-12} },
  { id:"unknown", values:{name:"Unknown observation",verdict:"unknown",amount:0} },
 ]}/></I18nProvider>);
 const table=screen.getByRole("table");
 expect(within(table).getByText("-0.000000000001")).toBeInTheDocument();
 fireEvent.click(screen.getByRole("button",{name:"Not observed · 1 / 2"}));
 expect(within(table).queryByText("Unknown observation")).toBeNull();
 expect(screen.getByRole("combobox")).not.toHaveValue("");
});
