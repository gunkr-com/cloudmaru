import { reasonCodeSchema } from "@/lib/completion/schema";
import { createTranslator } from "@/i18n/translate";
import { fireEvent, screen, within } from "@testing-library/react";
import { beforeEach, expect, it } from "vitest";
import { renderWithI18n as render } from "@/test/render-with-i18n";
import { assessment, syntheticResources } from "@/lib/completion/fixtures.test-data";
import { evaluateAssessmentRules } from "@/lib/assessment/rules/engine";
import { advisorCatalog } from "@/lib/assessment/advisor-catalog";
import { loadAssessmentRules } from "@/lib/assessment/rules/catalog";
import { AssessmentResultView } from "./assessment-result";
import type { AssessmentResult, ActualCost } from "@/types/assessment";
beforeEach(() => window.history.replaceState(null, "", "/"));
it("uses the rule alone as a finding disclosure label, preserving adjacent resource and verdict cells", () => {
  const data = result();
  render(<AssessmentResultView result={data} resourceLabels={{[data.local.findings[0].resourceId]:"demo-resource"}}/>, {locale:"en"});
  const summary = document.querySelector("#findings-table td button")!;
  const rule = loadAssessmentRules().rules.find(r => r.id === data.local.findings[0].ruleId)!;
  expect(summary).toHaveAccessibleName(rule.title.en);
  expect(document.querySelector("#findings-table")!.textContent).toContain("demo-resource");
  expect(document.querySelector("#findings-table")!.textContent).toContain("Violation");
});
function result(): AssessmentResult {
  const data: AssessmentResult = structuredClone(assessment);
  data.local = evaluateAssessmentRules(syntheticResources, data.createdAt);
  const finding = data.local.findings[0];
  data.local.findings = [
    { ...finding, verdict: "pass", reasonCode: null, evidence: [{ resourceId: finding.resourceId, propertyPath: "/properties/httpsOnly", observation: { state: "present", value: false } }] },
    { ...finding, id: "violation", severity: "high", verdict: "violation", reasonCode: null },
    { ...finding, id: "unknown", verdict: "unknown", reasonCode: "missing-data", evidence: [{ resourceId: finding.resourceId, propertyPath: "/properties/missing", observation: { state: "missing" } }, { resourceId: finding.resourceId, propertyPath: "/properties/invalid", observation: { state: "invalid", reason: "invalid-data" } }] },
  ];
  if ("data" in data.advisor) data.advisor.data.recommendations = [{ ...data.advisor.data.recommendations[0], ...advisorCatalog.entries[0] }];
  return data;
}
it.each(["en", "ko"] as const)("renders catalog, all verdicts/evidence, exclusion coverage, safe diff and original signed costs in %s", locale => {
  const data = result();
  render(<AssessmentResultView result={data} resourceLabels={{ [data.local.findings[0].resourceId]: '<script>alert("x")</script>' }} />, { locale });
  expect(screen.getAllByText(loadAssessmentRules().rules.find(r => r.id === data.local.findings[0].ruleId)!.title[locale]).length).toBeGreaterThan(0);
  expect(screen.getAllByText(advisorCatalog.entries[0].title[locale]).length).toBeGreaterThan(0);
  expect(document.querySelector("script")).toBeNull();
  expect(screen.getAllByText('<script>alert("x")</script>').length).toBeGreaterThan(0);
  const text = document.body.textContent!;
  expect(text).toContain(locale === "en" ? "Not collected" : "수집되지 않음");
  expect(text).toContain(locale === "en" ? "Invalid value" : "잘못된 값");
  expect(text).toContain(locale === "en" ? "No applicable catalog rule" : "적용할 카탈로그 규칙 없음");
  expect(text).toContain(locale === "en" ? "Unmapped Advisor type" : "매핑되지 않은 Advisor 종류");
  expect(text).toContain("-US$3.00"); expect(text).toContain("CA$0"); expect(text).toContain("US$12.34");
  expect(text).toContain(locale === "en" ? "No longer observed in collection scope" : "수집 범위에서 더 이상 관측되지 않음");
  expect(text).toContain(locale === "en" ? "Azure-confirmed deletion" : "Azure에서 확인된 삭제가 아닙니다");
  expect(text).toContain(locale === "en" ? "Resource outside saved inventory" : "저장된 인벤토리 밖 리소스");
  expect(screen.getAllByRole("link").every(link => link.getAttribute("href")!.startsWith("https://learn.microsoft.com/"))).toBe(true);
  const region = screen.getByRole("region", { name: locale === "en" ? "Local checks" : "로컬 점검" });
  fireEvent.change(screen.getByLabelText(locale === "en" ? "Filter by severity" : "심각도 필터"), { target: { value: "high" } });
  expect(within(region).getAllByText(loadAssessmentRules().rules.find(r => r.id === data.local.findings[0].ruleId)!.title[locale])).toHaveLength(2);
  fireEvent.change(screen.getByLabelText(locale === "en" ? "Filter by pillar" : "평가 축 필터"), { target: { value: "cost" } });
  expect(within(region).queryByText(loadAssessmentRules().rules.find(r => r.id === data.local.findings[0].ruleId)!.title[locale])).not.toBeInTheDocument();
});
it.each(["not-requested", "available", "partial", "unavailable", "failed"] as const)("distinguishes optional %s state without losing local results", state => {
  const data = result();
  data.actualCost.monthToDate = state === "available" ? assessment.actualCost.monthToDate : state === "partial" ? { ...assessment.actualCost.monthToDate, state, reasons: ["collection-partial"] } : state === "not-requested" ? { state } : { state, reason: "no-data" };
  data.diff = { state: "not-requested" };
  data.advisor = { state: "unavailable", reason: "forbidden" };
  render(<AssessmentResultView result={data} resourceLabels={{}} />, { locale: "en" });
  const cost = screen.getByRole("region", { name: "Month to date" });
  expect(cost.textContent).toContain(({ "not-requested": "Not requested", available: "Available", partial: "Partially available", unavailable: "Unavailable", failed: "Failed" })[state]);
  if (state !== "available" && state !== "partial") expect(within(cost).queryByText("CA$0")).not.toBeInTheDocument();
  expect(screen.getByRole("region", { name: "Local checks" })).toBeInTheDocument();
  expect(screen.getByText("No comparison requested")).toBeInTheDocument();
});
it("handles empty findings, no changes, no mapped Advisor and arbitrary billing currency without CAD substitution", () => {
  const data = result(); data.local.findings = [];
  if ("data" in data.diff) data.diff.data.changes = [];
  if ("data" in data.advisor) data.advisor.data.recommendations = [];
  if ("data" in data.actualCost.monthToDate) {
    data.actualCost.monthToDate.data.rows = [{ ...data.actualCost.monthToDate.data.rows[0], currency: "EUR", amount: -0.01 }];
    data.actualCost.monthToDate.data.totals = [{ currency: "EUR", amount: -0.01, subscriptionIds: [] }];
  }
  render(<AssessmentResultView result={data} resourceLabels={{}} />, { locale: "en" });
  expect(screen.getByText(/No catalog checks apply/)).toBeInTheDocument();
  expect(screen.getByText("No mapped Advisor recommendations.")).toBeInTheDocument();
  expect(screen.getByText("No changes were observed.")).toBeInTheDocument();
  expect(screen.getAllByText("EUR -0.01")).toHaveLength(3);
});
it("does not round a small signed original charge into a fabricated zero", () => {
  const data = result();
  if ("data" in data.actualCost.monthToDate) {
    data.actualCost.monthToDate.data.rows = [{ ...data.actualCost.monthToDate.data.rows[0], amount: -1e-12 }];
    data.actualCost.monthToDate.data.totals = [{ currency: "CAD", amount: -1e-12, subscriptionIds: [] }];
  }
  render(<AssessmentResultView result={data} resourceLabels={{}} />, { locale: "en" });
  const cost = screen.getByRole("region", { name: "Month to date" });
  expect(within(cost).getAllByText("CAD -0.000000000001")).toHaveLength(3);
});
it.each(["en", "ko"] as const)("shows partial billing scope, original period and independent no-data window in %s", locale => {
  const data = result();
  const cost: ActualCost = structuredClone(assessment.actualCost.monthToDate.data);
  cost.scope.availableSubscriptionIds = [cost.scope.requestedSubscriptionIds[0]];
  cost.scope.paginationComplete = false;
  cost.rows = [cost.rows[0]]; cost.totals = [cost.totals[0]];
  data.actualCost.monthToDate = { state: "partial", data: cost, reasons: ["scope-not-collected", "collection-partial"] };
  data.actualCost.trailing30Days = { state: "unavailable", reason: "no-data" };
  render(<AssessmentResultView result={data} resourceLabels={{}} />, { locale });
  const window = screen.getByRole("region", { name: locale === "en" ? "Month to date" : "이번 달 누계" });
  expect(window.textContent).toContain(locale === "en" ? "Available 1 / requested 2 subscriptions" : "요청한 구독 2개 중 1개 조회");
  expect(window.textContent).toContain(locale === "en" ? "Pages incomplete" : "페이지 수집 불완전");
  expect(window.querySelector(`time[datetime="${cost.period.from}"]`)).toBeInTheDocument();
  expect(window.querySelector(`time[datetime="${cost.retrievedAt}"]`)).toBeInTheDocument();
  const empty = screen.getByRole("region", { name: locale === "en" ? "Last 30 days" : "최근 30일" });
  expect(empty.textContent).toContain(locale === "en" ? "No billing data returned" : "반환된 청구 자료 없음");
  expect(empty.textContent).not.toMatch(/CA\$|US\$/);
});

