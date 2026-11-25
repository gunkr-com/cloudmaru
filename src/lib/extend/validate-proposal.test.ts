import { describe, expect, it } from "vitest";
import { extensionProposalSchema } from "@/lib/completion/schema";
import { createExtensionRequestContext, validateExtensionProposal, validateHistoricalExtensionProposal } from "./validate-proposal";
import { fixture, proposalInput, proposalScan, proposalInventory, proposalCatalog, proposalSupport, savedProposal } from "./proposal.test-data";
import { referencePlan } from "./deployment.test-data";
import { unsafeClaimsAndLiterals, ordinaryNumbers } from "./prose-policy.test-data";

it.each(proposalCatalog.architectures.map(a => a.id))("accepts all three current %s references with explicit host/storage/network prerequisites", id => {
  const f = fixture();
  f.raw.plans = (["low", "balanced", "ha"] as const).map(tier => referencePlan(id, tier));
  expect(validateExtensionProposal(f.raw, f.context)).toEqual({ok: true, value: f.raw});
});
it("rejects incoherent current groups with actionable private-safe paths", () => {
  const f = fixture();
  f.raw.plans = (["low", "balanced", "ha"] as const).map(tier => referencePlan("container-apps-web-api", tier));
  f.raw.plans[0].newItems.find(i => i.componentId === "container-apps-memory")!.instanceCount = 2;
  delete f.raw.plans[2].deploymentBindings;
  const result = validateExtensionProposal(f.raw, f.context);
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.errors).toEqual(expect.arrayContaining(["plans.0.newItems: container-coupled-meter-basis-mismatch", "plans.2.deploymentBindings: required-subnet-binding-missing"]));
});

const reject = (mutate: (raw: ReturnType<typeof fixture>["raw"]) => void) => {
  const { raw, context } = fixture(); mutate(raw);
  expect(validateExtensionProposal(raw, context).ok).toBe(false);
};

it.each([32, 64, 128, 32768])("accepts pinned classic storage of %s GB per host without multiplying billed usage", size => {
  const f = fixture();
  for (const plan of f.raw.plans) {
    plan.newItems = [{ componentId: plan.tier === "ha" ? "postgres-flex-gp-2vcore" : "postgres-flex-b2s", quantity: 2, instanceCount: 2 },
      { componentId: "postgres-flex-storage", quantity: size * 2, instanceCount: 2 }];
    plan.subnetProposals = [];
  }
  const result = validateExtensionProposal(f.raw, f.context);
  expect(result.ok).toBe(true);
  if (result.ok) expect(result.value.plans[0].newItems[1].quantity).toBe(size * 2);
});
it.each([33, 48, 65536])("rejects %s GB outside the pinned classic app pattern, retaining historical semantics", size => {
  const f = fixture();
  for (const plan of f.raw.plans) {
    plan.newItems = [{ componentId: "postgres-flex-gp-2vcore", quantity: 2, instanceCount: 2 },
      { componentId: "postgres-flex-storage", quantity: size * 2, instanceCount: 2 }];
    plan.subnetProposals = [];
  }
  expect(validateExtensionProposal(f.raw, f.context)).toEqual({ ok: false, errors: [0, 1, 2].map(i =>
    `plans.${i}.newItems: postgres-storage-basis-mismatch`) });
  for (const plan of f.raw.plans) for (const item of plan.newItems) delete item.instanceCount;
  expect(validateHistoricalExtensionProposal(f.raw, f.context).ok).toBe(true);
});
it("requires pinned metadata for new generation and reads its storage sizes rather than a current lookup", () => {
  const f = fixture();
  const catalog = structuredClone(proposalCatalog);
  delete catalog.components.find(c => c.id === "postgres-flex-b1ms")!.bicepDeployment;
  const context = createExtensionRequestContext(proposalInput, proposalScan, proposalInventory, catalog, { support: proposalSupport });
  const result = validateExtensionProposal(f.raw, context);
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.errors.join(" ")).toContain("postgres-deployment-mapping-required");
  const limited = structuredClone(proposalCatalog);
  const mapping = limited.components.find(c => c.id === "postgres-flex-storage")!.bicepDeployment!;
  if (mapping.kind !== "postgres-flex-storage") throw Error("fixture");
  mapping.storageSizesGB = [64];
  const restricted = createExtensionRequestContext(proposalInput, proposalScan, proposalInventory, limited, { support: proposalSupport });
  expect(validateExtensionProposal(f.raw, restricted).ok).toBe(false);
});

