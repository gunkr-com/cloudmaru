// @vitest-environment node
import { describe, expect, it } from "vitest";
import { processedFixture, proposalInventory, proposalScan, proposalInput, proposalCatalog, proposalSupport, savedProposal } from "@/lib/extend/proposal.test-data";
import { createExtensionRequestContext } from "@/lib/extend/validate-proposal";
import { processExtensionOutput } from "@/lib/extend/process";
import { summarizeInventory } from "@/lib/inventory/summarize";
import { ids } from "@/lib/completion/fixtures.test-data";
import { validationLimit } from "@/lib/llm/localized-text";
import {
  createArtifactTextContext, buildArtifactTextRequest, validateArtifactTextOutput,
  validateTextArtifactSemantics, guideModelOutputSchema, evaluationModelOutputSchema,
} from "./guide-evaluation";

const f = processedFixture();
const basis = { extension: f.result, inventory: f.context.inventory,
  catalogData: { catalog: f.context.catalog, support: f.context.support } };
function context(kind: "guide" | "evaluation" = "guide") {
  return createArtifactTextContext({ id: ids.network, extensionId: f.result.id, workspaceId: f.result.workspaceId,
    sourceScanId: f.result.sourceScanId, tier: "low", kind, createdAt: f.result.createdAt }, basis);
}
const text = (en = "Review the saved configuration before integration.", ko = "연결 전에 저장된 구성을 검토합니다.") => ({ en, ko });
function guide(ctx = context()) {
  return { overview: text(), prerequisites: [text("Check access permissions before starting.", "시작 전에 접근 권한을 확인합니다.")],
    cautions: [text("Capacity and connectivity remain unverified.", "용량과 연결 가능 여부는 확인되지 않았습니다.")],
    steps: [{ title: text("Integrate the workload", "워크로드를 연결합니다."), goal: text(), instructions: [text()],
      componentIds: ctx.payload.components.map(c => c.id), reusedResourceIds: ctx.payload.reusedResources.map(r => r.alias),
      verification: text("Verify the integration in an isolated environment.", "격리된 환경에서 연결 결과를 확인합니다.") }] };
}
function evaluation() {
  return { summary: text(), axes: ["reliability", "security", "cost", "operations", "performance"].map(axis => ({ axis,
    grade: "medium", rationale: text(), improvement: text("Verify the saved limitations before proceeding.", "진행 전에 저장된 제약을 확인합니다.") })) };
}
function valid(raw: unknown, ctx = context()) { return validateArtifactTextOutput(raw, ctx).ok; }

it('locates unsafe guide and evaluation prose without returning rejected text', () => {
 const ctx=context(),raw=guide(ctx);
 raw.steps[0].instructions[0].ko='Azure sk-ant-private-company-value';
 expect(validateArtifactTextOutput(raw,ctx)).toEqual({ok:false,errors:['steps.0.instructions.0.ko: unsafe-text-or-claim','steps.0.instructions.0.ko: unsupported-operational-vocabulary']});
 const e=evaluation();e.axes[2].improvement.en='Azure sk-ant-private-company-value';
 expect(validateArtifactTextOutput(e,context('evaluation'))).toEqual({ok:false,errors:['axes.2.improvement.en: unsafe-text-or-claim','axes.2.improvement.en: unsupported-operational-vocabulary']});
});

it('distinguishes unsupported vocabulary from prohibited claims without echoing model text',()=>{
 const ctx=context();
 for(const [en,reason] of [['Review zyrquolix.','unsupported-operational-vocabulary'],['The cost is 100.','prose-policy-violation']]){
  const raw=guide(ctx);raw.overview.en=en;
  const result=validateArtifactTextOutput(raw,ctx);
  expect(result).toMatchObject({ok:false,errors:expect.arrayContaining(['overview.en: unsafe-text-or-claim',`overview.en: ${reason}`])});
 }
});
it.each([
 ['Review <configuration>.','unsafe-prose-markup'],
 ['The cost is 100.','monetary-prose-claim'],
 ['Capacity is not verified.','readiness-prose-claim'],
])('identifies the exact fixed prose policy branch for %s',(en,code)=>{
 const raw=guide();raw.overview.en=en;
 const result=validateArtifactTextOutput(raw,context());
 expect(result).toMatchObject({ok:false,errors:expect.arrayContaining([`overview.en: ${code}`])});
 expect(JSON.stringify(result)).not.toContain(en);
});
it('requests reviewed phrase IDs while keeping all model-selected references separate',()=>{
 const request=buildArtifactTextRequest(context());
 expect(request.system).toContain('phraseCatalog:');
 expect(request.system).toContain('Never author prose');
 expect(request.system).toContain('1-2 instructions per step');
 expect(request.schemaName).toBe('extension_guide_plan_v1');
 expect(request.jsonSchema).toMatchObject({type:'object',additionalProperties:false});
});


