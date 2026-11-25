import { I18nProvider } from "@/i18n/provider";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import AppError from "./error";

describe("AppError", () => {
  it("레이아웃 오류도 영어 안내와 재시도, 새 분석 링크로 보여주고 기술 오류는 숨긴다", () => {
    const retry = vi.fn();
    render(<I18nProvider locale="en"><AppError error={new Error("secret stack detail")} retry={retry} /></I18nProvider>);

    expect(screen.getByRole("main")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Could not load this page.");
    expect(screen.getByRole("alert")).toHaveTextContent("Your input is saved in this browser. Try again in a moment.");
    expect(screen.queryByText("secret stack detail")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "New analysis" })).toHaveAttribute("href", "/analyses/new");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalledOnce();
  });
});
