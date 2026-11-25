vi.mock("@/i18n/server", async () => {
  const { createTranslator } = await import("@/i18n/translate");
  return { getI18n: async () => ({ locale: "en", t: createTranslator("en") }) };
});
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import NotFound, { generateMetadata } from "./not-found";

describe("NotFound (root)", () => {
  it("없는 주소를 영어로 안내하고 새 분석으로 보낸다", async () => {
    const { container } = render(await NotFound());

    expect(screen.getByRole("main")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Page not found." })).toBeInTheDocument();
    expect(screen.getByText("This page may have moved or does not exist. Check the address or use the link below.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "New analysis" })).toHaveAttribute("href", "/analyses/new");
    // Next 기본 404 화면의 영어 문구("404", "This page could not be found.")가 남지 않는다.
    expect(container.textContent).not.toContain("404");
  });

  it("문서 제목을 영어로 정한다", async () => {
    expect((await generateMetadata()).title).toBe("Page not found · CloudMaru");
  });
});
