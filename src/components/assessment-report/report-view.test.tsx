import * as formats from "@/i18n/format";
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { I18nProvider } from "@/i18n/provider";
import { AssessmentReportView } from "./report-view";
import type { AssessmentReport } from "@/lib/assessment/report/document";
const attack='<img src="https://evil.test/x" onerror="alert(1)"> ![x](https://evil.test/x) ``` [go](javascript:alert(1))';
const doc=(locale:"en"|"ko"):AssessmentReport=>({id:"00000000-0000-4000-8000-000000000001",locale,title:locale === "en" ? "Assessment report" : "점검 보고서",sections:[
  {id:"findings",title:"Evidence",level:2,blocks:[{kind:"text",text:attack},{kind:"code",text:attack},{kind:"time",label:"Collected",value:"2026-11-12T10:00:00Z"},
  {kind:"source",label:"Source",href:"https://learn.microsoft.com/en-us/azure/templates/microsoft.web/sites"}]}
]});
it.each(["en","ko"] as const)("prints semantic %s output with inert model/resource content and only catalog links",locale=>{
  const {container}=render(<I18nProvider locale={locale}><AssessmentReportView report={doc(locale)}/></I18nProvider>);
  expect(screen.getByRole("heading",{level:1})).toHaveTextContent(doc(locale).title);
  expect(container.querySelector("article")).toHaveAttribute("lang",locale);
  expect(container.querySelectorAll("script,img,iframe,object")).toHaveLength(0);
  expect(container.textContent).toContain(attack);expect(container.querySelector("time")).toHaveAttribute("datetime","2026-11-12T10:00:00Z");
  expect(container.textContent).toContain("2026-11-12T10:00:00Z");
  expect([...container.querySelectorAll("a[href^='http']")].map(a=>a.getAttribute("href"))).toEqual([doc(locale).sections[0].blocks[3].kind === "source" ? "https://learn.microsoft.com/en-us/azure/templates/microsoft.web/sites" : ""]);
  const print=vi.spyOn(window,"print").mockImplementation(()=>{});
  fireEvent.click(screen.getByRole("button",{name:locale === "en" ? "Print / save PDF" : "인쇄 / PDF 저장"}));expect(print).toHaveBeenCalledOnce();print.mockRestore();
});

it.each(["en", "ko"] as const)("uses the report %s time locale when root context has the opposite locale", locale => {
  const other = locale === "en" ? "ko" : "en";
  const format = vi.spyOn(formats, "formatDateTime").mockImplementation((_value, usedLocale) => `${usedLocale} formatted time`);
  const { container } = render(<I18nProvider locale={other}><AssessmentReportView report={doc(locale)}/></I18nProvider>);
  expect(container.querySelector("time")).toHaveTextContent(`${locale} formatted time`);
  expect(format).toHaveBeenCalledWith("2026-11-12T10:00:00Z", locale);
  format.mockRestore();
});
