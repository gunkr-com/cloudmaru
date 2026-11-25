import { expect, it } from "vitest";
import { assessment as en } from "../en/assessment";
import { assessment as ko } from "../ko/assessment";
import { MESSAGES } from "../index";
import { createTranslator } from "@/i18n/translate";
import type { ComponentState } from "@/types/completion";
import type { FindingVerdict, AssessmentSeverity, AssessmentPillar } from "@/types/assessment";

function shape(value: object): unknown {
  return Object.fromEntries(Object.entries(value).map(([key, leaf]) => [key,
    typeof leaf === "string" ? [...leaf.matchAll(/\{([^}]+)\}/g)].map(match => match[1]).sort() : shape(leaf)]));
}
it("assessment 사전의 키·매개변수·등록과 실제 상태 라벨을 검증한다", () => {
  expect(shape(ko)).toEqual(shape(en));
  expect(MESSAGES.en.assessment).toBe(en);
  expect(MESSAGES.ko.assessment).toBe(ko);
  expect(en.status).toEqual({"pending":"Assessing","succeeded":"Completed","failed":"Failed"});
  expect(en.componentStatus).toEqual({"not-requested":"Not requested","available":"Available","partial":"Partially available","unavailable":"Unavailable","failed":"Failed"});
  expect(en.verdict).toEqual({"pass":"Pass","violation":"Violation","unknown":"Unknown"});
  const states: Record<ComponentState, string> = en.componentStatus;
  const verdicts: Record<FindingVerdict, string> = en.verdict;
  const severity: Record<AssessmentSeverity, string> = en.severity;
  const pillars: Record<AssessmentPillar, string> = en.pillars;
  expect(Object.keys(states)).toHaveLength(5);
  expect(Object.keys(verdicts)).toHaveLength(3);
  expect(Object.keys(severity)).toHaveLength(5);
  expect(Object.keys(pillars)).toHaveLength(5);
  function check(value: object) {
    for (const child of Object.values(value)) {
      if (typeof child === "string") expect(child.trim().length).toBeGreaterThan(0);
      else check(child);
    }
  }
  check(en);
  check(ko);
});
it("assessment의 소유 스캔 문구를 두 언어로 치환한다", () => {
  expect(createTranslator("en")("assessment.sourceScan", { id: "saved-scan" })).toContain("saved-scan");
  expect(createTranslator("ko")("assessment.sourceScan", { id: "saved-scan" })).toContain("saved-scan");
});
it("gives every catalog rule a next check and every resource role a plain description in both languages", async () => {
  const { loadAssessmentRules } = await import("@/lib/assessment/rules/catalog");
  const { inventory } = await import("../en/inventory");
  for (const rule of loadAssessmentRules().rules) {
    expect(en.topology.nextChecks[rule.id as keyof typeof en.topology.nextChecks]).toBeTruthy();
    expect(ko.topology.nextChecks[rule.id as keyof typeof ko.topology.nextChecks]).toBeTruthy();
  }
  expect(Object.keys(en.topology.roles).toSorted()).toEqual(Object.keys(inventory.families).toSorted());
  expect(en.topology.relations.hosts).toBe("hosts");
});
