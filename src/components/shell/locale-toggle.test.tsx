import { fireEvent, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { renderWithI18n } from "@/test/render-with-i18n";
import { LocaleToggle } from "./locale-toggle";
import { setLocale } from "@/app/(app)/locale-actions";
vi.mock("@/app/(app)/locale-actions", () => ({ setLocale: vi.fn(async () => {}) }));
it("언어별 버튼과 선택 상태를 표시하고 액션으로만 바꾼다", async () => {
  renderWithI18n(<LocaleToggle />, { locale: "en" });
  expect(screen.getByRole("button", { name: "EN" })).toHaveAttribute("lang", "en");
  expect(screen.getByRole("button", { name: "EN" })).toHaveAttribute("aria-pressed", "true");
  const ko = screen.getByRole("button", { name: "한국어" });
  expect(ko).toHaveAttribute("lang", "ko"); expect(ko).toHaveAttribute("aria-pressed", "false");
  fireEvent.click(ko); await waitFor(() => expect(setLocale).toHaveBeenCalledWith("ko"));
});
