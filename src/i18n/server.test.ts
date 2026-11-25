import { expect, it, vi } from "vitest";
const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get }) }));
import { getLocale, getI18n } from "./server";
it("쿠키가 없으면 영어, 한국어 쿠키면 한국어를 읽는다", async () => {
  get.mockReturnValue(undefined);
  expect(await getLocale()).toBe("en"); expect((await getI18n()).t("shell.menu")).toBe("Menu");
  expect(get).toHaveBeenCalledWith("cs_locale");
  get.mockReturnValue({ value: "ko" }); expect((await getI18n()).t("shell.menu")).toBe("메뉴");
  get.mockReturnValue({ value: "invalid" }); expect(await getLocale()).toBe("en");
});
