import { describe, expect, it, vi } from "vitest";
import * as operational from "@/lib/llm/operational-prose";
import { extensionResultSchema } from "@/lib/completion/schema";
import { createExtensionRequestContext } from "./validate-proposal";
import { fixture, proposalCatalog, proposalSupport } from "./proposal.test-data";
import { getExtensionCoreVersions, processExtensionOutput, validateStoredExtensionResult, validateHistoricalStoredExtensionResult } from "./process";
import { ids } from "@/lib/completion/fixtures.test-data";
import { calculateExtensionIncrementalCost } from "./incremental-cost";
import oldCounted from "./pre-intent-counted.test-data.json";
import { readExtensionEvidence } from "./saved-evidence";
import { referencePlan } from "./deployment.test-data";
import { calculateExtensionChecks } from "./deterministic-checks";
import { catalogSchema } from "@/lib/catalog/schema";
import { unsafeClaimsAndLiterals, ordinaryNumbers } from "./prose-policy.test-data";

it.each(unsafeClaimsAndLiterals)("rejects claims/opaque addresses through actual process and mandatory write replay: %j", text => {
  const f = success(); f.raw.recommendationReason = text;
  expect(processExtensionOutput(f.raw, f.context, binding).ok).toBe(false);
  f.result.recommendationReason = text;
  expect(() => validate(f)).toThrow("validation-failed");
});
it.each(ordinaryNumbers)("retains ordinary operational numbers through processing/current-write replay: %j", text => {
  const f = fixture(); f.raw.recommendationReason = text;
  const processed = processExtensionOutput(f.raw, f.context, binding);
  expect(processed.ok).toBe(true);
  if (!processed.ok) return;
  expect(() => validateStoredExtensionResult(processed.value, {input: f.context.input, scan: f.context.scan,
    inventory: f.context.inventory, sourceScan: processed.value.sourceScan}, {catalog: proposalCatalog, support: proposalSupport})).not.toThrow();
});

it.each(["postgres-mapping-v1", "pre-deployment"] as const)("replays frozen counted %s bytes with exact profile fingerprints and original storage policy", profile => {
  const f = structuredClone(oldCounted[profile]), before = JSON.stringify(f);
  const result = extensionResultSchema.parse(f.result);
  const context = {input: result.input, scan: f.source.scan as ReturnType<typeof fixture>["context"]["scan"], inventory: f.source.inventory as ReturnType<typeof fixture>["context"]["inventory"], sourceScan: result.sourceScan};
  expect(readExtensionEvidence(f.evidence, result, f.source)).toEqual({catalog: f.evidence.catalog, support: f.evidence.support});
  expect(() => validateHistoricalStoredExtensionResult(result, context, {catalog: proposalCatalog, support: proposalSupport})).not.toThrow();
  expect(JSON.stringify(f)).toBe(before);
  expect(() => validateStoredExtensionResult(result, context, {catalog: proposalCatalog, support: proposalSupport})).toThrow("validation-failed");
  for (const mode of ["price", "reuse", "role-projection", "zero", "partial", "old-storage-size", "postdated-binding", "postdated-delegation"]) {
    const changed = structuredClone(result), catalog = structuredClone(proposalCatalog), support = structuredClone(proposalSupport);
    if (mode === "price") catalog.prices.asOf = "2026-11-12";
    if (mode === "reuse") support.reusePolicies[0].notes.en += " Drift.";
    if (mode === "role-projection") changed.catalogVersion = getExtensionCoreVersions(catalog, support).catalogVersion;
    if (mode === "zero") changed.plans[0].newItems[0].instanceCount = 0;
    if (mode === "partial") delete changed.plans[0].newItems[0].instanceCount;
    if (mode === "postdated-binding") changed.plans[0].deploymentBindings = [];
    if (mode === "postdated-delegation") changed.plans[0].subnetProposals[0].delegation = "Microsoft.App/environments";
    if (mode === "old-storage-size") {
      const storage = changed.plans[0].newItems.find(i => i.componentId === "postgres-flex-storage")!;
      storage.quantity = 48;
      const {tier, referenceArchitectureId, title, reusedResources, newItems, usageIncreases, subnetProposals, pros} = changed.plans[0];
      const plan = {tier, referenceArchitectureId, title, reusedResources, newItems, usageIncreases, subnetProposals, pros};
      changed.plans[0].incrementalCost = calculateExtensionIncrementalCost(plan, catalog, {support, region: context.input.region});
      if (profile === "pre-deployment") continue; // Original ADR-027 allowed integral >=32GB.
    }
    expect(() => validateHistoricalStoredExtensionResult(changed, context, {catalog, support})).toThrow("validation-failed");
  }
});