describe("selected saved context and real provider request", () => {
  it("projects only the selected plan, coded checks/cost states, aliases and explicit coverage", () => {
    const ctx = context();
    const request = buildArtifactTextRequest(ctx);
    const json = JSON.stringify(ctx);
    const payload = JSON.stringify(ctx.payload);
    expect(JSON.parse(json)).toEqual({ payload: ctx.payload });
    for (const forbidden of [f.result.id, f.result.workspaceId, f.result.sourceScanId, "sample-rg", "sample-vnet", "sample-plan", "10.1.", "/subscriptions/", "aliasToResourceId", "addressPrefixes", "properties", "amount"]) {
      expect(payload).not.toContain(forbidden);
      expect(request.user).not.toContain(forbidden);
    }
    expect(ctx.payload.inventory.coverage).toEqual({ total: 4, included: 4, excluded: 0, reasons: [] });
    expect(ctx.payload.parentContextCoverage).toEqual(f.result.contextCoverage);
    expect(ctx.payload.checks.map(c => [c.kind, c.verdict])).toEqual(f.result.plans[0].checks.map(c => [c.kind, c.verdict]));
    expect(ctx.payload.cost.state).toBe(f.result.plans[0].incrementalCost.state);
    expect(ctx.payload.cost).not.toHaveProperty("total");
    expect(ctx.payload.cost.freeGrantAssumption).toBe("unverified-shared-free-grants-not-deducted");
    expect(ctx.payload.sourceScan).toEqual({ source: f.result.sourceScan.source, completeness: f.result.sourceScan.completeness });
    expect(ctx.payload.components.map(c => c.id)).not.toContain("app-service-linux-b1");
    expect(request.schemaName).toBe("extension_guide_plan_v1");
    expect(request.jsonSchema).toMatchObject({ type: "object", additionalProperties: false });
    expect(request.system).toContain("Azure"); // provider rule explicitly agrees with validator
    expect(request.system).toContain("1.25");
    expect(buildArtifactTextRequest(context("evaluation")).schemaName).toBe("extension_evaluation_plan_v1");
  });
  it("rejects an absent option, wrong parent binding, changed pinned versions or missing scan members", () => {
    const binding = { id: ids.network, extensionId: f.result.id, workspaceId: f.result.workspaceId,
      sourceScanId: f.result.sourceScanId, tier: "low" as const, kind: "guide" as const, createdAt: f.result.createdAt };
    for (const patch of [{ sourceScanId: ids.oldScan }, { extensionId: ids.assessment }, { workspaceId: ids.otherWorkspace }, { tier: "other" }, { kind: "bicep" }]) {
      expect(() => createArtifactTextContext({ ...binding, ...patch } as typeof binding, basis)).toThrow("validation-failed");
    }
    const changed = structuredClone(basis);
    changed.catalogData.catalog.prices.asOf = "2026-11-01";
    expect(() => createArtifactTextContext(binding, changed)).toThrow("validation-failed");
    expect(() => createArtifactTextContext(binding, { ...basis, inventory: { ...basis.inventory, resources: [] } })).toThrow("validation-failed");
  });
  it("snapshots private inputs and prevents forged/mutated public context affecting validation", () => {
    const ctx = context();
    const raw = guide(ctx);
    expect(valid(raw, ctx)).toBe(true);
    expect(() => buildArtifactTextRequest({ payload: ctx.payload } as typeof ctx)).toThrow("validation-failed");
    const input = structuredClone(basis);
    const c = createArtifactTextContext({ id: ids.network, extensionId: f.result.id, workspaceId: f.result.workspaceId,
      sourceScanId: f.result.sourceScanId, tier: "low", kind: "guide", createdAt: f.result.createdAt }, input);
    input.extension.plans[0].newItems = [];
    expect(valid(guide(c), c)).toBe(true);
    expect(() => { c.payload.reusedResources[0].alias = "r999999"; }).toThrow();
  });
  it("covers more than twenty selected existing entries and explicitly excludes unselected scan rows", () => {
    const inventory = structuredClone(proposalInventory);
    const extra = Array.from({ length: 24 }, (_, i) => ({ ...structuredClone(inventory.resources[3]),
      id: `${inventory.resources[3].id}-${i}`, name: `sample-logs-${i}` }));
    inventory.resources.push(...extra, { ...structuredClone(inventory.resources[3]), id: `${inventory.resources[3].id}-unused`, name: "sample-logs-unused" });
    const scan = { ...proposalScan, summary: summarizeInventory(inventory.resources, []) };
    const c = createExtensionRequestContext(proposalInput, scan, inventory, proposalCatalog, { support: proposalSupport });
    const raw = structuredClone(savedProposal);
    const byId = new Map([...c.model.aliasToResourceId].map(([a, id]) => [id, a]));
    for (const p of raw.plans) {
      for (const r of extra) {
        p.reusedResources.push({ resourceId: r.id, componentId: "log-analytics-ingestion", reason: text() });
        p.usageIncreases.push({ resourceId: r.id, componentId: "log-analytics-ingestion", quantity: 5 });
      }
      for (const item of [...p.reusedResources, ...p.usageIncreases]) item.resourceId = byId.get(item.resourceId)!;
      for (const s of p.subnetProposals) if (s.parent.kind === "existing") s.parent.resourceId = byId.get(s.parent.resourceId)!;
    }
    const processed = processExtensionOutput(raw, c, { id: ids.extension, createdAt: f.result.createdAt });
    expect(processed.ok).toBe(true);
    if (!processed.ok) throw Error();
    const ctx = createArtifactTextContext({ id: ids.network, extensionId: f.result.id, workspaceId: f.result.workspaceId,
      sourceScanId: f.result.sourceScanId, tier: "low", kind: "guide", createdAt: f.result.createdAt },
    { extension: processed.value, inventory, catalogData: basis.catalogData });
    expect(ctx.payload.reusedResources).toHaveLength(28);
    expect(ctx.payload.inventory.coverage).toEqual({ total: 29, included: 28, excluded: 1, reasons: [{ code: "redacted", count: 1 }] });
    const value = validateArtifactTextOutput(guide(ctx), ctx);
    expect(value.ok).toBe(true);
    if (value.ok && value.value.kind === "guide") expect(value.value.content.steps[0].reusedResourceIds).toHaveLength(28);
  });
});

