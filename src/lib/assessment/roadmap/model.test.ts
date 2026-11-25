import { expect, it } from "vitest";
import { z } from "zod";
import { buildRoadmapContext } from "./context";
import { roadmapFixture, roadmapModelFixture } from "./fixtures.test-data";
import { buildRoadmapRequest, createRoadmapOutputSchema, createRoadmapValidator, validateRoadmapOutput,
  RoadmapNoDataError, type RoadmapModelOutput } from "./model";
import { validateStoredRoadmap } from "./storage-validation";
import { composeExplanation } from "./explanation";

const generatedAt = "2026-11-12T10:01:00Z";
function fixture() {
  const { parent, catalogData } = roadmapFixture();
  const context = buildRoadmapContext(parent, catalogData);
  const output: RoadmapModelOutput = roadmapModelFixture(context.payload);
  return { parent, catalogData, context, output };
}
it("exports a strict StructuredLlmRequest with aliases, explicit coverage and bounded bilingual text, without private data", () => {
  const { context, parent, catalogData } = fixture();
  const request = buildRoadmapRequest(context);
  expect(Object.keys(request).sort()).toEqual(["jsonSchema", "schemaName", "system", "user"]);
  expect(request.schemaName).toBe("assessment_roadmap");
  expect(request.jsonSchema).toEqual(z.toJSONSchema(createRoadmapOutputSchema(context)));
  expect(request.system).toContain("공백과 문장 부호");
  expect(request.system).toContain("Advisor");
  const json = JSON.stringify(request);
  for (const value of [parent.id, parent.workspaceId, parent.sourceScanId, parent.local.findings[0].id,
    "/subscriptions/", "private-name", "10.40", ...catalogData.rules.rules.flatMap(r => r.sources)]) expect(json).not.toContain(value);
  expect(JSON.parse(request.user)).toMatchObject({ schemaVersion: 1, coverage: { total: 80, included: 80 }, findings: context.payload.findings });
});
it("resolves all aliases into saved findings and exact catalog actions; code supplies IDs/version/time", () => {
  const { context, output, parent, catalogData } = fixture();
  output.phases.reverse();
  const result = validateRoadmapOutput(output, context, generatedAt);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.value.generatedAt).toBe(generatedAt); expect(result.value.schemaVersion).toBe(1);
  expect(result.value.phases.map(p => p.id)).toEqual(["phase-1", "phase-2"]);
  expect(new Set(result.value.phases.flatMap(p => p.findingIds))).toEqual(new Set(parent.local.findings.map(f => f.id)));
  for (const phase of result.value.phases) {
    const ruleId = parent.local.findings.find(f => f.id === phase.findingIds[0])!.ruleId;
    expect(phase.actions).toEqual([catalogData.rules.rules.find(r => r.id === ruleId)!.remediation]);
  }
  expect(validateStoredRoadmap(result.value, { assessment: parent, catalogData,
    createdAt: parent.local.evaluatedAt, completedAt: generatedAt })).toEqual(result.value);
  expect(createRoadmapValidator(context, () => generatedAt)(output)).toEqual(result);
});
it("accepts complete multi-action groups in one phase in stable server finding/action order", () => {
  const { context, output } = fixture();
  const merged = { summary: output.summary, phases: [{ title: output.phases[0].title,
    findingAliases: output.phases.flatMap(p => p.findingAliases).reverse(), actionAliases: output.phases.flatMap(p => p.actionAliases).reverse() }] };
  const first = validateRoadmapOutput(merged, context, generatedAt);
  merged.phases[0].findingAliases.reverse(); merged.phases[0].actionAliases.reverse();
  expect(validateRoadmapOutput(merged, context, generatedAt)).toEqual(first);
  expect(first.ok).toBe(true);
});
it.each(["unknown-finding", "foreign-finding", "raw-id", "duplicate-finding", "duplicate-phase-finding", "missing-finding",
  "missing-group", "wrong-action", "unknown-action", "duplicate-action", "extra-action", "split-group", "metadata", "no-phases",
  "url", "scheme", "amount", "verdict", "service", "english-hangul", "language-pair", "empty-ko", "long-en", "extra-localized", "bad-time"])(
  "rejects %s with a static sanitized error in either language", kind => {
    const { context, output, parent } = fixture();
    let time = generatedAt;
    if (kind === "unknown-finding") output.phases[0].findingAliases[0] = "f999999";
    if (kind === "foreign-finding") output.phases[0].findingAliases[0] = "00000000-0000-4000-8000-000000000999";
    if (kind === "raw-id") output.phases[0].findingAliases[0] = parent.local.findings[0].resourceId;
    if (kind === "duplicate-finding") output.phases[0].findingAliases.push(output.phases[0].findingAliases[0]);
    if (kind === "duplicate-phase-finding") output.phases[1].findingAliases.push(output.phases[0].findingAliases[0]);
    if (kind === "missing-finding") output.phases[0].findingAliases.pop();
    if (kind === "missing-group") output.phases.pop();
    if (kind === "wrong-action") output.phases[0].actionAliases = output.phases[1].actionAliases;
    if (kind === "unknown-action") output.phases[0].actionAliases[0] = "a999999";
    if (kind === "duplicate-action") output.phases[0].actionAliases.push(output.phases[0].actionAliases[0]);
    if (kind === "extra-action") output.phases[0].actionAliases.push(output.phases[1].actionAliases[0]);
    if (kind === "split-group") output.phases[1].findingAliases.push(output.phases[0].findingAliases.pop()!);
    if (kind === "metadata") Object.assign(output, { schemaVersion: 1, generatedAt, actions: ["arbitrary"], verdict: "pass", amount: 1 });
    if (kind === "no-phases") output.phases = [];
    if (kind === "url") output.summary.en = "https://evil.example SECRET 비밀" as never;
    if (kind === "scheme") output.summary.en = "javascript:alert(1)" as never;
    if (kind === "amount") output.summary.en = "Save CA$1,000 per month." as never;
    if (kind === "verdict") output.summary.en = "All findings pass." as never;
    if (kind === "service") output.summary.en = "Deploy Azure Kubernetes Service." as never;
    if (kind === "english-hangul") output.summary.en = "Review 비밀" as never;
    if (kind === "language-pair") output.summary.ko = "영어와 다른 의미입니다.";
    if (kind === "empty-ko") output.summary.ko = "" as never;
    if (kind === "long-en") output.summary.en = "a".repeat(2000) as never;
    if (kind === "extra-localized") Object.assign(output.summary, { url: "SECRET 비밀" });
    if (kind === "bad-time") time = "SECRET 비밀";
    expect(validateRoadmapOutput(output, context, time)).toEqual({ ok: false, errors: ["assessment-roadmap-output-invalid"] });
  });