const binding = { id: ids.extension, createdAt: "2026-11-12T12:00:00.000Z" };
it.each(proposalCatalog.architectures.map(a => a.id))("processes the complete current %s three-tier matrix without changing total billed quantities", id => {
  const f = fixture();
  f.raw.plans = (["low", "balanced", "ha"] as const).map(tier => referencePlan(id, tier));
  const processed = processExtensionOutput(f.raw, f.context, binding);
  expect(processed.ok).toBe(true);
  if (!processed.ok) return;
  for (const plan of processed.value.plans) {
    const reference = proposalCatalog.architectures.find(a => a.id === id)!.tiers[plan.tier];
    expect(plan.newItems.filter(i => !i.componentId.startsWith("virtual-network")).map(({componentId,quantity}) => ({componentId,quantity}))).toEqual(reference.items);
    if ("data" in plan.incrementalCost) for (const line of plan.incrementalCost.data.lines)
      expect(line.quantity).toBe(plan.newItems.find(i => i.componentId === line.componentId)!.quantity);
  }
  expect(() => validateStoredExtensionResult(processed.value, {input: f.context.input, scan: f.context.scan,
    inventory: f.context.inventory, sourceScan: processed.value.sourceScan}, {catalog: proposalCatalog, support: proposalSupport})).not.toThrow();
});
it.each(["postgres-mapping-v1", "pre-deployment"] as const)("reopens old %s usage-only rows without introducing role bindings", profile => {
  const frozen = oldCounted[profile], result = extensionResultSchema.parse(structuredClone(frozen.result)), f = fixture();
  const catalog = catalogSchema.parse(frozen.evidence.catalog);
  const context = createExtensionRequestContext(f.context.input, f.context.scan, f.context.inventory, catalog, {support: proposalSupport});
  for (const plan of result.plans) {
    plan.newItems = []; plan.subnetProposals = [];
    const {tier, referenceArchitectureId, title, reusedResources, newItems, usageIncreases, subnetProposals, pros} = plan;
    const proposal = {tier, referenceArchitectureId, title, reusedResources, newItems, usageIncreases, subnetProposals, pros};
    plan.incrementalCost = calculateExtensionIncrementalCost(proposal, catalog, {support: proposalSupport, region: context.input.region});
    plan.checks = calculateExtensionChecks(proposal, context);
  }
  const before = JSON.stringify(result);
  expect(() => validateHistoricalStoredExtensionResult(result, {input: context.input, scan: context.scan,
    inventory: context.inventory, sourceScan: result.sourceScan}, {catalog: proposalCatalog, support: proposalSupport})).not.toThrow();
  expect(JSON.stringify(result)).toBe(before);
  expect(result.plans.every(p => !Object.hasOwn(p, "deploymentBindings"))).toBe(true);
});
it("does not mistake a current usage-only success for a pre-count row after evidence loss", () => {
  const f = fixture();
  for (const plan of f.raw.plans) { plan.newItems = []; plan.subnetProposals = []; }
  const processed = processExtensionOutput(f.raw, f.context, binding);
  expect(processed.ok).toBe(true);
  if (!processed.ok) return;
  expect(() => validateHistoricalStoredExtensionResult(processed.value, {input: f.context.input, scan: f.context.scan,
    inventory: f.context.inventory, sourceScan: processed.value.sourceScan}, {catalog: proposalCatalog, support: proposalSupport})).not.toThrow();
});
it.each(["key-vault-operations", "log-analytics-ingestion", "internet-egress"])("preserves total %s usage and exact cost through processing and current-write replay", componentId => {
  const f = fixture();
  for (const plan of f.raw.plans) {
    plan.reusedResources = []; plan.usageIncreases = []; plan.subnetProposals = [];
    plan.newItems = [{componentId, quantity: 10, instanceCount: componentId === "internet-egress" ? 0 : 1}];
  }
  const first = processExtensionOutput(f.raw, f.context, binding);
  expect(first.ok).toBe(true);
  if (!first.ok) return;
  for (const plan of f.raw.plans) if (componentId !== "internet-egress") plan.newItems[0].instanceCount = 2;
  const second = processExtensionOutput(f.raw, f.context, binding);
  expect(second.ok).toBe(true);
  if (!second.ok) return;
  expect(second.value.plans.map(p => p.incrementalCost)).toEqual(first.value.plans.map(p => p.incrementalCost));
  expect(second.value.plans.map(p => p.newItems[0].quantity)).toEqual([10, 10, 10]);
  expect(() => validateStoredExtensionResult(second.value, {input: f.context.input, scan: f.context.scan,
    inventory: f.context.inventory, sourceScan: second.value.sourceScan}, {catalog: proposalCatalog, support: proposalSupport})).not.toThrow();
});
function success() {
  const f = fixture();
  const processed = processExtensionOutput(f.raw, f.context, binding);
  if (!processed.ok) throw new Error(JSON.stringify(processed.errors));
  return { ...f, result: processed.value };
}
function validate(f: ReturnType<typeof success>) {
  return validateStoredExtensionResult(f.result, { input: f.context.input, scan: f.context.scan,
    inventory: f.context.inventory, sourceScan: f.result.sourceScan }, { catalog: proposalCatalog, support: proposalSupport });
}

