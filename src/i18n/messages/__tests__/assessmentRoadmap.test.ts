import { expect, it } from "vitest";
import { assessmentRoadmap as en } from "../en/assessmentRoadmap";
import { assessmentRoadmap as ko } from "../ko/assessmentRoadmap";
import { MESSAGES } from "../index";
import { createTranslator } from "@/i18n/translate";


function shape(value: object): unknown {
  return Object.fromEntries(Object.entries(value).map(([key, leaf]) => [key,
    typeof leaf === "string" ? [...leaf.matchAll(/\{([^}]+)\}/g)].map(match => match[1]).sort() : shape(leaf)]));
}
it("assessmentRoadmap 사전의 키·매개변수·등록과 실제 상태 라벨을 검증한다", () => {
  expect(shape(ko)).toEqual(shape(en));
  expect(MESSAGES.en.assessmentRoadmap).toBe(en);
  expect(MESSAGES.ko.assessmentRoadmap).toBe(ko);
  expect(en.status).toEqual({"not-requested":"Not requested","pending":"Generating roadmap","succeeded":"Ready","failed":"Failed"});

  function check(value: object) {
    for (const child of Object.values(value)) {
      if (typeof child === "string") expect(child.trim().length).toBeGreaterThan(0);
      else check(child);
    }
  }
  check(en);
  check(ko);
});
it("보고서의 인쇄 및 저장 근거 안내를 두 언어로 유지한다", () => {
  for (const locale of ["en", "ko"] as const) {
    const t = createTranslator(locale);
    expect(t("assessmentRoadmap.report.print")).toBe(MESSAGES[locale].assessmentRoadmap.report.print);
    expect(t("assessmentRoadmap.report.notice")).toBe(MESSAGES[locale].assessmentRoadmap.report.notice);
  }
});