it("rounds computed currency totals while preserving original fractional rows", () => {
  const data = result();
  if ("data" in data.actualCost.monthToDate) {
    const base = data.actualCost.monthToDate.data.rows[0];
    data.actualCost.monthToDate.data.rows = [{...base, amount:0.1}, {...base, amount:0.2}];
    data.actualCost.monthToDate.data.totals = [{currency:"CAD",amount:0.1+0.2,subscriptionIds:[]}];
  }
  render(<AssessmentResultView result={data} resourceLabels={{}} />, {locale:"en"});
  const cost = screen.getByRole("region", {name:"Month to date"});
  expect(within(cost).getByText("CA$0.30")).toBeInTheDocument();
  expect(within(cost).getByText("CA$0.10")).toBeInTheDocument();
  expect(within(cost).getByText("CA$0.10").closest("details")).toBeInTheDocument();
  expect(cost.textContent).not.toContain("0.30000000000000004");
});
it("groups violations ahead of unknown and pass even when pass has a higher severity", () => {
  const data=result();
  data.local.findings[0].severity="critical";
  render(<AssessmentResultView result={data} resourceLabels={{}} />, {locale:"en"});
  const rows=Array.from(document.querySelectorAll("#findings-table tbody tr[data-result-row]"));
  expect(rows.map(row=>row.children[2].textContent)).toEqual(["Violation","Unknown","Pass"]);
});