it.each(["en", "ko"] as const)("rejects foreign service prose through real processing and current-write replay: %s", locale => {
  const f = success();
  const text = locale === "en" ? "Use snowflake for monitoring." : "데이터독을 사용합니다.";
  f.raw.recommendationReason[locale] = text;
  expect(processExtensionOutput(f.raw, f.context, binding).ok).toBe(false);
  // A prior policy could produce these bytes. No calculated field changed.
  f.result.recommendationReason[locale] = text;
  expect(() => validate(f)).toThrow("validation-failed");
});

it.each([
  {en: "Cost is ＄１２.", ko: "비용은 ＄１２입니다."},
  {en: "Cost is ＄\u200b１２.", ko: "비용은 ＄\u200b１２입니다."},
  {en: "Cost is €12.", ko: "비용은 €12입니다."},
  {en: "Cost is £12.", ko: "비용은 £12입니다."},
  {en: "Cost is ¥12.", ko: "비용은 ¥12입니다."},
])("rejects Unicode money through real processing and current-write prose guards: %j", text => {
  const f = success();
  f.raw.recommendationReason = text;
  expect(processExtensionOutput(f.raw, f.context, binding).ok).toBe(false);
  f.result.recommendationReason = text;
  expect(() => validate(f)).toThrow("validation-failed");
});