it.each([undefined, 0, -1, 1.5, 1001, "1"])("rejects current generation with invalid instanceCount %s", instanceCount => {
  reject(raw => { Object.assign(raw.plans[0].newItems[0], { instanceCount }); });
});
it.each([0.5, 2])("requires count-priced quantity %s to match explicit cardinality", quantity => {
  reject(raw => { Object.assign(raw.plans[0].newItems[0], { quantity, instanceCount: 1 }); });
});
it.each([1, 2])("allows total metered usage across %s explicitly counted hosts", instanceCount => {
  const f = fixture();
  for (const plan of f.raw.plans) {
    plan.reusedResources = []; plan.usageIncreases = []; plan.subnetProposals = [];
    plan.newItems = [{ componentId: "key-vault-operations", quantity: 10, instanceCount }];
  }
  const result = validateExtensionProposal(f.raw, f.context);
  expect(result.ok).toBe(true);
  if (result.ok) expect(result.value.plans.map(p => p.newItems)).toEqual(f.raw.plans.map(p => p.newItems));
});
it("requires zero hosts for a billing-only meter and rejects phantom deployments", () => {
  const f = fixture();
  for (const plan of f.raw.plans) {
    plan.reusedResources = []; plan.usageIncreases = []; plan.subnetProposals = [];
    plan.newItems = [{ componentId: "internet-egress", quantity: 100, instanceCount: 0 }];
  }
  expect(validateExtensionProposal(f.raw, f.context).ok).toBe(true);
  f.raw.plans[0].newItems[0].instanceCount = 1;
  expect(validateExtensionProposal(f.raw, f.context).ok).toBe(false);
});
it("rejects zero metered hosts and client/model attempts to select historical replay", () => {
  const f = fixture();
  const plan = f.raw.plans[0];
  plan.reusedResources = []; plan.usageIncreases = []; plan.subnetProposals = [];
  plan.newItems = [{componentId: "log-analytics-ingestion", quantity: 100, instanceCount: 0}];
  expect(validateExtensionProposal(f.raw, f.context).ok).toBe(false);
  for (const field of ["historical", "historicalRead", "mode"]) {
    const g = fixture(); delete g.raw.plans[0].newItems[0].instanceCount;
    Object.assign(g.raw, {[field]: true});
    expect(validateExtensionProposal(g.raw, g.context).ok).toBe(false);
  }
});
it.each(["missing-storage", "orphan-storage", "competing-sku", "count-mismatch", "fractional-gb", "below-minimum"])("rejects PostgreSQL billing gap: %s", kind => {
  const f = fixture(), plan = f.raw.plans[0];
  plan.subnetProposals = [];
  plan.newItems = [{ componentId: "postgres-flex-b1ms", quantity: 2, instanceCount: 2 },
    { componentId: "postgres-flex-storage", quantity: 64, instanceCount: 2 }];
  if (kind === "missing-storage") plan.newItems.pop();
  if (kind === "orphan-storage") plan.newItems.shift();
  if (kind === "competing-sku") plan.newItems.push({ componentId: "postgres-flex-b2s", quantity: 2, instanceCount: 2 });
  if (kind === "count-mismatch") plan.newItems[1].instanceCount = 1;
  if (kind === "fractional-gb") plan.newItems[1].quantity = 65;
  if (kind === "below-minimum") plan.newItems[1].quantity = 32;
  expect(validateExtensionProposal(f.raw, f.context).ok).toBe(false);
});
it("accepts paired PostgreSQL compute and aggregate integral storage across ordinary instances", () => {
  const f = fixture();
  for (const plan of f.raw.plans) {
    plan.newItems = [{ componentId: "postgres-flex-gp-2vcore", quantity: 2, instanceCount: 2 },
      { componentId: "postgres-flex-storage", quantity: 128, instanceCount: 2 }];
    plan.subnetProposals = [];
  }
  expect(validateExtensionProposal(f.raw, f.context).ok).toBe(true);
});
it("uses the saved catalog storage minimum rather than a runtime price or hardcoded capacity", () => {
  const f = fixture(), catalog = structuredClone(proposalCatalog);
  catalog.components.find(c => c.id === "postgres-flex-storage")!.usage!.defaultQuantity = 64;
  const context = createExtensionRequestContext(proposalInput, proposalScan, proposalInventory, catalog, { support: proposalSupport });
  for (const plan of f.raw.plans) {
    plan.newItems = [{ componentId: "postgres-flex-b1ms", quantity: 1, instanceCount: 1 },
      { componentId: "postgres-flex-storage", quantity: 32, instanceCount: 1 }];
    plan.subnetProposals = [];
  }
  expect(validateExtensionProposal(f.raw, context).ok).toBe(false);
});
describe("Extend proposal request validation", () => {
  it("resolves three plans locally to the phase21 saved proposal without mutating request/output", () => {
    const { raw, context } = fixture(); const before = structuredClone(raw);
    const result = validateExtensionProposal(raw, context);
    expect(result).toEqual({ ok: true, value: savedProposal });
    expect(extensionProposalSchema.safeParse(savedProposal).success).toBe(true);
    expect(raw).toEqual(before);
  });
  it.each(["r999999", "r1", "/subscriptions/foreign/resource", savedProposal.plans[0].reusedResources[0].resourceId])("rejects unknown/direct reference %s", id => {
    reject(raw => { raw.plans[0].reusedResources[0].resourceId = id; });
    reject(raw => { raw.plans[0].usageIncreases[0].resourceId = id; });
    reject(raw => { const p = raw.plans[0].subnetProposals[0].parent; if (p.kind === "existing") p.resourceId = id; });
  });
  it("rejects aliases outside selected mapping and forged mappings to foreign resources", () => {
    const { raw } = fixture();
    const context = createExtensionRequestContext(proposalInput, proposalScan, proposalInventory, proposalCatalog,
      { support: proposalSupport, relevantResourceIds: [proposalInventory.resources[0].id] });
    expect(validateExtensionProposal(raw, context).ok).toBe(false);
    const complete = fixture();
    (complete.context.model.aliasToResourceId as Map<string, string>).set(raw.plans[0].reusedResources[0].resourceId, `${proposalInventory.resources[0].id}-foreign`);
    expect(validateExtensionProposal(raw, complete.context).ok).toBe(false);
  });
  it.each(["unknown-component", "microsoft.compute/virtualmachines"])("rejects non-catalog component %s", id => {
    reject(raw => { raw.plans[0].newItems[0].componentId = id; });
    reject(raw => { raw.plans[0].reusedResources[0].componentId = id; });
    reject(raw => { raw.plans[0].usageIncreases[0].componentId = id; });
  });
  it("rejects absent reference architecture, wrong tier/order/version and model computed fields", () => {
    reject(raw => { raw.plans[0].referenceArchitectureId = "invented-architecture"; });
    reject(raw => { raw.plans.reverse(); });
    reject(raw => { raw.plans[0].tier = "ha"; });
    reject(raw => { Object.assign(raw, { schemaVersion: 2 }); });
    for (const key of ["checks", "verdict", "amount", "unitPrice", "sources", "catalogVersion", "reusePolicyVersion", "resourceType"]) {
      reject(raw => { Object.assign(raw.plans[0], { [key]: "invented" }); });
    }
  });
  it("recomputes eligibility from saved SKU/Linux/region and never trusts the model reason", () => {
    for (const patch of [{ sku: { name: "B1" } }, { properties: { reserved: false } }, { location: "westus2" }]) {
      const inventory = structuredClone(proposalInventory); Object.assign(inventory.resources[1], patch);
      const context = createExtensionRequestContext(proposalInput, proposalScan, inventory, proposalCatalog, { support: proposalSupport });
      const { raw } = fixture();
      expect(validateExtensionProposal(raw, context).ok).toBe(false);
    }
    reject(raw => { raw.plans[0].reusedResources[1].componentId = "app-service-linux-b1"; });
  });
  it("requires exact usage/reuse pair, retained metered increments and no base re-billing", () => {
    reject(raw => { raw.plans[0].usageIncreases[0].componentId = "log-analytics-ingestion"; });
    reject(raw => { raw.plans[0].usageIncreases = []; });
    reject(raw => { raw.plans[0].usageIncreases.push({ ...raw.plans[0].reusedResources[1], quantity: 1 }); });
    reject(raw => { raw.plans[0].newItems.push({ componentId: "app-service-linux-p1v3", quantity: 1, instanceCount: 1 }); });
    reject(raw => { raw.plans[0].newItems.push({ componentId: "key-vault-operations", quantity: 10, instanceCount: 1 }); });
  });
  it.each(["reusedResources", "usageIncreases", "newItems", "subnetProposals"] as const)("rejects duplicate %s", key => {
    reject(raw => { const array = raw.plans[0][key]; array.push(structuredClone(array[0]) as never); });
  });
  it.each([0, -1, NaN, Infinity, "1"])("rejects invalid quantity %s", quantity => {
    reject(raw => { Object.assign(raw.plans[0].newItems[0], { quantity }); });
    reject(raw => { Object.assign(raw.plans[0].usageIncreases[0], { quantity }); });
  });
  it("requires structured network identities, exact counts and real parent/subnet component types", () => {
    reject(raw => { raw.plans[0].newItems[1].quantity = 2; });
    reject(raw => { raw.plans[0].newItems[1].quantity = 0.5; });
    reject(raw => { raw.plans[2].newItems[2].quantity = 2; });
    reject(raw => { raw.plans[0].subnetProposals = []; });
    reject(raw => { raw.plans[0].newItems.push({ componentId: "virtual-network", quantity: 1, instanceCount: 1 }); });
    reject(raw => { const p = raw.plans[2].subnetProposals[0].parent; if (p.kind === "new") Reflect.deleteProperty(p, "addressPrefixes"); });
    reject(raw => { raw.plans[0].subnetProposals[0].componentId = "postgres-flex-b1ms"; });
    reject(raw => { const p = raw.plans[2].subnetProposals[0].parent; if (p.kind === "new") p.componentId = "postgres-flex-b1ms"; });
    reject(raw => { const p = raw.plans[0].subnetProposals[0].parent; if (p.kind === "existing") p.resourceId = raw.plans[0].reusedResources[1].resourceId; });
  });
  it("allows multiple explicitly counted subnets sharing one consistent new parent", () => {
    const { raw, context } = fixture(); const plan = raw.plans[2];
    plan.subnetProposals.push({ ...structuredClone(plan.subnetProposals[0]), id: "second-subnet", addressPrefixes: ["10.2.2.0/24"] });
    plan.newItems[1].quantity = 2; plan.newItems[1].instanceCount = 2;
    expect(validateExtensionProposal(raw, context).ok).toBe(true);
    const p = plan.subnetProposals[1].parent;
    if (p.kind === "new") p.addressPrefixes = ["10.3.0.0/16"];
    expect(validateExtensionProposal(raw, context).ok).toBe(false);
  });
  it("supports new-only and metered-usage-only plans without synthetic reuse", () => {
    const { raw, context } = fixture();
    for (const plan of raw.plans) {
      plan.reusedResources = []; plan.usageIncreases = []; plan.subnetProposals = [];
      plan.newItems = [{ componentId: plan.tier === "ha" ? "postgres-flex-gp-2vcore" : "postgres-flex-b1ms", quantity: plan.tier === "ha" ? 2 : 1, instanceCount: plan.tier === "ha" ? 2 : 1 }, { componentId: "postgres-flex-storage", quantity: plan.tier === "ha" ? 64 : 32, instanceCount: plan.tier === "ha" ? 2 : 1 }];
    }
    expect(validateExtensionProposal(raw, context).ok).toBe(true);
    const onlyUsage = fixture();
    for (const plan of onlyUsage.raw.plans) { plan.newItems = []; plan.subnetProposals = []; }
    expect(validateExtensionProposal(onlyUsage.raw, onlyUsage.context).ok).toBe(true);
    onlyUsage.raw.plans[0].usageIncreases = [];
    expect(validateExtensionProposal(onlyUsage.raw, onlyUsage.context).ok).toBe(false);
  });
  it("rejects absent policy and invalid catalog data, keeping a private snapshot of source input", () => {
    const support = structuredClone(proposalSupport); support.reusePolicies = support.reusePolicies.filter(p => p.id !== "reuse-linux-app-service-plan");
    const context = createExtensionRequestContext(proposalInput, proposalScan, proposalInventory, proposalCatalog, { support });
    expect(validateExtensionProposal(fixture().raw, context).ok).toBe(false);
    const inventory = structuredClone(proposalInventory);
    const saved = createExtensionRequestContext(proposalInput, proposalScan, inventory, proposalCatalog, { support: proposalSupport });
    inventory.resources[1].properties.reserved = false;
    expect(validateExtensionProposal(fixture().raw, saved).ok).toBe(true);
    for (const privateValue of [proposalScan.id, "sample-vnet", "10.1.0.0", "P1v3", "aliasToResourceId"]) expect(JSON.stringify(saved)).not.toContain(privateValue);
    const catalog = structuredClone(proposalCatalog); catalog.components.push(catalog.components[0]);
    expect(() => createExtensionRequestContext(proposalInput, proposalScan, proposalInventory, catalog, { support: proposalSupport })).toThrow("validation-failed");
  });
  it("rejects inconsistent parent identities/regions, unselected parents, and missing ranges", () => {
    const { raw, context } = fixture(); const plan = raw.plans[2];
    plan.newItems[1].quantity = 2; plan.newItems[1].instanceCount = 2;
    plan.subnetProposals.push({ ...structuredClone(plan.subnetProposals[0]), id: "other-subnet", region: "westus2" });
    expect(validateExtensionProposal(raw, context).ok).toBe(false);
    reject(raw => { raw.plans[0].reusedResources.shift(); });
    reject(raw => { const p = raw.plans[2].subnetProposals[0].parent; if (p.kind === "new") p.id = "workload-subnet"; });
    for (const ranges of [[], ["10.2.0.1/16"], ["fd00::1/48"], ["10.2.0.0"], ["invalid"]]) {
      reject(raw => { const p = raw.plans[2].subnetProposals[0].parent; if (p.kind === "new") p.addressPrefixes = ranges; });
    }
  });
  it("binds request owner and scan, validates catalogs without exposing private input in errors", () => {
    for (const input of [{ ...proposalInput, workspaceId: "00000000-0000-4000-8000-000000000099" }, { ...proposalInput, sourceScanId: "00000000-0000-4000-8000-000000000099" }]) {
      expect(() => createExtensionRequestContext(input, proposalScan, proposalInventory, proposalCatalog, { support: proposalSupport })).toThrow("validation-failed");
    }
    const support = structuredClone(proposalSupport); support.schemaVersion = 2 as 1;
    expect(() => createExtensionRequestContext(proposalInput, proposalScan, proposalInventory, proposalCatalog, { support })).toThrow("validation-failed");
    const { raw, context } = fixture(); raw.plans[0].reusedResources[0].resourceId = proposalInventory.resources[0].id;
    expect(JSON.stringify(validateExtensionProposal(raw, context))).not.toContain(proposalInventory.resources[0].id);
  });
  it.each(["", " ", "English 한글", "https://evil.example", "WWW.evil.example", "ftp://evil.example", "//evil.example/path", "CA$100", "100 Canadian dollars", "Microsoft.Compute/virtualMachines", "Use Azure OpenAI", "Add Azure AI Search", "Use Azure Kubernetes Service", "Use Amazon S3", "Use made-up-component", "Use static-web-apps-free"])("rejects unsafe/ungrounded prose %s", text => {
    reject(raw => { raw.plans[0].pros[0].en = text; });
  });
  it("checks every bilingual field, shared length tolerance, nested text and service references", () => {
    reject(raw => { raw.recommendationReason.ko = "https://evil.example"; });
    reject(raw => { raw.plans[0].reusedResources[0].reason.ko = "Azure OpenAI를 추가합니다."; });
    reject(raw => { raw.requestTitle.en = "a ".repeat(50) + "a"; });
    const { raw, context } = fixture(); raw.requestTitle.en = "a ".repeat(49) + "an";
    expect(validateExtensionProposal(raw, context).ok).toBe(true);
    raw.plans[0].pros[0].en = "Reuse app-service-linux-p1v3 and add postgres-flex-b1ms.";
    expect(validateExtensionProposal(raw, context).ok).toBe(true);
    raw.plans[0].newItems.push({ componentId: "managed-redis-b0", quantity: 1, instanceCount: 1 });
    raw.plans[0].pros[0].en = "Add managed-redis-b0.";
    expect(validateExtensionProposal(raw, context).ok).toBe(true);
  });
});

