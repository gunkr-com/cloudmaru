import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import { createTranslator } from "@/i18n/translate";
import { ResourceTable } from "./resource-table";
import type { ResourceTablePage } from "@/types/inventory";
const state = vi.hoisted(() => ({ locale: "en" as "en" | "ko" }));
const formProps = vi.hoisted(() => [] as Record<string, unknown>[]);
vi.mock("next/form", () => ({
  default: ({ prefetch, ...props }: ComponentProps<"form"> & { prefetch?: false | null }) => {
    formProps.push({ prefetch, ...props });
    return <form {...props} />;
  },
}));
vi.mock("@/i18n/server", () => ({ getI18n: async () => ({ locale: state.locale, t: createTranslator(state.locale) }) }));
const page: ResourceTablePage = { rows: [{ id: "/resource/id", name: "app", type: "microsoft.web/sites", resourceGroup: "rg-app", location: null, subscriptionId: "12345678-rest", subscriptionName: null, tagCount: 0 }], total: 151, matched: 151, page: 2, pageCount: 4, from: 51, to: 100, types: [{ type: "microsoft.web/sites", count: 151 }], appliedType: "microsoft.web/sites" };
const query = { q: "app & API", type: "microsoft.web/sites", page: 2 };

it.each(["en", "ko"] as const)("renders a server table in %s with scoped scrolling, sticky first column and filters", async locale => {
  state.locale = locale;
  const view = render(await ResourceTable({ scanId: "scan", query, data: page }));
  const table = screen.getByRole("table", { name: locale === "en" ? "Resources" : "리소스" });
  const cell = within(table).getByText("app");
  expect(cell).toHaveAttribute("title", "/resource/id");
  expect(cell).toHaveClass("sticky", "left-0", "bg-surface-1");
  expect(table.parentElement).toHaveClass("overflow-x-auto", "relative");
  expect(screen.getByText("12345678")).toBeInTheDocument();
  expect(screen.getByText(locale === "en" ? "No tags" : "태그 없음")).toBeInTheDocument();
  expect(screen.getByRole("searchbox")).toHaveValue(query.q);
  expect(screen.getByRole("combobox")).toHaveValue(query.type);
  const form = view.container.querySelector("form")!;
  expect(form.method).toBe("get");
  expect(form).toHaveAttribute("autocomplete", "off");
  expect(view.container.querySelector('input[name="page"]')).toBeNull();
  const labels = locale === "en" ? ["Previous page", "Next page"] : ["이전 쪽", "다음 쪽"];
  for (const [index, label] of labels.entries()) {
    const url = new URL(screen.getByRole("link", { name: label }).getAttribute("href")!, "http://localhost");
    expect(url.pathname).toBe("/inventory/scans/scan");
    expect(url.searchParams.get("q")).toBe(query.q);
    expect(url.searchParams.get("type")).toBe(query.type);
    expect(url.searchParams.get("page")).toBe(index === 0 ? "1" : "3");
  }
});
it("uses singular English for one tag and one match", async () => {
  state.locale = "en";
  render(await ResourceTable({ scanId: "scan", query, data: { ...page, rows: [{ ...page.rows[0], tagCount: 1 }], matched: 1, from: 1, to: 1, page: 1, pageCount: 1 } }));
  expect(screen.getByText("1 tag")).toBeInTheDocument();
  expect(screen.getByText("Showing 1–1 of 1 resource")).toBeInTheDocument();
});

it("hides pagination at boundaries and shows no matches", async () => {
  state.locale = "en";
  const view = render(await ResourceTable({ scanId: "scan", query, data: { ...page, page: 1 } }));
  expect(screen.queryByRole("link", { name: "Previous page" })).not.toBeInTheDocument();
  view.rerender(await ResourceTable({ scanId: "scan", query, data: { ...page, page: 4 } }));
  expect(screen.queryByRole("link", { name: "Next page" })).not.toBeInTheDocument();
  view.rerender(await ResourceTable({ scanId: "scan", query, data: { ...page, rows: [], matched: 0, from: 0, to: 0, page: 1, pageCount: 1 } }));
  expect(screen.getByText("No resources match. Change the search or type.")).toBeInTheDocument();
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
  expect(screen.queryByText(/Showing/)).not.toBeInTheDocument();
  expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
});

// Back/forward reuses the form DOM, so edited uncontrolled fields kept the previous filters.
it("resets the search and type fields when the query changes", async () => {
  state.locale = "en";
  const view = render(await ResourceTable({ scanId: "scan", query, data: page }));
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "no-such-resource" } });
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "" } });
  view.rerender(await ResourceTable({ scanId: "scan", query: { q: "app-dev-1", type: null, page: 1 }, data: { ...page, appliedType: null } }));
  expect(screen.getByRole("searchbox")).toHaveValue("app-dev-1");
  expect(screen.getByRole("combobox")).toHaveValue("");
  view.rerender(await ResourceTable({ scanId: "scan", query, data: page }));
  expect(screen.getByRole("searchbox")).toHaveValue("app & API");
  expect(screen.getByRole("combobox")).toHaveValue("microsoft.web/sites");
});

// A native GET submit made back/forward reload the document, and the browser restored the fields
// typed before leaving. next/form navigates on the client, so the key above applies. The App Router
// Form does not load in Vitest, so this pins the wiring; the browser test checks back/forward.
it("submits the filters through next/form without prefetch or field restore", async () => {
  state.locale = "en";
  formProps.length = 0;
  render(await ResourceTable({ scanId: "scan", query, data: page }));
  expect(formProps).toHaveLength(1);
  expect(formProps[0]).toMatchObject({ action: "/inventory/scans/scan", prefetch: false, autoComplete: "off" });
  expect(formProps[0]).not.toHaveProperty("method");
});
