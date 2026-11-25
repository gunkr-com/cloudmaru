import { expect, it, vi } from "vitest";
const { set } = vi.hoisted(() => ({ set: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ set }) }));
import { setLocale } from "./locale-actions";
it("1년 쿠키를 쓰고 잘못된 값은 영어로 거른다", async () => {
  await setLocale("ko");
  expect(set).toHaveBeenLastCalledWith("cs_locale", "ko", { path: "/", sameSite: "lax", httpOnly: true, maxAge: 31536000 });
  await setLocale("bad"); expect(set).toHaveBeenLastCalledWith("cs_locale", "en", expect.any(Object));
});