const proseFields = ["requestTitle", "recommendationReason", "title", "pros", "reason"] as const;
function proseField(raw: ReturnType<typeof fixture>["raw"], field: typeof proseFields[number]) {
  return field === "requestTitle" || field === "recommendationReason" ? raw[field]
    : field === "title" ? raw.plans[0].title : field === "pros" ? raw.plans[0].pros[0] : raw.plans[0].reusedResources[0].reason;
}
describe("positive policy at every generated prose field", () => {
  for (const field of proseFields) for (const locale of ["en", "ko"] as const) {
    it.each(unsafeClaimsAndLiterals)(`rejects current-only claims/literals in ${field}.${locale}: %j`, text => {
      const f = fixture(); proseField(f.raw, field)[locale] = text[locale];
      const result = validateExtensionProposal(f.raw, f.context);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors.some(error => error.endsWith(`${locale}: unsafe-text-or-service-reference`))).toBe(true);
    });
    it.each(ordinaryNumbers)(`preserves ordinary quantities/steps/versions/selected-ID digits in ${field}.${locale}: %j`, text => {
      const f = fixture(); proseField(f.raw, field)[locale] = text[locale];
      expect(validateExtensionProposal(f.raw, f.context).ok).toBe(true);
    });
  }
  for (const field of proseFields) for (const locale of ["en", "ko"] as const) {
    const probes = locale === "en" ? ["snowflake", "DaTaDoG", "ＳＮＯＷＦＬＡＫＥ", "snоwflake", "zyrquolix"]
      : ["스노우플레이크", "데이터독", "데이터도그", "snowflake", "ｄａｔａｄｏｇ", "snоwflake", "지르쿼릭스"];
    it.each(probes)(`rejects ${field}.${locale} foreign service %s`, word => {
      const f = fixture();
      proseField(f.raw, field)[locale] = locale === "en" ? `Use ${word} for monitoring.` : `${word}를 사용합니다.`;
      const result = validateExtensionProposal(f.raw, f.context);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors.some(error => error.includes(`${field === "reason" ? "reason" : field}.${locale}: unsafe-text-or-service-reference`)
          || field === "pros" && error.includes(`pros.0.${locale}: unsafe-text-or-service-reference`))).toBe(true);
        expect(JSON.stringify(result)).not.toContain(word);
      }
    });
  }
  it.each(["requestTitle", "recommendationReason", "title", "pros", "reason"] as const)("keeps exact selected references with punctuation and Korean particles in %s", field => {
    const f = fixture(), text = proseField(f.raw, field);
    text.en = "Reuse (virtual-network); review recovery.";
    text.ko = "virtual-network를 재사용하고 복구 절차를 검토합니다.";
    expect(validateExtensionProposal(f.raw, f.context).ok).toBe(true);
  });
  for (const field of proseFields) it.each([
    {en: "Cost is ＄１２.", ko: "비용은 ＄１２입니다."},
    {en: "Cost is $１２.", ko: "비용은 $１２입니다."},
    {en: "Cost is ＄\u200b１２.", ko: "비용은 ＄\u200b１２입니다."},
    {en: "Cost is €12.", ko: "비용은 €12입니다."},
    {en: "Cost is £12.", ko: "비용은 £12입니다."},
    {en: "Cost is ¥12.", ko: "비용은 ¥12입니다."},
    {en: "Use re\u0000covery for monitoring.", ko: "복구를 확\u200b인합니다."},
    {en: "Use Ａｚｕｒｅ for monitoring.", ko: "Ａｚｕｒｅ를 사용합니다."},
    {en: "Use ｒ０００００１.", ko: "ｒ０００００１를 사용합니다."},
    {en: "Read ｈｔｔｐｓ：／／ｅｘａｍｐｌｅ．ｃｏｍ.", ko: "ｈｔｔｐｓ：／／ｅｘａｍｐｌｅ．ｃｏｍ을 확인합니다."},
    {en: "Use ｖｉｒｔｕａｌ－ｎｅｔｗｏｒｋ－ｓｕｂｎｅｔ.", ko: "ｖｉｒｔｕａｌ－ｎｅｔｗｏｒｋ－ｓｕｂｎｅｔ를 사용합니다."},
  ])(`rejects Unicode normalization bypasses in ${field}: %j`, text => {
    const f = fixture();
    // This catalog ID is deliberately unselected in every plan, including the
    // union used for shared titles/reasons. Retain otherwise valid structure.
    for (const plan of f.raw.plans) {
      plan.newItems = plan.newItems.filter(item => !item.componentId.startsWith("virtual-network"));
      plan.subnetProposals = [];
    }
    const target = proseField(f.raw, field); Object.assign(target, text);
    expect(validateExtensionProposal(f.raw, f.context).ok).toBe(false);
  });
  it("preserves ordinary multiline whitespace in useful advice", () => {
    const f = fixture();
    f.raw.plans[0].pros[0] = {en: "Review recovery.\nRecord results.\tCheck logs.", ko: "복구를 검토합니다.\n결과를 기록합니다.\t로그를 확인합니다."};
    expect(validateExtensionProposal(f.raw, f.context).ok).toBe(true);
  });
  it.each(["historicalRead", "textPolicy", "mode", "publicTerms", "proseLanguage"])("does not accept a model %s text-policy override", field => {
    const f = fixture(); f.raw.recommendationReason.en = "Use snowflake for monitoring.";
    Object.assign(f.raw, {[field]: "historical"});
    expect(validateExtensionProposal(f.raw, f.context).ok).toBe(false);
  });
  it("does not turn requirement/inventory tokens into permitted service vocabulary", () => {
    const inventory = structuredClone(proposalInventory);
    inventory.resources[0].tags = { advice: "snowflake zyrquolix" };
    const context = createExtensionRequestContext({...proposalInput, description: "Use snowflake zyrquolix for monitoring."}, proposalScan, inventory, proposalCatalog, {support: proposalSupport});
    const f = fixture(); f.raw.recommendationReason.en = "Use snowflake for monitoring.";
    expect(validateExtensionProposal(f.raw, context).ok).toBe(false);
  });
});