it("preserves partial/unknown source and price states without exposing stored amounts or evidence", () => {
  for (const state of ["partial", "unavailable"] as const) {
    const input = structuredClone(basis);
    const p = input.extension.plans[0];
    if (p.incrementalCost.state !== "available") throw Error();
    const data = p.incrementalCost.data;
    p.incrementalCost = state === "partial" ? { state, reasons: ["price-unavailable"], data: {
      ...data, lines: data.lines.slice(0, 1), total: data.lines[0].amount,
    } } : { state, reason: "price-unavailable" };
    input.extension.sourceScan.source = "import";
    input.extension.sourceScan.completeness = { state: "partial", reasons: ["collection-partial", "import-scope-unverified"] };
    const ctx = createArtifactTextContext({ id: ids.network, extensionId: f.result.id, workspaceId: f.result.workspaceId,
      sourceScanId: f.result.sourceScanId, tier: "low", kind: "evaluation", createdAt: f.result.createdAt }, input);
    expect(ctx.payload.cost.state).toBe(state);
    expect(ctx.payload.cost.reasonCodes).toEqual(["price-unavailable"]);
    expect(ctx.payload.sourceScan.completeness).toEqual(input.extension.sourceScan.completeness);
    expect(JSON.stringify(ctx.payload)).not.toContain('"amount"');
    expect(JSON.stringify(ctx.payload)).not.toContain('"evidence"');
    expect(valid(evaluation(), ctx)).toBe(true);
  }
});