it.each(["current", "postgres-mapping-v1", "pre-deployment", "pre-count"] as const)("preserves original prose on recognized unsealed %s reads without replaying today's positive language", profile => {
  const current = success();
  const frozen = oldCounted[profile === "postgres-mapping-v1" ? profile : "pre-deployment"];
  const result = profile === "current" ? current.result : extensionResultSchema.parse(structuredClone(frozen.result));
  const context = profile === "current" ? {input: current.context.input, scan: current.context.scan, inventory: current.context.inventory, sourceScan: result.sourceScan}
    : {input: result.input, scan: frozen.source.scan as typeof current.context.scan, inventory: frozen.source.inventory as typeof current.context.inventory, sourceScan: result.sourceScan};
  if (profile === "pre-count") for (const plan of result.plans) for (const item of plan.newItems) delete item.instanceCount;
  result.recommendationReason = {en: "Use snowflake for monitoring.", ko: "데이터독을 사용합니다."};
  result.requestTitle = {en: "Cost is ＄１２.", ko: "비용은 ＄１２입니다."};
  result.plans[0].title = unsafeClaimsAndLiterals[0];
  result.plans[1].title = unsafeClaimsAndLiterals[16];
  result.plans[1].pros = [unsafeClaimsAndLiterals[17], unsafeClaimsAndLiterals[18], unsafeClaimsAndLiterals[19]];
  result.plans[0].pros = [unsafeClaimsAndLiterals[4], unsafeClaimsAndLiterals[6], unsafeClaimsAndLiterals[7], unsafeClaimsAndLiterals[10]];
  const before = JSON.stringify(result);
  const policy = vi.spyOn(operational, "validateExtensionOperationalProse").mockImplementation(() => {throw Error("new text policy must not run");});
  try {
    expect(() => validateHistoricalStoredExtensionResult(result, context, {catalog: proposalCatalog, support: proposalSupport})).not.toThrow();
    expect(policy).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).toBe(before);
  } finally { policy.mockRestore(); }
  expect(() => validateStoredExtensionResult(result, context, {catalog: proposalCatalog, support: proposalSupport})).toThrow("validation-failed");
  // Server read compatibility retains the original rejection, not a text bypass.
  result.recommendationReason.en = "Use Azure OpenAI";
  expect(() => validateHistoricalStoredExtensionResult(result, context, {catalog: proposalCatalog, support: proposalSupport})).toThrow("validation-failed");
});
describe("public Extend processing and saved validation", () => {
  it("assembles three validated plans, exact versions, default coverage and real cost/checks without leaking private mapping", () => {
    const f = success();
    expect(extensionResultSchema.safeParse(f.result).success).toBe(true);
    expect(f.result).toMatchObject({ ...binding, ...getExtensionCoreVersions(proposalCatalog, proposalSupport),
      contextCoverage: f.context.model.payload.inventory.coverage });
    expect(f.result.plans.map(p => p.tier)).toEqual(["low", "balanced", "ha"]);
    for (const plan of f.result.plans) {
      expect(plan.incrementalCost.state).toBe("available");
      expect(plan.checks.map(c => c.kind)).toEqual(["region", "cidr", "path", "capacity"]);
      expect(plan.checks.find(c => c.kind === "capacity")).toMatchObject({ verdict: "unknown", reasonCodes: ["capacity-unverified"] });
      if ("data" in plan.incrementalCost) {
        expect(plan.incrementalCost.data.lines.some(l => l.componentId === "app-service-linux-p1v3")).toBe(false);
        expect(plan.incrementalCost.data.lines.filter(l => l.kind === "usage-increase")).toHaveLength(2);
      }
    }
    expect(JSON.stringify(f.result)).not.toMatch(/aliasToResourceId|r00000\d|"name"|"sku"|P1v3/);
    expect(() => validate(f)).not.toThrow();
    const before = JSON.stringify(f.raw);
    processExtensionOutput(f.raw, f.context, binding);
    expect(JSON.stringify(f.raw)).toBe(before);
  });
  it.each(["alias", "catalog", "cidr", "amount"])("rejects invalid %s without raw values in errors", kind => {
    const f = fixture();
    if (kind === "alias") f.raw.plans[0].reusedResources[0].resourceId = "r999999";
    if (kind === "catalog") f.raw.plans[0].newItems[0].componentId = "private-invalid-component";
    if (kind === "cidr") f.raw.plans[0].subnetProposals[0].addressPrefixes = ["10.1.1.7/24"];
    if (kind === "amount") Object.assign(f.raw, { total: 123 });
    const result = processExtensionOutput(f.raw, f.context, binding);
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toMatch(/private-invalid|10\.1\.1\.7|r999999/);
  });
  it.each(["cost", "check", "coverage", "catalogVersion", "reusePolicyVersion", "text", "usage"])("rejects saved %s tampering", kind => {
    const f = success();
    if (kind === "cost" && "data" in f.result.plans[0].incrementalCost) {
      f.result.plans[0].incrementalCost.data.lines[0].amount += 1;
      f.result.plans[0].incrementalCost.data.total += 1;
    }
    if (kind === "check") f.result.plans[0].checks[3].reasonCodes = ["missing-data"];
    if (kind === "coverage") f.result.contextCoverage = { total: 0, included: 0, excluded: 0, reasons: [] };
    if (kind === "catalogVersion" || kind === "reusePolicyVersion") f.result[kind] = "invented-version";
    if (kind === "text") f.result.requestTitle.en = "Use Azure OpenAI";
    if (kind === "usage") f.result.plans[0].usageIncreases = [];
    expect(() => validate(f)).toThrow("validation-failed");
  });
  it("fingerprints exact data, independent of object key order and sensitive to prices/policy", () => {
    const original = getExtensionCoreVersions(proposalCatalog, proposalSupport);
    const catalog = structuredClone(proposalCatalog), support = structuredClone(proposalSupport);
    const reordered = { prices: catalog.prices, architectures: catalog.architectures, components: catalog.components };
    expect(getExtensionCoreVersions(reordered, support)).toEqual(original);
    catalog.prices.asOf = "2026-11-01";
    expect(getExtensionCoreVersions(catalog, support).catalogVersion).not.toBe(original.catalogVersion);
    support.reusePolicies[0].notes.en += " Reviewed.";
    expect(getExtensionCoreVersions(catalog, support).reusePolicyVersion).not.toBe(original.reusePolicyVersion);
  });
  it("rejects a different context selection rather than persisting unreplayable coverage", () => {
    const f = fixture();
    const context = createExtensionRequestContext(f.context.input, f.context.scan, f.context.inventory,
      f.context.catalog, { support: f.context.support, maxResources: 1 });
    expect(processExtensionOutput(f.raw, context, binding).ok).toBe(false);
  });
  it("supports canonical partial price results and import provenance", () => {
    const f = fixture();
    for (const plan of f.raw.plans) plan.newItems.push({ componentId: "static-web-apps-free", quantity: 1, instanceCount: 1 });
    const result = processExtensionOutput(f.raw, f.context, binding);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.plans[0].incrementalCost).toMatchObject({ state: "partial", reasons: ["unsupported-region"] });
    expect(() => validateStoredExtensionResult(result.value, { input: f.context.input, scan: f.context.scan,
      inventory: f.context.inventory, sourceScan: result.value.sourceScan })).not.toThrow();
  });
});

