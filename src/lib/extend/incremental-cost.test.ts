import { describe, expect, it } from "vitest";
import { calculatePlanCost } from "@/lib/cost/calculate";
import { componentSchema, extensionPlanSchema, incrementalCostSchema } from "@/lib/completion/schema";
import { calculateExtensionIncrementalCost } from "./incremental-cost";
import { proposalCatalog, proposalSupport, savedProposal } from "./proposal.test-data";

function fixture() {
  return structuredClone({ plan: savedProposal.plans[0], catalog: proposalCatalog, support: proposalSupport });
}
function run(f = fixture(), region = "canadacentral") {
  return calculateExtensionIncrementalCost(f.plan, f.catalog, { support: f.support, region });
}
const costSchema = componentSchema(incrementalCostSchema);

it.each(["key-vault-operations", "log-analytics-ingestion"])("bills total %s usage once regardless of instanceCount", componentId => {
  const f = fixture();
  f.plan.reusedResources = []; f.plan.usageIncreases = []; f.plan.subnetProposals = [];
  f.plan.newItems = [{ componentId, quantity: 10, instanceCount: 1 }];
  const before = run(f);
  f.plan.newItems[0].instanceCount = 2;
  expect(run(f)).toEqual(before);
  expect(before).toMatchObject({ state: "available", data: { lines: [{ quantity: 10 }] } });
  expect(JSON.stringify(before)).not.toContain("instanceCount");
});

