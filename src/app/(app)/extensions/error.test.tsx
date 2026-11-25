import { fireEvent, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { renderWithI18n as render } from "@/test/render-with-i18n";
import ErrorPage from "./error";
it.each(["en", "ko"] as const)("localizes retry and hides raw error in %s", locale => {
  const retry = vi.fn(); render(<ErrorPage retry={retry} error={Error("SECRET")} />, { locale });
  expect(screen.getByRole("alert")).not.toHaveTextContent("SECRET");
  fireEvent.click(screen.getByRole("button")); expect(retry).toHaveBeenCalledTimes(1);
});