describe("strict guide and evaluation output", () => {
  it("accepts normal bilingual variants, resolves private aliases, and preserves coded parent results", async () => {
    const before = JSON.stringify(basis);
    const ctx = context();
    const result = validateArtifactTextOutput(guide(ctx), ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) throw Error();
    expect(result.value.kind).toBe("guide");
    if (result.value.kind === "guide") expect(result.value.content.steps[0].reusedResourceIds).toEqual(f.result.plans[0].reusedResources.map(r => r.resourceId));
    expect(await validateTextArtifactSemantics(result.value, basis)).toEqual({ policyVersion: "extend-artifact-text-v2" });
    const e = context("evaluation");
    const value = evaluation();
    value.axes.reverse();
    expect(valid(value, e)).toBe(true);
    value.summary = text("Use postgres-flex-b1ms within the saved option.", "저장된 안의 postgres-flex-b1ms를 사용합니다.");
    expect(valid(value, e)).toBe(true);
    expect(JSON.stringify(basis)).toBe(before);
    await expect(validateTextArtifactSemantics({ ...result.value, schemaVersion: 2 } as unknown as typeof result.value, basis)).rejects.toThrow();
  });
  it("requires every selected new/reused/increased component and reused member to have guide steps", () => {
    const raw = guide();
    raw.steps[0].componentIds.pop();
    expect(valid(raw)).toBe(false);
    const missing = guide(); missing.steps[0].reusedResourceIds.pop();
    expect(valid(missing)).toBe(false);
    const empty = guide(); empty.cautions = [];
    expect(valid(empty)).toBe(false);
    const foreign = guide(); foreign.steps[0].componentIds.push("app-service-linux-b1");
    expect(valid(foreign)).toBe(false);
    const duplicate = guide(); duplicate.steps[0].componentIds.push(duplicate.steps[0].componentIds[0]);
    expect(valid(duplicate)).toBe(false);
    const unknown = guide(); unknown.steps[0].reusedResourceIds.push("r999999");
    expect(valid(unknown)).toBe(false);
    const real = guide(); real.steps[0].reusedResourceIds[0] = f.result.plans[0].reusedResources[0].resourceId;
    expect(valid(real)).toBe(false);
    const other = guide(); other.steps[0].reusedResourceIds.push("r000005");
    expect(valid(other)).toBe(false);
  });
  it("rejects extra fields at every depth, wrong languages, axes, raw amount and verdict fields", () => {
    expect(guideModelOutputSchema.safeParse({ ...guide(), amount: 1 }).success).toBe(false);
    const e = evaluation(); e.axes[4].axis = "cost";
    expect(evaluationModelOutputSchema.safeParse(e).success).toBe(false);
    expect(valid({ ...guide(), content: {} })).toBe(false);
    expect(valid({ ...guide(), overview: { ...text(), fr: "extra" } })).toBe(false);
    expect(valid({ ...guide(), overview: text("잘못된 English", "정상입니다.") })).toBe(false);
    const raw = guide(); Object.assign(raw.steps[0], { verdict: "pass" });
    expect(valid(raw)).toBe(false);
    const numeric = evaluation(); Object.assign(numeric.axes[0], { amount: 0 });
    expect(valid(numeric, context("evaluation"))).toBe(false);
  });
  it("enforces field-specific ADR022 lengths exactly, including whitespace and punctuation", () => {
    const raw = guide();
    raw.steps[0].title = text('Review'+'.'.repeat(validationLimit(80)-6), '확인'+'.'.repeat(validationLimit(40)-2));
    expect(valid(raw)).toBe(true);
    raw.steps[0].title.en += "!";
    expect(valid(raw)).toBe(false);
    const e = evaluation(); e.summary = text('Review'+'.'.repeat(validationLimit(1200)-6), '확인'+'.'.repeat(validationLimit(600)-2));
    expect(valid(e, context("evaluation"))).toBe(true);
    e.summary.ko += "!";
    expect(valid(e, context("evaluation"))).toBe(false);
    const spaced = guide();
    spaced.steps[0].title.en = " " + "a".repeat(validationLimit(80));
    expect(valid(spaced)).toBe(false);
  });
  it.each([
    "Use Azure for integration.", "Use Microsoft tooling.", "Use AWS Lambda.", "Add Databricks.", "Deploy app-service-linux-b1.",
    "Deploy unknown-component.", "Use https://example.com.", "Use www.example.com.", "Use learn.microsoft.com.",
    "Open [docs](https://example.com).", "<script>alert('unsafe')</script>", "Run `az deployment create`.",
    "Use /subscriptions/00000000-0000-4000-8000-000000000001.", "Use sample-vnet.", "Use sample-rg.",
    "Connect to 10.1.1.0/24.", "Use r000001 in the instructions.", "The price is CA$100.", "The cost is 100 CAD.", "The price is 100.", "The estimate is one hundred per month.", "Use postgres-flex-b1ms-foreign.", "Use VIRTUAL-NETWORK.",
    "The service costs ten dollars.", "There is no additional cost.", "The free grant covers ingestion.",
    "Capacity is sufficient.", "The path is allowed.", "Connectivity is guaranteed.", "Deployment will succeed.",
    "All checks pass.", "The imported scope is complete.", "The estimate is the actual bill.", "Use MySQL.", "Deploy Application Gateway.", "The workload will work.",
    "Existing resources can be resized.", "남은 혜택으로 십 원입니다.",
  ])("rejects unsafe prose: %s", en => {
    expect(valid({ ...guide(), overview: text(en) })).toBe(false);
    expect(valid({ ...evaluation(), summary: text(en) }, context("evaluation"))).toBe(false);
  });
  it.each(["추가 비용은 무료입니다.", "남은 무료 한도로 충분합니다.", "용량이 충분합니다.", "통신이 보장됩니다.", "모든 검사를 통과했습니다.", "배포에 성공합니다.", "구독 전체를 확인했습니다.", "애저를 사용합니다."])("rejects Korean promises and service bypass: %s", ko => {
    expect(valid({ ...guide(), overview: text(undefined, ko) })).toBe(false);
  });
});

