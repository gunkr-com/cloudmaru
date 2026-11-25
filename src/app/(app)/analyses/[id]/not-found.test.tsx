vi.mock("@/i18n/server", async () => {
  const { createTranslator } = await import("@/i18n/translate");
  return { getI18n: async () => ({ locale: "en", t: createTranslator("en") }) };
});
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import AnalysisNotFound, { generateMetadata } from "./not-found";

describe("AnalysisNotFound", () => {
  it("없는 분석을 안내하고 분석 기록과 새 분석으로 보낸다", async () => {
    render(await AnalysisNotFound());

    expect(screen.getByRole("heading", { level: 1, name: "Analysis not found." })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Analysis history" })).toHaveAttribute("href", "/analyses");
    expect(screen.getByRole("link", { name: "New analysis" })).toHaveAttribute("href", "/analyses/new");
  });

  // notFound()로 그려진 첫 HTML의 <title>은 이 파일의 metadata에서 온다.
  it("문서 제목을 없는 분석 제목으로 정한다", async () => {
    expect((await generateMetadata()).title).toBe("Analysis not found · CloudMaru");
  });
});
