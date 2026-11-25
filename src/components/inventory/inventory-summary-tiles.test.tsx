import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { I18nProvider } from "@/i18n/provider";
import { summarizeInventory } from "@/lib/inventory/summarize";
import { InventorySummaryTiles } from "./inventory-summary-tiles";

it.each(["en", "ko"] as const)("renders all five formatted facts in %s, including empty inventories", locale => {
  const summary = { ...summarizeInventory([], []), resourceCount: 1234, resourceGroupCount: 2 };
  const { container, rerender } = render(<I18nProvider locale={locale}><InventorySummaryTiles summary={summary} /></I18nProvider>);
  for (const label of locale === "en" ? ["Resources", "Subscriptions", "Resource groups", "Regions", "Without tags"] : ["리소스", "구독", "리소스 그룹", "지역", "태그 없음"]) expect(screen.getByText(label)).toBeInTheDocument();
  expect(screen.getByText("1,234")).toHaveClass("tabular-nums");
  expect(container.querySelectorAll("dd")).toHaveLength(5);
  rerender(<I18nProvider locale={locale}><InventorySummaryTiles summary={summarizeInventory([], [])} /></I18nProvider>);
  expect(screen.getAllByText("0")).toHaveLength(5);
});
