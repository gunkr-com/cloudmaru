import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
vi.mock("@/i18n/server", async () => {
  const { createTranslator } = await import("@/i18n/translate");
  return { getI18n: async () => ({ locale: "en", t: createTranslator("en") }) };
});
import ConnectionNotFound from "./not-found";

// Rendered inside the app shell, which already has <main id="main">.
it("renders a not-found message inside the app shell without its own main landmark", async () => {
  const { container } = render(await ConnectionNotFound());
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Page not found.");
  expect(screen.getByText("This page may have moved or does not exist. Check the address or use the link below.")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Back to workspaces" })).toHaveAttribute("href", "/workspaces");
  expect(container.querySelector("main")).toBeNull();
});
