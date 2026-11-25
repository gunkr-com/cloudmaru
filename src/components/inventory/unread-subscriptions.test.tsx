import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { I18nProvider } from "@/i18n/provider";
import { summarizeInventory } from "@/lib/inventory/summarize";
import { UnreadSubscriptions } from "./unread-subscriptions";

it.each(["en", "ko"] as const)("renders unread IDs in %s without warning styling and hides an empty list", locale => {
  const summary = { ...summarizeInventory([], []), subscriptionIds: ["sub-a"] };
  const { container, rerender } = render(<I18nProvider locale={locale}><UnreadSubscriptions subscriptionIds={["SUB-A", "sub-b"]} summary={summary} /></I18nProvider>);
  expect(screen.getByRole("heading")).toHaveTextContent(locale === "en" ? "Subscriptions not read" : "읽지 못한 구독");
  expect(screen.getByText("sub-b")).toHaveClass("font-mono");
  expect(screen.queryByText("SUB-A")).not.toBeInTheDocument();
  expect(container.textContent).toContain(locale === "en" ? "1 subscription returned no resources" : "구독이 1개");
  expect(container.querySelector(".text-warning")).toBeNull();
  rerender(<I18nProvider locale={locale}><UnreadSubscriptions subscriptionIds={["SUB-A"]} summary={summary} /></I18nProvider>);
  expect(container).toBeEmptyDOMElement();
});
