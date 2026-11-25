import { expect, it, vi } from "vitest";
import { I18nProvider } from "@/i18n/provider";
const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get }) }));
vi.mock("next/font/local", () => ({ default: () => ({ variable: "font" }) }));
import RootLayout, { generateMetadata } from "./layout";
it("쿠키가 없으면 영어 html과 제공자를 만든다", async () => {
  get.mockReturnValue(undefined);
  const tree = await RootLayout({ children: "content" });
  expect(tree.props.lang).toBe("en");
  expect(tree.props.children.props.children.type).toBe(I18nProvider);
  expect(tree.props.children.props.children.props.locale).toBe("en");
  expect((await generateMetadata()).description).toContain("Explore Azure");
});
it("한국어 쿠키를 lang과 메타데이터에 반영한다", async () => {
  get.mockReturnValue({ value: "ko" });
  expect((await RootLayout({ children: "content" })).props.lang).toBe("ko");
  expect((await generateMetadata()).description).toContain("요구사항");
});
