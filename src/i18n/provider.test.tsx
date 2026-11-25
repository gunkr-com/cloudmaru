import { render, screen, fireEvent } from "@testing-library/react";
import { expect, it } from "vitest";
import { useState } from "react";
import { I18nProvider, useI18n } from "./provider";
function Form() { const { t } = useI18n(); const [text, setText] = useState(""); return <><label>{t("shell.menu")}<input value={text} onChange={e => setText(e.target.value)} /></label></>; }
it("제공자 언어 변경 뒤 입력을 유지한다", () => {
  const { rerender } = render(<I18nProvider locale="en"><Form /></I18nProvider>);
  fireEvent.change(screen.getByRole("textbox", { name: "Menu" }), { target: { value: "draft" } });
  rerender(<I18nProvider locale="ko"><Form /></I18nProvider>);
  expect(screen.getByRole("textbox", { name: "메뉴" })).toHaveValue("draft");
});
it("제공자 밖은 오류다", () => { expect(() => render(<Form />)).toThrow(/I18nProvider/); });