it("rejects no-actionable contexts before building a request and excludes pass aliases from output", () => {
  const { parent, catalogData } = roadmapFixture();
  const pass = parent.local.findings[0]; pass.verdict = "pass"; pass.reasonCode = null;
  pass.evidence = [{ resourceId: pass.resourceId, propertyPath: "/properties/httpsOnly", observation: { state: "present", value: true } }];
  const context = buildRoadmapContext(parent, catalogData);
  const output = { summary: {en:"Invalid",ko:"무효"}, phases: [{ title: {en:"Invalid",ko:"무효"},
    findingAliases: [pass.id], actionAliases: [context.payload.actions[0].alias] }] };
  expect(validateRoadmapOutput(output, context, generatedAt).ok).toBe(false);
  parent.local.findings = [pass]; parent.local.coverage = { total: 1, included: 1, excluded: 0, reasons: [] };
  const empty = buildRoadmapContext(parent, catalogData);
  expect(() => buildRoadmapRequest(empty)).toThrow(RoadmapNoDataError);
  expect(() => createRoadmapOutputSchema(empty)).toThrow("no-data");
  expect(validateRoadmapOutput(output, empty, generatedAt).ok).toBe(false);
});

it.each(["before", "after"] as const)("accepts generated grounded synthesis using %s order", surface => {
  const { output, context } = fixture();
  output.summary = composeExplanation({ relation: "sequence", actions: context.payload.actions.map(a => a.alias), focus: "mixed" }, context.payload, surface);
  expect(validateRoadmapOutput(output, context, generatedAt).ok).toBe(true);
  expect(buildRoadmapRequest(context).user).toContain("Enable HTTPS-only traffic");
});
it.each(["Install Redis for HTTPS traffic.", "HTTPS traffic now passes all checks.", "HTTPS traffic costs 25 CAD.",
  "HTTPS review for /subscriptions/00000000-0000-4000-8000-000000000001", "HTTPS at evil.example", "HTTPS eliminates all risk."])("rejects invented claims in grounded prose %s", text => {
  const { output, context } = fixture(); output.summary.en = text;
  expect(validateRoadmapOutput(output, context, generatedAt).ok).toBe(false);
});
it("applies strict shape and 1.25 length tolerance to generated prose", () => {
  const { context, output } = fixture();
  const schema = createRoadmapOutputSchema(context);
  output.summary.en = "Review HTTPS traffic. ".padEnd(750, " ");
  expect(schema.safeParse(output).success).toBe(true);
  output.summary.en += "x";
  expect(schema.safeParse(output).success).toBe(false);
  output.summary.en = "Review HTTPS traffic.";
  Object.assign(output.phases[0].title, { extra: true });
  expect(schema.safeParse(output).success).toBe(false);
});

it.each([
  { en: "Prioritize HTTPS with redis acceleration.", ko: "HTTPS 우선 검토" },
  { en: "Prioritize HTTPS traffic protection.", ko: "HTTPS와 쿠버네티스 우선 검토" },
  { en: "HTTPS traffic guarantees complete security.", ko: "HTTPS 우선 검토" },
  { en: "Review HTTPS with 9000 monthly savings.", ko: "HTTPS 우선 검토" },
])("rejects service/benefit invention in generated prose in both languages", summary => {
  const { context, output } = fixture(); output.summary = summary;
  expect(validateRoadmapOutput(output, context, generatedAt).ok).toBe(false);
});

it.each([
  { en: "disable HTTPS-only traffic.", ko: "HTTPS 전용 트래픽을 설정합니다." },
  { en: "HTTPS is configured. TLS is enabled.", ko: "HTTPS 설정과 TLS 확인이 필요합니다." },
  { en: "Review HTTPS before TLS.", ko: "TLS 이후 HTTPS를 검토합니다." },
  { en: "Review HTTPS traffic protection.", ko: "가상데스크톱으로 전환 후 HTTPS 검토" },
])("rejects the independently reproduced unsafe prose before resolving it: $en", summary => {
  const { context, output } = fixture(); output.summary = summary;
  expect(validateRoadmapOutput(output, context, generatedAt).ok).toBe(false);
});
it("accepts a generated source-specific sequence with the same semantic order in both languages", () => {
  const { context, output } = fixture();
  output.summary = composeExplanation({ relation: "sequence", actions: context.payload.actions.map(a => a.alias), focus: "mixed" }, context.payload);
  output.phases.forEach((p, i) => { p.title = composeExplanation({ relation: "review", actions: [context.payload.actions[i].alias], focus: "review" }, context.payload, "before", true); });
  expect(validateRoadmapOutput(output, context, generatedAt).ok).toBe(true);
});