it("retains deterministic default context-limit coverage and validates it on replay", () => {
  const f = fixture();
  const inventory = structuredClone(f.context.inventory);
  for (let i = 0; i < 205; i++) {
    const base = structuredClone(inventory.resources[1]);
    base.name = `z-extra-${String(i).padStart(3, "0")}`;
    base.id = base.id.slice(0, base.id.lastIndexOf("/") + 1) + base.name;
    inventory.resources.push(base);
  }
  // 전체 저장 인벤토리는 유지하고 모델 맥락에만 기본 상한을 적용한다.
  const scan = { ...f.context.scan, summary: { ...f.context.scan.summary!, resourceCount: inventory.resources.length } };
  const context = createExtensionRequestContext(f.context.input, scan, inventory, f.context.catalog, { support: f.context.support });
  // 전체 스캔 정렬이 달라지므로 이번 요청의 비공개 매핑에서 별칭을 만든다.
  const byId = new Map([...context.model.aliasToResourceId].map(([alias, id]) => [id, alias]));
  const raw = structuredClone(f.raw);
  for (const plan of raw.plans) {
    for (const item of [...plan.reusedResources, ...plan.usageIncreases]) {
      const id = f.context.model.aliasToResourceId.get(item.resourceId)!;
      item.resourceId = byId.get(id)!;
    }
    for (const subnet of plan.subnetProposals) if (subnet.parent.kind === "existing") {
      subnet.parent.resourceId = byId.get(f.context.model.aliasToResourceId.get(subnet.parent.resourceId)!)!;
    }
  }
  const result = processExtensionOutput(raw, context, binding);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.value.contextCoverage).toEqual({ total: 209, included: 200, excluded: 9, reasons: [{ code: "context-limit", count: 9 }] });
  expect(() => validateStoredExtensionResult(result.value, { input: context.input, scan, inventory, sourceScan: result.value.sourceScan })).not.toThrow();
});