describe("Extend incremental cost", () => {
  it("bills only new and increased quantities from the synthetic CAD snapshot", () => {
    const f = fixture();
    const cost = run(f);
    expect(cost).toEqual({ state: "available", data: {
      currency: "CAD", priceAsOf: "2026-01-15", total: 47.1,
      lines: [
        { kind: "new", componentId: "postgres-flex-b1ms", resourceId: null, quantity: 1, amount: 29.2 },
        { kind: "new", componentId: "postgres-flex-storage", resourceId: null, quantity: 32, amount: 6.4 },
        { kind: "new", componentId: "virtual-network-subnet", resourceId: null, quantity: 1, amount: 0 },
        { kind: "usage-increase", componentId: "key-vault-operations", resourceId: f.plan.usageIncreases[0].resourceId, quantity: 10, amount: 1.5 },
        { kind: "usage-increase", componentId: "log-analytics-ingestion", resourceId: f.plan.usageIncreases[1].resourceId, quantity: 5, amount: 10 },
      ],
    } });
    expect(JSON.stringify(cost)).not.toContain("app-service-linux-p1v3");
    expect(costSchema.safeParse(cost).success).toBe(true);
    expect(extensionPlanSchema.safeParse({ ...f.plan, incrementalCost: cost, checks: [{
      kind: "capacity", verdict: "unknown", reasonCodes: ["capacity-unverified"], resourceIds: [], componentIds: [], evidence: [],
    }] }).success).toBe(true);
  });

  it("bills new compute using catalog quantity-to-meter units", () => {
    const f = fixture(); f.plan.reusedResources = []; f.plan.usageIncreases = []; f.plan.subnetProposals = [];
    f.plan.newItems = [{ componentId: "app-service-linux-p1v3", quantity: 2 }];
    expect(run(f)).toMatchObject({ state: "available", data: { total: 350.4, lines: [{ quantity: 2, amount: 350.4 }] } });
  });

  it("retains a zero line for each truly free new VNet and subnet", () => {
    const f = fixture(); f.plan = structuredClone(savedProposal.plans[2]);
    const cost = run(f);
    if (!("data" in cost)) throw new Error("missing cost");
    expect(cost.data.lines.filter(l => l.componentId.startsWith("virtual-network")))
      .toEqual(["virtual-network", "virtual-network-subnet"].map(componentId => ({ kind: "new", componentId, resourceId: null, quantity: 1, amount: 0 })));
  });

  it("distinguishes an available free-only configuration from missing prices", () => {
    const f = fixture(); f.plan.newItems = f.plan.newItems.filter(i => i.componentId === "virtual-network-subnet"); f.plan.usageIncreases = [];
    expect(run(f)).toEqual({ state: "available", data: { currency: "CAD", priceAsOf: "2026-01-15", total: 0,
      lines: [{ kind: "new", componentId: "virtual-network-subnet", resourceId: null, quantity: 1, amount: 0 }] } });
  });

  it("keeps distinct existing resource increments instead of collapsing component IDs", () => {
    const f = fixture(); const first = f.plan.usageIncreases[0];
    const otherId = first.resourceId.replace("sample-vault", "second-vault");
    f.plan.reusedResources.push({ ...f.plan.reusedResources[2], resourceId: otherId });
    f.plan.usageIncreases.push({ ...first, resourceId: otherId });
    const cost = run(f);
    if (!("data" in cost)) throw new Error("missing cost");
    expect(cost.data.total).toBe(48.6);
    expect(cost.data.lines.filter(l => l.componentId === first.componentId).map(l => l.resourceId))
      .toEqual([first.resourceId, otherId].sort());
  });

  it("sums rounded cents exactly and preserves fractional catalog quantities", () => {
    const f = fixture(); f.plan.newItems = []; f.plan.subnetProposals = [];
    f.plan.usageIncreases[0].quantity = 2.5;
    f.plan.usageIncreases[1].quantity = 0.028;
    expect(run(f)).toMatchObject({ state: "available", data: { total: 0.44, lines: [
      { quantity: 2.5, amount: 0.38 }, { quantity: 0.028, amount: 0.06 },
    ] } });
  });

  it("does not grant existing Log Analytics another free 2 GB, even for a fractional increase", () => {
    const f = fixture(); f.plan.newItems = []; f.plan.subnetProposals = [];
    f.plan.usageIncreases = [{ ...f.plan.usageIncreases[1], quantity: 0.5 }];
    expect(run(f)).toMatchObject({ state: "available", data: { total: 1 } });
  });

  it("does not grant a new workspace another shared free allowance and leaves Build unchanged", () => {
    const f = fixture(); f.plan.reusedResources = []; f.plan.usageIncreases = []; f.plan.subnetProposals = [];
    f.plan.newItems = [{ componentId: "log-analytics-ingestion", quantity: 10 }];
    expect(run(f)).toMatchObject({ state: "available", data: { total: 20 } });
    expect(calculatePlanCost(f.plan.newItems, f.catalog, { region: "canadacentral" }).total).toBe(16);
  });

  it("is deterministic across line, support, component and price ordering without mutation", () => {
    const f = fixture(); const before = structuredClone(f); const cost = run(f);
    expect(f).toEqual(before);
    f.plan.newItems.reverse(); f.plan.usageIncreases.reverse(); f.catalog.components.reverse(); f.support.components.reverse();
    expect(run(f)).toEqual(cost);
  });

  it("returns the exact priced subset and unique reasons when a regional row is missing", () => {
    const f = fixture(); delete f.catalog.prices.prices["postgres-flex-b1ms"].canadacentral;
    const cost = run(f);
    expect(cost).toMatchObject({ state: "partial", reasons: ["price-unavailable"], data: { total: 17.9 } });
    if (!("data" in cost)) throw new Error("missing cost");
    expect(cost.data.lines).toHaveLength(4);
    expect(cost.data.lines.some(l => l.componentId === "postgres-flex-b1ms")).toBe(false);
    expect(costSchema.safeParse(cost).success).toBe(true);
  });

  it("returns unavailable rather than a zero total when all prices are missing", () => {
    const f = fixture(); f.catalog.prices.prices = {}; f.plan.newItems = f.plan.newItems.slice(0, 1); f.plan.subnetProposals = [];
    expect(run(f)).toEqual({ state: "unavailable", reason: "price-unavailable" });
  });

  it.each(["westus2", "centralus"])("uses only the exact %s regional snapshot", region => {
    const f = fixture(); f.plan.newItems = f.plan.newItems.slice(0, 1); f.plan.subnetProposals = []; f.plan.usageIncreases = [];
    expect(run(f, region)).toMatchObject({ state: "available", data: { total: region === "westus2" ? 36.5 : 43.8 } });
    delete f.catalog.prices.prices["postgres-flex-b1ms"][region];
    expect(run(f, region)).toEqual({ state: "unavailable", reason: "price-unavailable" });
  });

  it("does not use a present price for an unknown support pair", () => {
    const f = fixture();
    f.support.components.forEach(c => c.regions.forEach(r => { if (r.regionId === "canadacentral") r.status = "unknown"; }));
    expect(run(f)).toEqual({ state: "unavailable", reason: "unsupported-region" });
  });

  it("retains coded region and price reasons in stable order", () => {
    const f = fixture(); delete f.catalog.prices.prices["postgres-flex-b1ms"].canadacentral;
    f.support.components.find(c => c.componentId === "key-vault-operations")!.regions[0].status = "unknown";
    expect(run(f)).toMatchObject({ state: "partial", reasons: ["unsupported-region", "price-unavailable"] });
  });

  it.each(["canadaeast", "global", "constructor"])("does not fall back for unlisted region %s", region => {
    expect(run(fixture(), region)).toEqual({ state: "unavailable", reason: "unsupported-region" });
  });

  it("requires an explicit global meter mapping while retaining the selected regional snapshot key", () => {
    const f = fixture(); f.plan.reusedResources = []; f.plan.usageIncreases = []; f.plan.subnetProposals = [];
    f.plan.newItems = [{ componentId: "static-web-apps-standard", quantity: 2 }];
    // 합성 지원 승인: 실제 Static Web Apps의 지역 지원은 계속 unknown이다.
    const pair = f.support.components.find(c => c.componentId === "static-web-apps-standard")!.regions[0];
    expect(run(f)).toEqual({ state: "unavailable", reason: "unsupported-region" });
    pair.status = "supported";
    expect(pair.priceRegion).toBe("eastus2");
    expect(run(f)).toMatchObject({ state: "available", data: { total: 20 } });
    pair.priceRegion = "westus2";
    expect(() => run(f)).toThrow("validation-failed");
  });

  it("never switches to a mapping-region row when the selected-region row is absent", () => {
    const f = fixture(); f.plan.reusedResources = []; f.plan.usageIncreases = []; f.plan.subnetProposals = [];
    f.plan.newItems = [{ componentId: "static-web-apps-standard", quantity: 1 }];
    f.support.components.find(c => c.componentId === "static-web-apps-standard")!.regions[0].status = "supported";
    const rows = f.catalog.prices.prices["static-web-apps-standard"];
    rows.eastus2 = rows.canadacentral; delete rows.canadacentral;
    expect(run(f)).toEqual({ state: "unavailable", reason: "price-unavailable" });
  });

  it("rejects a mismatched price unit as unavailable", () => {
    const f = fixture(); f.catalog.prices.prices["postgres-flex-b1ms"].canadacentral.unitOfMeasure = "1 GB";
    expect(run(f)).toMatchObject({ state: "partial", reasons: ["price-unavailable"] });
  });

  it.each([0, -1, NaN, Infinity, -Infinity])("rejects invalid quantities %s before assembling any cost", quantity => {
    const f = fixture(); f.plan.newItems[1].quantity = quantity;
    expect(() => run(f)).toThrow("validation-failed");
  });

  it.each(["units", "amount", "total"])("rejects %s overflow instead of persisting a finite-looking partial cost", mode => {
    const f = fixture();
    if (mode === "units") f.plan.newItems[0].quantity = Number.MAX_VALUE;
    else {
      for (const id of ["postgres-flex-b1ms", "key-vault-operations"]) {
        f.catalog.prices.prices[id].canadacentral.tiers = [{ minUnits: 0, unitPrice: mode === "total"
          ? (id === "postgres-flex-b1ms" ? 5e10 : 6e12) : Number.MAX_VALUE }];
      }
    }
    expect(() => run(f)).toThrow("validation-failed");
  });

  it("rejects a forged quantity or total under the exact W0 plan contract", () => {
    const f = fixture(); const cost = run(f);
    if (!("data" in cost)) throw new Error("missing cost");
    cost.data.lines[0].quantity = 2;
    const checks = [{ kind: "capacity", verdict: "unknown", reasonCodes: ["capacity-unverified"], resourceIds: [], componentIds: [], evidence: [] }];
    expect(extensionPlanSchema.safeParse({ ...f.plan, incrementalCost: cost, checks }).success).toBe(false);
    cost.data.total += 1;
    expect(costSchema.safeParse(cost).success).toBe(false);
  });

  it.each(["currency", "date", "meter", "tiers", "duplicate", "unknown-component", "model-amount"])("rejects malformed %s with a sanitized error", field => {
    const f = fixture();
    if (field === "currency") Object.assign(f.catalog.prices, { currency: "USD" });
    if (field === "date") f.catalog.prices.asOf = "tomorrow";
    if (field === "meter") f.catalog.prices.prices["postgres-flex-b1ms"].canadacentral.meterId = "";
    if (field === "tiers") f.catalog.prices.prices["postgres-flex-b1ms"].canadacentral.tiers.reverse().push({ minUnits: 0, unitPrice: -1 });
    if (field === "duplicate") f.plan.newItems.push(f.plan.newItems[0]);
    if (field === "unknown-component") f.plan.newItems[0].componentId = "unapproved-compute";
    if (field === "model-amount") Object.assign(f.plan.newItems[0], { amount: 1 });
    expect(() => run(f)).toThrow(/^validation-failed$/);
  });
});

  it("does not assume shared metered free grants remain in the existing environment",()=>{
    const f=fixture();f.plan.reusedResources=[];f.plan.usageIncreases=[];f.plan.subnetProposals=[];
    f.plan.newItems=[{componentId:"internet-egress",quantity:25}];
    expect(run(f)).toMatchObject({state:"available",data:{total:2.5}});
    expect(calculatePlanCost(f.plan.newItems,f.catalog,{region:"canadacentral"}).total).toBe(0);
  });