it("renders saved rule text rather than a later catalog label", () => {
  const data=result(),rules=structuredClone(loadAssessmentRules());
  rules.rules.find(rule=>rule.id === data.local.findings[0].ruleId)!.title.en="Saved historical rule";
  render(<AssessmentResultView result={data} resourceLabels={{}} catalogData={{rules,advisor:advisorCatalog}} />, {locale:"en"});
  expect(screen.getAllByRole("button", {name:"Saved historical rule"})).toHaveLength(3);
});

it("shows a zero aggregate for offsetting decimal charges without hiding source rows",()=>{
 const data=result();
 if("data" in data.actualCost.monthToDate) {
  const base=data.actualCost.monthToDate.data.rows[0];
  data.actualCost.monthToDate.data.rows=[0.1,0.2,-0.3].map(amount=>({...base,amount}));
  data.actualCost.monthToDate.data.totals=[{currency:"CAD",amount:0.1+0.2-0.3,subscriptionIds:[]}];
 }
 render(<AssessmentResultView result={data} resourceLabels={{}} />,{locale:"en"});
 const cost=screen.getByRole("region",{name:"Month to date"});
 expect(within(cost).getByText("CA$0.00")).toBeInTheDocument();
 expect(within(cost).getByText("-CA$0.30")).toBeInTheDocument();
});

it.each(["en", "ko"] as const)("renders every validated optional-insight reason through the %s dictionary", locale => {
  const data = result();
  data.local.coverage = { total: reasonCodeSchema.options.length, included: 0,
    excluded: reasonCodeSchema.options.length, reasons: reasonCodeSchema.options.map(code => ({ code, count: 1 })) };
  const { container } = render(<AssessmentResultView result={data} resourceLabels={{}} />, { locale });
  const t = createTranslator(locale);
  for (const code of reasonCodeSchema.options) expect(container.textContent).toContain(t(`assessment.reasons.${code}`));
  expect(container.textContent).not.toMatch(/assessment\.(reasons|componentStatus|ui)\./);
});

it("persists verdict/severity filters and offers sorted saved findings with original evidence", () => {
 window.history.replaceState(null,"","/"); const data=result();
 render(<AssessmentResultView result={data} resourceLabels={{}}/>,{locale:"en"});
 const table=screen.getByRole("table",{name:"Explore checks"});
 fireEvent.change(screen.getByRole("combobox",{name:"Filter by verdict"}),{target:{value:"unknown"}});
 expect(window.location.search).toContain("findings_verdict=unknown");
 expect(within(table).getAllByRole("row")).toHaveLength(2);
 expect(within(table).getByText("Not collected")).toBeInTheDocument();
 window.history.replaceState(null,"","/");
});
