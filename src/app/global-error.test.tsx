import { fireEvent, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import GlobalError from "./global-error";

describe("GlobalError", () => {
  it("자체 영어 html·body에 영어와 한국어를 함께 렌더한다", () => {
    const markup = renderToStaticMarkup(<GlobalError error={new Error("secret stack detail")} retry={() => {}} />);

    expect(markup).toMatch(/^<html lang="en"[^>]*><head>.*<\/head><body[^>]*>/);
    expect(markup).toContain("<title>CloudMaru</title>");
    expect(markup).toContain("화면을 불러오지 못했습니다.");
    expect(markup).toContain("Could not load this page.");
    expect(markup).not.toContain("secret stack detail");
  });

  it("다시 시도와 새 분석 링크를 제공한다", () => {
    const retry = vi.fn();
    render(<GlobalError error={new Error("secret stack detail")} retry={retry} />);

    expect(screen.getByRole("alert")).toHaveTextContent("입력한 내용은 이 브라우저에 남아 있습니다. 잠시 후 다시 시도해 주세요.");
    expect(screen.getByRole("link", { name: /New analysis/ })).toHaveAttribute("href", "/analyses/new");
    fireEvent.click(screen.getByRole("button", { name: /Retry/ }));
    expect(retry).toHaveBeenCalledOnce();
  });
});