it("provides a validated computed fixture for phase21 with both existing and new network parents", async () => {
  const { processedFixture } = await import("./proposal.test-data");
  const f = processedFixture();
  expect(extensionResultSchema.safeParse(f.result).success).toBe(true);
  expect(f.result.plans[0].subnetProposals[0].parent.kind).toBe("existing");
  expect(f.result.plans[2].subnetProposals[0].parent.kind).toBe("new");
  expect(() => validateStoredExtensionResult(f.result, { input: f.context.input, scan: f.context.scan,
    inventory: f.context.inventory, sourceScan: f.result.sourceScan })).not.toThrow();
});

it.each(["compute-count","storage-count","zero-count","partial-count"])("does not downgrade counted historical successes when evidence is missing: %s",kind=>{
 const f=success();const plan=f.result.plans[0];
 const compute=plan.newItems.find(i=>i.componentId.startsWith("postgres-flex-")&&i.componentId!=="postgres-flex-storage")!;
 const storage=plan.newItems.find(i=>i.componentId==="postgres-flex-storage")!;
 if(kind==="compute-count")compute.instanceCount=compute.quantity+1;
 if(kind==="storage-count")storage.instanceCount=compute.instanceCount!+1;
 if(kind==="zero-count")compute.instanceCount=0;
 if(kind==="partial-count")delete storage.instanceCount;
 expect(()=>validateHistoricalStoredExtensionResult(f.result,{input:f.context.input,scan:f.context.scan,inventory:f.context.inventory,sourceScan:f.result.sourceScan},{catalog:proposalCatalog,support:proposalSupport})).toThrow("validation-failed");
});

it("replays exact pre-deployment-metadata counted evidence without losing cardinality checks", () => {
  const f = fixture();
  const catalog = structuredClone(proposalCatalog);
  for (const component of catalog.components) { delete component.bicepDeployment; delete component.extensionDeployment; }
  for (const a of catalog.architectures) for (const tier of ["low", "balanced", "ha"] as const) delete a.tiers[tier].deploymentIntent;
  const context = createExtensionRequestContext(f.context.input, f.context.scan, f.context.inventory, catalog, { support: proposalSupport });
  // A real saved pre-metadata result has the old full-catalog fingerprint.
  const old = success();
  Object.assign(old.result, getExtensionCoreVersions(catalog, proposalSupport));
  // ADR-027 accepted integral 33GB per host; replay must retain that policy.
  for (const [index, plan] of old.result.plans.entries()) {
    const storage = plan.newItems.find(item => item.componentId === "postgres-flex-storage")!;
    storage.quantity = storage.instanceCount! * 33;
    plan.incrementalCost = calculateExtensionIncrementalCost({ ...f.raw.plans[index], newItems: plan.newItems,
      reusedResources: plan.reusedResources, usageIncreases: plan.usageIncreases, subnetProposals: plan.subnetProposals },
    catalog, { support: proposalSupport, region: context.input.region });
  }
  const validation = { input: context.input, scan: context.scan, inventory: context.inventory, sourceScan: old.result.sourceScan };
  expect(() => validateHistoricalStoredExtensionResult(old.result, validation, { catalog: proposalCatalog, support: proposalSupport })).not.toThrow();
  expect(() => validateStoredExtensionResult(old.result, validation, { catalog: proposalCatalog, support: proposalSupport })).toThrow("validation-failed");
  const drifted = structuredClone(proposalCatalog);
  drifted.prices.asOf = "2026-11-12";
  expect(() => validateHistoricalStoredExtensionResult(old.result, validation, { catalog: drifted, support: proposalSupport })).toThrow("validation-failed");
  old.result.plans[0].newItems[0].instanceCount = 0;
  expect(() => validateHistoricalStoredExtensionResult(old.result, validation, { catalog: proposalCatalog, support: proposalSupport })).toThrow("validation-failed");
});