it.each(["Add a self-service portal", "Expand the web-app workload", "Reuse the network-related configuration", "Host an ASP.NET workload", "Host a .NET workload"])("accepts ordinary workload prose: %s", text=>{
 const f=fixture();f.raw.plans[0].pros[0].en=text;
 expect(validateExtensionProposal(f.raw,f.context).ok).toBe(true);
});
it.each(["쿠버네티스를 추가합니다.","애저 오픈AI를 추가합니다.","서비스 버스를 추가합니다."])("rejects ungrounded Korean service references: %s",text=>{
 reject(raw=>{raw.plans[0].pros[0].ko=text;});
});
it.each(["Read ASP.NET/docs", "Read https://ASP.NET", "Read example.com"])("keeps real URL detection: %s",text=>{
 reject(raw=>{raw.plans[0].pros[0].en=text;});
});

it.each(["region","containment","overlap"])("rejects new-network-only %s with an actionable field path",kind=>{
 const f=fixture();f.raw.plans[0]=structuredClone(f.raw.plans[2]);f.raw.plans[0].tier="low";
 f.raw.plans[0].reusedResources=[];f.raw.plans[0].usageIncreases=[];
 expect(validateExtensionProposal(f.raw,f.context).ok).toBe(true);
 const plan=f.raw.plans[0],subnet=plan.subnetProposals[0];
 if(kind === "region") subnet.region="westus2";
 if(kind === "containment") subnet.addressPrefixes=["10.99.0.0/24"];
 if(kind === "overlap") {
  plan.subnetProposals.push({...structuredClone(subnet),id:"second-subnet"});
  Object.assign(plan.newItems.find(i=>i.componentId === subnet.componentId)!, {quantity: 2, instanceCount: 2});
 }
 const value=validateExtensionProposal(f.raw,f.context);
 expect(value.ok).toBe(false);
 if(!value.ok) expect(value.errors.join(" ")).toMatch(/plans\.0\.subnetProposals\.\d.*(?:region-mismatch|outside-new-parent|proposed-subnet-overlap)/);
});

it("returns a specific parent-overlap error for two all-new VNet parents",()=>{
 const f=fixture();f.raw.plans[0]=structuredClone(f.raw.plans[2]);f.raw.plans[0].tier="low";
 const plan=f.raw.plans[0];plan.reusedResources=[];plan.usageIncreases=[];
 const subnet=structuredClone(plan.subnetProposals[0]);subnet.id="second-subnet";subnet.addressPrefixes=["10.2.2.0/24"];
 if(subnet.parent.kind !== "new") throw Error("fixture");subnet.parent.id="second-vnet";
 plan.subnetProposals.push(subnet);
 for(const item of plan.newItems) if(item.componentId.startsWith("virtual-network")) Object.assign(item, {quantity: 2, instanceCount: 2});
 const value=validateExtensionProposal(f.raw,f.context);
 expect(value.ok).toBe(false);
 if(!value.ok) expect(value.errors).toContain("plans.0.subnetProposals.1.parent.addressPrefixes: proposed-parent-overlap");
});