it.each([
  ["app", "Verify application settings."],
  ["plan", "Verify the selected plan before integration."],
  ["api", "Check API integration before proceeding."],
])("accepts normal bilingual prose when a private resource has common name %s", (name, en) => {
  const input = structuredClone(basis);
  input.inventory.resources[0].name = name;
  input.inventory.resources[0].resourceGroup = name;
  const ctx = createArtifactTextContext({ id: ids.network, extensionId: f.result.id, workspaceId: f.result.workspaceId,
    sourceScanId: f.result.sourceScanId, tier: "low", kind: "guide", createdAt: f.result.createdAt }, input);
  expect(valid({ ...guide(ctx), overview: text(en, "선택한 안의 연결 설정을 확인합니다.") }, ctx)).toBe(true);
  input.inventory.resources[0].name = "private-customer-backend";
  const unique = createArtifactTextContext({ id: ids.network, extensionId: f.result.id, workspaceId: f.result.workspaceId,
    sourceScanId: f.result.sourceScanId, tier: "low", kind: "guide", createdAt: f.result.createdAt }, input);
  expect(valid({ ...guide(unique), overview: text("Verify private-customer-backend before proceeding.") }, unique)).toBe(false);
});
it('retains declared deployment counts beside usage quantities in text context',()=>{
 const ctx=context();expect(ctx.payload.newItems.find(i=>i.componentId==='postgres-flex-storage')).toMatchObject({quantity:32,instanceCount:1});
});
it.each([
 ['Use snowflake for monitoring.','스노우플레이크를 사용합니다.'],
 ['Use DaTaDoG for monitoring.','데이터독으로 모니터링합니다.'],
 ['Use prometheus for monitoring.','프로메테우스를 사용합니다.'],
 ['Use ＳＮＯＷＦＬＡＫＥ for monitoring.','데이터도그를 사용합니다.'],
])('rejects unselected product advice in both free prose kinds: %s',(en,ko)=>{
 expect(valid({...guide(),overview:text(en,ko)})).toBe(false);
 const value=evaluation();value.axes[0].improvement=text(en,ko);
 expect(valid(value,context('evaluation'))).toBe(false);
});
