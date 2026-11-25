import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, expect, it } from "vitest";
import { I18nProvider } from "@/i18n/provider";
import { InventoryExplorer, NetworkExplorer, ActualCostExplorer, OptionMatrix } from "./saved-explorers";
import { assessment, networkDiagnostic } from "@/lib/completion/fixtures.test-data";
import { inventoryRows } from "@/lib/results-explorer/adapters";
import { resource, ids } from "@/lib/inventory/fixtures.test-data";
beforeEach(() => window.history.replaceState(null, "", "/"));
it("supports independent type/group/region filters on saved inventory metadata", () => {
 const resources = [{ ...resource(ids.vm), location: "east", resourceGroup: "one" }, { ...resource(ids.nic), location: "west", resourceGroup: "two" }];
 render(<I18nProvider locale="en"><InventoryExplorer rows={inventoryRows(resources)}/></I18nProvider>);
 fireEvent.change(screen.getByRole("combobox", { name: "Region" }), { target: { value: "west" } });
 expect(window.location.search).toContain("resources_region=west");
 expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(2);
});
it("keeps original network order in numeric columns and unknown verdict visible", () => {
 render(<I18nProvider locale="en"><NetworkExplorer paths={networkDiagnostic.engine.paths}/></I18nProvider>);
 expect(screen.getByText(/Saved static observations only/)).toBeInTheDocument();
 expect(screen.getByRole("table", { name: "Explore path observations" })).toBeInTheDocument();
});
it("shows signed original costs in separate currency/sign groups without a timeline", () => {
 render(<I18nProvider locale="en"><ActualCostExplorer scope="billing" cost={assessment.actualCost.monthToDate.data} labels={{}}/></I18nProvider>);
 expect(screen.getByText(/No time series is inferred/)).toBeInTheDocument();
 expect(screen.getByRole("table", { name: "Explore actual billing rows" })).toBeInTheDocument();
 expect(screen.getAllByText(/USD/).length).toBeGreaterThan(0);
});
it("compares explicit saved metrics without treating missing prices as zero", () => {
 render(<I18nProvider locale="en"><OptionMatrix options={[{id:"low",title:"Low",cost:null,components:3,reference:"Saved architecture",reuse:{reused:2,newItems:3,increases:1}},{id:"ha",title:"HA",cost:10,components:5,reference:"Saved HA"}]}/></I18nProvider>);
 const table=screen.getByRole("table",{name:"Option comparison"});
 expect(table.parentElement).toHaveAttribute("tabindex","0");
 expect(table.parentElement).toHaveAccessibleName("Option comparison");
 expect(within(table).getAllByText("Not observed")).toHaveLength(2); expect(within(table).getByText("2 / 3 / 1")).toBeInTheDocument();
});

it("drills from an actual charge bar into source rows with currency/sign/resource filters", () => {
 render(<I18nProvider locale="en"><ActualCostExplorer scope="billing" cost={assessment.actualCost.monthToDate.data} labels={{}}/></I18nProvider>);
 fireEvent.click(screen.getByRole("button",{name:/Show billing rows.*USD -3/}));
 expect(window.location.search).toContain("billing_currency=USD"); expect(window.location.search).toContain("billing_sign=negative");
 const table=screen.getByRole("table",{name:"Explore actual billing rows"});
 expect(within(table).getAllByRole("row")).toHaveLength(2);
 expect(within(table).getByText("USD -3")).toBeInTheDocument();
});

it("puts the exact signed amount and currency next to the resource, before subscription identifiers", () => {
  const cost = structuredClone(assessment.actualCost.monthToDate.data);
  cost.rows[0].amount = -0.00000021;
  render(<I18nProvider locale="en"><ActualCostExplorer scope="billing" cost={cost} labels={{}}/></I18nProvider>);
  const table = screen.getByRole("table", { name: "Explore actual billing rows" });
  expect(within(table).getAllByRole("columnheader").map(node => node.textContent?.replace(/[↑↓↕]/g, ""))).toEqual([
    "Resource", "Original amount", "Currency", "Charge / credit", "Subscription",
  ]);
  expect(within(table).getByText(`${cost.rows[0].currency} -0.00000021`)).toBeInTheDocument();
});
