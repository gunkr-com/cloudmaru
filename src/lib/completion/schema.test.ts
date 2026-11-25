// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  actualCostRowSchema, actualCostSchema, advisorResultSchema, assessmentResultSchema, codeFindingSchema,
  componentSchema, coverageSchema, evidenceSchema, extensionArtifactRequestSchema,
  extensionArtifactSchema, extensionInputSchema, extensionProposalSchema,
  extensionResultSchema, networkDiagnosticSchema, networkReasonCodeSchema, reasonCodeSchema, scanDiffSchema, sourceScanSchema, subnetProposalSchema,
} from "./schema";
import { z } from "zod";
import legacyEvidence from "@/lib/extend/legacy-evidence.test-data.json";
import type { NetworkDiagnostic, NetworkReasonCode } from "@/types/network-diagnostics";
import { parseScanInventory, parseScanRow } from "@/lib/scans/rows";
import {
  actualCost, advisor, assessment, completeSnapshot, partialSnapshot, legacySnapshot,
  diff, extension, extensionArtifacts, extensionProposal, findings, networkDiagnostic,
  coverage, ids, resourceIds, subnetExtensionProposal,
} from "./fixtures.test-data";

describe("completion v1 contracts", () => {
  it("keeps optional cardinality in saved V1 without defaults or transforms", () => {
    const old = structuredClone(legacyEvidence.result);
    expect(extensionResultSchema.parse(old)).toEqual(old);
    const modern = structuredClone(old);
    Object.assign(modern.plans[0].newItems[0], {instanceCount: 2});
    expect(extensionResultSchema.parse(modern)).toEqual(modern);
    Object.assign(modern.plans[0].newItems[0], {instanceCount: 0});
    expect(extensionResultSchema.parse(modern)).toEqual(modern);
    for (const instanceCount of [-1, 1.5, 1001, "1"]) {
      Object.assign(modern.plans[0].newItems[0], {instanceCount});
      expect(extensionResultSchema.safeParse(modern).success).toBe(false);
    }
  });
  it("accepts Azure subscription and Advisor type GUIDs independently of locally generated UUIDs", () => {
    const subscription = "01234567-89ab-cdef-0123-456789abcdef";
    const cost = JSON.parse(JSON.stringify(actualCost).replaceAll(ids.subscription, subscription));
    expect(actualCostSchema.safeParse(cost).success).toBe(true);
    const mapped = { ...advisor, recommendations: advisor.recommendations.map(recommendation => ({
      ...recommendation, recommendationTypeId: subscription,
    })) };
    expect(advisorResultSchema.safeParse(mapped).success).toBe(true);
    expect(sourceScanSchema.safeParse({ ...completeSnapshot.sourceScan, id: subscription }).success).toBe(false);
    expect(sourceScanSchema.safeParse({ ...completeSnapshot.sourceScan, subscriptionIds: ["invalid-guid"] }).success).toBe(false);
    expect(sourceScanSchema.safeParse({ ...completeSnapshot.sourceScan, subscriptionIds: [subscription, subscription] }).success).toBe(false);
  });
  it("accepts ARM evidence for legal interior spaces and rejects controls, query and fragment syntax", () => {
    const id = `/subscriptions/${ids.subscription}/resourcegroups/rg-synthetic/providers/microsoft.insights/metricalerts/cpu high alert`;
    const evidence = { ...findings[0].evidence[0], resourceId: id };
    expect(evidenceSchema.safeParse(evidence).success).toBe(true);
    for (const suffix of ["\nsecret", "\tsecret", "\u007fsecret", "?secret", "#secret", "\\secret"]) {
      expect(evidenceSchema.safeParse({ ...evidence, resourceId: id + suffix }).success).toBe(false);
    }
  });
  it("rejects host bits in proposed subnet CIDRs while accepting exact IPv4 and IPv6 boundaries", () => {
    const subnet = subnetExtensionProposal.plans[0].subnetProposals[0];
    for (const cidr of ["10.40.2.5/24", "2001:db8::1/64", "10.0.0.1/0", "::1/0"]) {
      expect(subnetProposalSchema.safeParse({ ...subnet, addressPrefixes: [cidr] }).success).toBe(false);
    }
    for (const cidr of ["10.40.2.0/24", "2001:db8::/64", "0.0.0.0/0", "::/0", "10.0.0.1/32", "::1/128"]) {
      expect(subnetProposalSchema.safeParse({ ...subnet, addressPrefixes: [cidr] }).success).toBe(true);
    }
  });
  it("round trips substantive synthetic results without truncating inventory or findings", () => {
    expect(completeSnapshot.inventory.resources.length).toBeGreaterThanOrEqual(25);
    expect(new Set(completeSnapshot.inventory.resources.map(r => r.id)).size)
      .toBe(completeSnapshot.inventory.resources.length);
    expect(assessment.local.findings.length).toBeGreaterThan(20);
    const cases: [z.ZodType, unknown][] = [
      [sourceScanSchema, completeSnapshot.sourceScan], [sourceScanSchema, partialSnapshot.sourceScan],
      [sourceScanSchema, legacySnapshot.sourceScan], [assessmentResultSchema, assessment],
      [scanDiffSchema, diff], [advisorResultSchema, advisor], [actualCostSchema, actualCost],
      [networkDiagnosticSchema, networkDiagnostic], [extensionProposalSchema, extensionProposal],
      [extensionProposalSchema, subnetExtensionProposal],
      [extensionResultSchema, extension], ...extensionArtifacts.map(value => [extensionArtifactSchema, value] as [z.ZodType, unknown]),
    ];
    for (const [schema, value] of cases) {
      expect(schema.parse(JSON.parse(JSON.stringify(value)))).toEqual(value);
    }
  });

  it("keeps existing scan readers compatible with partial and legacy fixtures", () => {
    for (const snapshot of [completeSnapshot, partialSnapshot, legacySnapshot]) {
      expect(parseScanInventory(snapshot.inventory)).toEqual(snapshot.inventory);
      const r = snapshot.record;
      expect(parseScanRow({ id: r.id, workspace_id: r.workspaceId, status: r.status, source: r.source,
        subscription_ids: r.subscriptionIds, summary: r.summary, collected_at: r.collectedAt,
        created_at: r.createdAt, completed_at: r.completedAt, error_code: r.errorCode }).summary).toEqual(r.summary);
    }
    expect(legacySnapshot.record.summary).not.toHaveProperty("resourceGroupCount");
    expect(legacySnapshot.sourceScan.completeness.state).toBe("unknown");
    expect(partialSnapshot.inventory.skippedRows).toBeGreaterThan(0);
    expect(findings[0].evidence[0]).toMatchObject({ propertyPath: "/properties/addressSpace",
      observation: { state: "present", value: { addressPrefixes: ["10.40.0.0/16"] } } });
  });

  it("accounts for every excluded item once with coded reasons", () => {
    expect(coverageSchema.parse(coverage)).toEqual(coverage);
    for (const value of [
      { ...coverage, total: 40 }, { ...coverage, included: -1 }, { ...coverage, excluded: 0.5 },
      { ...coverage, reasons: [] }, { ...coverage, included: Infinity },
      { total: 2, included: 0, excluded: 2, reasons: [{ code: "missing-data", count: 1 }, { code: "missing-data", count: 1 }] },
      { total: 0, included: 0, excluded: 0, reasons: [{ code: "made-up", count: 0 }] },
    ]) expect(coverageSchema.safeParse(value).success).toBe(false);
  });

  it("makes component absence, partial success, permission denial and failure distinct", () => {
    const schema = componentSchema(z.strictObject({ count: z.number().int().nonnegative() }));
    for (const value of [
      { state: "not-requested" }, { state: "available", data: { count: 0 } },
      { state: "partial", data: { count: 3 }, reasons: ["forbidden"] },
      { state: "unavailable", reason: "forbidden" }, { state: "failed", reason: "timeout" },
    ]) expect(schema.safeParse(value).success).toBe(true);
    for (const value of [
      { state: "available" }, { state: "partial", data: { count: 0 }, reasons: [] },
      { state: "failed", data: { count: 0 }, reason: "timeout" },
      { state: "not-requested", reason: "forbidden" }, { state: "unavailable", reason: "raw API message" },
    ]) expect(schema.safeParse(value).success).toBe(false);
  });

  it("retains local verdicts when every optional component fails or is unavailable", () => {
    const value = { ...assessment, advisor: { state: "unavailable", reason: "forbidden" },
      actualCost: { schemaVersion: 1, monthToDate: { state: "failed", reason: "timeout" }, trailing30Days: { state: "unavailable", reason: "forbidden" } }, roadmap: { state: "failed", reason: "validation-failed" } };
    expect(assessmentResultSchema.parse(value).local).toEqual(assessment.local);
    expect(assessmentResultSchema.safeParse({ ...value, local: undefined }).success).toBe(false);
    expect(assessmentResultSchema.safeParse({ ...value, local: { ...assessment.local, findings: [findings[0], findings[0]] } }).success).toBe(false);
  });

  it("requires typed evidence and an explicit unknown reason without inventing a verdict", () => {
    for (const finding of findings) expect(codeFindingSchema.safeParse(finding).success).toBe(true);
    for (const value of [
      { ...findings[0], verdict: "fail" }, { ...findings[0], evidence: [] },
      { ...findings[0], ruleId: "https://example.invalid/rule" }, { ...findings[0], severity: "fatal" },
      { ...findings[0], pillar: "made-up" }, { ...findings[0], resourceId: "vm-1" },
      { ...findings[2], reasonCode: null }, { ...findings[0], reasonCode: "missing-data" },
    ]) expect(codeFindingSchema.safeParse(value).success).toBe(false);
    expect(evidenceSchema.safeParse({ ...findings[0].evidence[0], observation: { state: "present", value: NaN } }).success).toBe(false);
    expect(evidenceSchema.safeParse({ ...findings[0].evidence[0], observation: { state: "present", value: new Date() } }).success).toBe(false);
    expect(evidenceSchema.safeParse({ ...findings[0].evidence[0], propertyPath: "" }).success).toBe(false);
    expect(evidenceSchema.safeParse({ ...findings[0].evidence[0], propertyPath: "properties.httpsOnly" }).success).toBe(false);
    expect(evidenceSchema.safeParse({ ...findings[0].evidence[0], propertyPath: "/properties/bad~escape" }).success).toBe(false);
  });

  it("validates versions, timestamps, successful scan binding and workspace ownership", () => {
    for (const value of [
      { ...assessment, schemaVersion: 2 }, { ...assessment, id: "not-a-uuid" },
      { ...assessment, createdAt: "2026-99-99" }, { ...assessment, createdAt: "2020-01-01T00:00:00Z" },
      { ...assessment, workspaceId: ids.otherWorkspace }, { ...assessment, sourceScanId: ids.oldScan },
      { ...assessment, sourceScan: { ...assessment.sourceScan, status: "pending" } },
      { ...assessment, unexpected: true },
    ]) expect(assessmentResultSchema.safeParse(value).success).toBe(false);
  });

  it("checks diff counts, property changes and incomplete collection safety", () => {
    for (const value of [
      { ...diff, counts: { ...diff.counts, added: 99 } },
      { ...diff, comparisonScan: { ...diff.comparisonScan, workspaceId: ids.otherWorkspace } },
      { ...diff, comparisonScan: partialSnapshot.sourceScan },
      { ...diff, changes: [...diff.changes, diff.changes[0]] },
      { ...diff, baselineScan: diff.comparisonScan },
      { ...diff, coverage: { total: 0, included: 0, excluded: 0, reasons: [] } },
    ]) expect(scanDiffSchema.safeParse(value).success).toBe(false);
    const changed = diff.changes.find(c => c.kind === "changed")!;
    expect(scanDiffSchema.safeParse({ ...diff, changes: diff.changes.map(c => c === changed ? { ...c, properties: [] } : c) }).success).toBe(false);
  });

  it("tracks Advisor mapping exclusions and rejects raw recommendation copy", () => {
    expect(advisor.coverage.excluded).toBeGreaterThan(0);
    expect(advisorResultSchema.safeParse({ ...advisor, recommendations: [] }).success).toBe(false);
    expect(advisorResultSchema.safeParse({ ...advisor, recommendations: [{ ...advisor.recommendations[0], url: "https://example.invalid" }] }).success).toBe(false);
  });

  it("preserves actual zero and separate original currencies with ordered periods", () => {
    expect(actualCost.totals.map(t => t.currency)).toEqual(["CAD", "USD"]);
    for (const value of [
      { ...actualCost, period: { ...actualCost.period, from: actualCost.period.to, to: actualCost.period.from } },
      { ...actualCost, retrievedAt: "yesterday" },
      { ...actualCost, totals: [{ ...actualCost.totals[0], amount: Infinity }] },
      { ...actualCost, totals: [actualCost.totals[0], actualCost.totals[0]] },
    ]) expect(actualCostSchema.safeParse(value).success).toBe(false);
  });

  it("preserves signed actual adjustments and independent cost windows, distinguishing no data from zero", () => {
    const credit = { ...actualCost, rows: [{ ...actualCost.rows[0], amount: -12.34 }],
      totals: [{ ...actualCost.totals[0], amount: -12.34 }] };
    expect(actualCostSchema.parse(credit)).toEqual(credit);
    const pair = { schemaVersion: 1, monthToDate: { state: "available", data: credit },
      trailing30Days: { state: "unavailable", reason: "no-data" } };
    expect(assessmentResultSchema.parse({ ...assessment, actualCost: pair }).actualCost).toEqual(pair);
    expect(assessmentResultSchema.safeParse({ ...assessment, actualCost: { ...pair, trailing30Days: undefined } }).success).toBe(false);
    expect(assessmentResultSchema.safeParse({ ...assessment, actualCost: { ...pair, extra: true } }).success).toBe(false);
    const trailing = { ...actualCost, period: { ...actualCost.period, preset: "trailing30-days" } };
    const mixed = { schemaVersion: 1, monthToDate: { state: "failed", reason: "timeout" },
      trailing30Days: { state: "available", data: trailing } };
    expect(assessmentResultSchema.parse({ ...assessment, actualCost: mixed }).actualCost).toEqual(mixed);
    expect(assessmentResultSchema.safeParse({ ...assessment, actualCost: { ...pair, monthToDate: { state: "available", data: trailing } } }).success).toBe(false);
    expect(actualCostSchema.safeParse({ ...actualCost, totals: [] }).success).toBe(false);
    const incomplete = { ...actualCost, scope: { ...actualCost.scope, paginationComplete: false } };
    expect(assessmentResultSchema.safeParse({ ...assessment, actualCost: { ...pair, monthToDate: { state: "available", data: incomplete } } }).success).toBe(false);
    expect(assessmentResultSchema.safeParse({ ...assessment, actualCost: { ...pair, monthToDate: { state: "partial", data: incomplete, reasons: ["collection-partial"] } } }).success).toBe(true);
    expect(assessmentResultSchema.safeParse({ ...assessment, actualCost: { ...pair, monthToDate: { state: "partial", data: actualCost, reasons: ["collection-partial"] } } }).success).toBe(false);
    expect(actualCostSchema.safeParse({ ...actualCost, scope: { ...actualCost.scope, requestedSubscriptionIds: [ids.subscription] } }).success).toBe(false);
    expect(actualCostSchema.safeParse({ ...actualCost, period: { ...actualCost.period, preset: "custom" } }).success).toBe(false);
  });

  it("retains every signed charge including deleted, missing and invalid resource IDs", () => {
    const row = { subscriptionId: ids.subscription, currency: "CAD", amount: -1.25,
      attribution: { kind: "resource", resourceId: resourceIds.vm } };
    expect(actualCostRowSchema.parse(row)).toEqual(row);
    for (const invalid of ["arbitrary private name", "https://example.invalid", "", resourceIds.vm.replace("/vm-synthetic", "/../vm")]) {
      expect(actualCostRowSchema.parse({ ...row, attribution: { kind: "resource", resourceId: invalid } }))
        .toEqual({ ...row, attribution: { kind: "unattributed", resourceId: null, reason: "invalid-resource-id" } });
    }
    const deletedId = resourceIds.vm.replace("vm-synthetic", "vm-deleted");
    const rows = [row,
      { ...row, amount: 2, attribution: { kind: "unattributed", resourceId: deletedId, reason: "outside-inventory" } },
      { ...row, amount: 0, attribution: { kind: "unattributed", resourceId: null, reason: "missing-resource-id" } },
      { ...row, amount: 3, attribution: { kind: "resource", resourceId: "invalid private ID" } },
    ];
    const value = { ...actualCost, rows, totals: [{ currency: "CAD", amount: 3.75, subscriptionIds: [ids.subscription] }] };
    const parsed = actualCostSchema.parse(value);
    expect(parsed.rows).toHaveLength(4);
    expect(parsed.rows.map(r => r.amount)).toEqual([-1.25, 2, 0, 3]);
    expect(parsed.totals[0].amount).toBe(parsed.rows.reduce((sum, r) => sum + r.amount, 0));
    expect(JSON.stringify(parsed)).not.toContain("private");
    expect(actualCostSchema.parse(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed);
  });

  it("rejects dropped rows, mismatched currency totals/scope and raw charge copy at every depth", () => {
    const row = actualCost.rows[0];
    for (const value of [
      { ...actualCost, rows: undefined }, { ...actualCost, rows: [] },
      { ...actualCost, rows: actualCost.rows.slice(1) },
      { ...actualCost, totals: actualCost.totals.map(t => ({ ...t, amount: t.amount + 1 })) },
      { ...actualCost, totals: actualCost.totals.slice(0, 1) },
      { ...actualCost, totals: [{ ...actualCost.totals[0], subscriptionIds: [ids.otherSubscription] }, actualCost.totals[1]] },
      { ...actualCost, rows: [{ ...row, subscriptionId: ids.workspace }, ...actualCost.rows.slice(1)] },
      { ...actualCost, rows: [{ ...row, currency: "EUR" }, ...actualCost.rows.slice(1)] },
      { ...actualCost, rows: [{ ...row, description: "private charge description" }, ...actualCost.rows.slice(1)] },
    ]) expect(actualCostSchema.safeParse(value).success).toBe(false);
    for (const patch of [
      { amount: NaN }, { amount: Infinity }, { currency: "cad" },
      { attribution: { kind: "resource", resourceId: resourceIds.vm, name: "private name" } },
      { attribution: { kind: "unattributed", resourceId: null, reason: "outside-inventory" } },
      { attribution: { kind: "unattributed", resourceId: resourceIds.vm, reason: "missing-resource-id" } },
      { attribution: { kind: "unattributed", resourceId: null, reason: "arbitrary" } },
      { subscriptionId: ids.otherSubscription, attribution: { kind: "resource", resourceId: resourceIds.vm } },
    ]) expect(actualCostRowSchema.safeParse({ ...row, ...patch }).success).toBe(false);
    const zero = { ...actualCost, rows: [row], totals: [actualCost.totals[0]] };
    expect(actualCostSchema.parse(zero).rows[0].amount).toBe(0);
    expect(actualCostSchema.safeParse({ ...zero, rows: [], totals: [] }).success).toBe(false);
  });

  it("requires structured subnet proposals with valid syntax, unique local IDs and internal parents", () => {
    const plan = extensionProposal.plans[0];
    const subnet = { id: "apps-subnet", componentId: "synthetic-subnet", region: "canadacentral",
      parent: { kind: "existing", resourceId: plan.reusedResources[0].resourceId }, addressPrefixes: ["10.40.2.0/24", "2001:db8::/64"] };
    const withSubnet = { ...plan, newItems: [...plan.newItems, { componentId: "synthetic-subnet", quantity: 1 }], subnetProposals: [subnet] };
    const parse = (p: unknown) => extensionProposalSchema.safeParse({ ...extensionProposal, plans: [p, ...extensionProposal.plans.slice(1)] }).success;
    expect(parse(withSubnet)).toBe(true);
    for (const patch of [
      { id: "Bad ID" }, { addressPrefixes: [] }, { addressPrefixes: ["10.0.0.0/33"] },
      { addressPrefixes: ["2001:db8::/129"] }, { addressPrefixes: ["not-a-cidr"] },
      { addressPrefixes: ["10.0.0.0/24", "10.0.0.0/24"] }, { componentId: "missing" },
      { parent: { kind: "existing", resourceId: findings[1].resourceId } },
      { parent: { kind: "existing", resourceId: "/subscriptions/00000000-0000-4000-8000-00000000a001/resourcegroups/rg/providers/microsoft.web/sites/app" } },
      { parent: { kind: "new", id: "new-vnet", componentId: "missing" } }, { unexpected: true },
    ]) expect(parse({ ...withSubnet, subnetProposals: [{ ...subnet, ...patch }] })).toBe(false);
    expect(parse({ ...withSubnet, subnetProposals: [subnet, subnet] })).toBe(false);
    expect(parse({ ...plan, subnetProposals: undefined })).toBe(false);
    const newParent = { kind: "new", id: "new-vnet", componentId: "synthetic-new-vnet", addressPrefixes: ["10.40.0.0/16", "2001:db8::/48"] };
    const newPlan = { ...withSubnet, newItems: [...withSubnet.newItems, { componentId: "synthetic-new-vnet", quantity: 1 }],
      subnetProposals: [{ ...subnet, parent: newParent }] };
    expect(parse(newPlan)).toBe(true);
    for (const addressPrefixes of [undefined, [], ["10.40.0.1/16"], ["2001:db8::1/48"], ["10.40.0.0/33"], ["10.40.0.0/16", "10.40.0.0/16"]]) {
      expect(parse({ ...newPlan, subnetProposals: [{ ...subnet, parent: { ...newParent, addressPrefixes } }] })).toBe(false);
    }
    const sibling = { ...subnet, id: "other-subnet", addressPrefixes: ["10.40.3.0/24"], parent: newParent };
    expect(parse({ ...newPlan, subnetProposals: [...newPlan.subnetProposals, sibling] })).toBe(true);
    expect(parse({ ...newPlan, subnetProposals: [...newPlan.subnetProposals, { ...sibling, parent: { ...newParent, addressPrefixes: ["10.50.0.0/16"] } }] })).toBe(false);
    expect(parse({ ...newPlan, subnetProposals: [...newPlan.subnetProposals, { ...sibling, region: "westus2" }] })).toBe(false);
    expect(parse({ ...newPlan, subnetProposals: [...newPlan.subnetProposals, { ...sibling, parent: { ...newParent, addressPrefixes: [...newParent.addressPrefixes].reverse() } }] })).toBe(true);
    expect(parse({ ...newPlan, subnetProposals: [...newPlan.subnetProposals, { ...subnet, id: "other-subnet", parent: { ...newParent, componentId: "synthetic-compute" } }] })).toBe(false);
  });

  it("accepts precise network evidence codes at engine/path/hop level without widening failure reasons", () => {
    const codes: NetworkReasonCode[] = [
      "endpoint-not-in-scan", "no-path-in-scan", "peer-vnet-not-in-scan", "peering-not-connected",
      "peering-one-way", "peering-access-disabled", "transitive-peering-requires-forwarder",
      "private-link-connection-not-approved", "endpoint-address-unresolved", "endpoint-address-mismatch",
      "address-family-mismatch", "query-field-unspecified", "single-candidate", "external-source-unsupported",
      "nsg-rule-decisive-allow", "nsg-rule-decisive-deny", "nsg-not-attached", "nsg-association-not-collected",
      "nsg-association-mismatch", "nsg-reference-missing", "nsg-rules-not-collected", "nsg-rule-malformed",
      "nsg-rule-priority-invalid", "nsg-rule-priority-duplicate", "nsg-rule-precedence-ambiguous",
      "asg-membership-unresolved", "service-tag-unsupported", "service-tag-approximate",
      "virtual-network-scope-incomplete", "nsg-not-applied-private-endpoint-policy",
      "route-selected-user", "route-selected-system", "route-table-not-attached", "route-table-reference-missing",
      "route-table-routes-not-collected", "route-table-empty-system-routes", "route-malformed", "route-blackhole",
      "route-next-hop-virtual-appliance", "route-next-hop-gateway", "route-next-hop-unsupported",
      "route-destination-unspecified", "route-destination-partial-overlap", "effective-routes-not-collected",
    ];
    const path = networkDiagnostic.engine.paths[0];
    for (const code of [...reasonCodeSchema.options, ...codes]) {
      expect(networkReasonCodeSchema.parse(code)).toBe(code);
      const value = { ...networkDiagnostic, engine: { ...networkDiagnostic.engine, reasonCodes: [code],
        paths: [{ ...path, reasonCodes: [code], hops: [{ ...path.hops[0], reasonCodes: [code] }] }] } };
      expect(networkDiagnosticSchema.parse(value)).toEqual(value);
    }
    const component = componentSchema(z.string());
    for (const reason of codes) {
      expect(reasonCodeSchema.safeParse(reason).success).toBe(false);
      for (const state of ["failed", "unavailable"]) {
        expect(component.safeParse({ state, reason }).success).toBe(false);
      }
      expect(component.safeParse({ state: "partial", data: "data", reasons: [reason] }).success).toBe(false);
      expect(extensionResultSchema.safeParse({ ...extension, plans: extension.plans.map(p => ({ ...p,
        checks: [{ ...p.checks[0], reasonCodes: [reason] }],
      })) }).success).toBe(false);
    }
    for (const code of ["arbitrary-code", "nsg_rule_decisive_allow", "", "NSG-rule-decisive-allow"]) {
      expect(networkReasonCodeSchema.safeParse(code).success).toBe(false);
      for (const level of ["engine", "path", "hop"]) {
        const value: NetworkDiagnostic = structuredClone(networkDiagnostic);
        if (level === "engine") value.engine.reasonCodes = [code as NetworkReasonCode];
        else if (level === "path") value.engine.paths[0].reasonCodes = [code as NetworkReasonCode];
        else value.engine.paths[0].hops[0].reasonCodes = [code as NetworkReasonCode];
        expect(networkDiagnosticSchema.safeParse(value).success).toBe(false);
      }
    }
    const allowed = { ...networkDiagnostic, engine: { ...networkDiagnostic.engine, verdict: "allowed",
      reasonCodes: ["single-candidate"], paths: [{ ...path, verdict: "allowed", reasonCodes: ["route-selected-system"],
        hops: [{ ...path.hops[0], verdict: "allowed", reasonCodes: ["nsg-rule-decisive-allow"] }] }] } };
    expect(networkDiagnosticSchema.parse(allowed)).toEqual(allowed);
    const duplicate = { ...allowed, engine: { ...allowed.engine, reasonCodes: ["single-candidate", "single-candidate"] } };
    expect(networkDiagnosticSchema.safeParse(duplicate).success).toBe(false);
  });

  it("binds network query, engine endpoints and scan while retaining unknown evidence", () => {
    for (const value of [
      { ...networkDiagnostic, query: { ...networkDiagnostic.query, sourceScanId: ids.oldScan } },
      { ...networkDiagnostic, engine: { ...networkDiagnostic.engine, destinationResourceId: findings[0].resourceId } },
      { ...networkDiagnostic, query: { ...networkDiagnostic.query, destinationPort: 65536 } },
      { ...networkDiagnostic, query: { ...networkDiagnostic.query, protocol: "icmp", destinationPort: 443 } },
      { ...networkDiagnostic, engine: { ...networkDiagnostic.engine, verdict: "allowed", paths: [] } },
    ]) expect(networkDiagnosticSchema.safeParse(value).success).toBe(false);
    const path = networkDiagnostic.engine.paths[0];
    expect(networkDiagnosticSchema.safeParse({ ...networkDiagnostic, engine: { ...networkDiagnostic.engine,
      verdict: "allowed", reasonCodes: [], paths: [{ ...path, verdict: "allowed", reasonCodes: [] }] } }).success).toBe(false);
  });

  it("rejects nested extra fields, URL text, dangling roadmap references and invalid observations", () => {
    expect(assessmentResultSchema.safeParse({ ...assessment, roadmap: { state: "available", data: {
      schemaVersion: 1, generatedAt: assessment.createdAt, summary: { en: "Synthetic", ko: "합성" },
      phases: [{ id: "first", title: { en: "Synthetic", ko: "합성" }, findingIds: [ids.extension], actions: [{ en: "Review", ko: "확인" }] }],
    } } }).success).toBe(false);
    expect(extensionProposalSchema.safeParse({ ...extensionProposal,
      requestTitle: { ...extensionProposal.requestTitle, extra: true } }).success).toBe(false);
    expect(extensionProposalSchema.safeParse({ ...extensionProposal,
      requestTitle: { en: "Read https://example.invalid", ko: "확인" } }).success).toBe(false);
    for (const value of [undefined, () => 1, BigInt(1), { nested: Infinity }]) {
      expect(evidenceSchema.safeParse({ ...findings[0].evidence[0], observation: { state: "present", value } }).success).toBe(false);
    }
  });

  it("reuses Build input validation and requires exactly three different tiers", () => {
    expect(extensionInputSchema.safeParse(extension.input).success).toBe(true);
    for (const value of [
      { ...extension.input, monthlyBudget: 9 }, { ...extension.input, sourceScanId: "bad" },
      { ...extension.input, description: "short" }, { ...extension.input, newField: true },
    ]) expect(extensionInputSchema.safeParse(value).success).toBe(false);
    for (const value of [
      { ...extensionProposal, plans: extensionProposal.plans.slice(1) },
      { ...extensionProposal, plans: [extensionProposal.plans[0], extensionProposal.plans[0], extensionProposal.plans[2]] },
      { ...extensionProposal, plans: extensionProposal.plans.map(p => ({ ...p, total: 1 })) },
    ]) expect(extensionProposalSchema.safeParse(value).success).toBe(false);
  });

  it("requires positive finite quantities and cost lines matching only incremental items", () => {
    for (const quantity of [-1, 0, NaN, Infinity]) {
      const plans = extension.plans.map(p => ({ ...p, newItems: [{ ...p.newItems[0], quantity }] }));
      expect(extensionResultSchema.safeParse({ ...extension, plans }).success).toBe(false);
    }
    const plan = extension.plans[0];
    for (const data of [
      { ...plan.incrementalCost.data, total: 999 },
      { ...plan.incrementalCost.data, lines: [] },
      { ...plan.incrementalCost.data, lines: [{ ...plan.incrementalCost.data.lines[0], amount: -1 }] },
      { ...plan.incrementalCost.data, lines: [{ ...plan.incrementalCost.data.lines[0], resourceId: findings[0].resourceId }] },
    ]) {
      expect(extensionResultSchema.safeParse({ ...extension, plans: [{ ...plan, incrementalCost: { state: "available", data } }, ...extension.plans.slice(1)] }).success).toBe(false);
    }
  });

  it("prices explicit usage increases, partial estimates and genuine zero without charging reuse", () => {
    const plans = extension.plans.map(p => ({ ...p,
      usageIncreases: [{ resourceId: p.reusedResources[0].resourceId, componentId: "synthetic-vnet", quantity: 2 }],
      incrementalCost: { state: "available", data: { ...p.incrementalCost.data,
        lines: [...p.incrementalCost.data.lines, { kind: "usage-increase", resourceId: p.reusedResources[0].resourceId,
          componentId: "synthetic-vnet", quantity: 2, amount: 0 }] } },
    }));
    expect(extensionResultSchema.safeParse({ ...extension, plans }).success).toBe(true);
    expect(extensionResultSchema.safeParse({ ...extension, plans: plans.map((p, i) => ({ ...p,
      incrementalCost: { state: "partial", reasons: ["price-unavailable"], data: extension.plans[i].incrementalCost.data },
    })) }).success).toBe(true);
    expect(extensionResultSchema.safeParse({ ...extension, plans: extension.plans.map(p => ({ ...p,
      incrementalCost: { state: "partial", reasons: ["price-unavailable"], data: { ...p.incrementalCost.data, lines: [], total: 0 } },
    })) }).success).toBe(false);
    expect(extensionResultSchema.safeParse({ ...extension, plans: plans.map(p => ({ ...p,
      reusedResources: [],
    })) }).success).toBe(false);
  });

  it("ties guide, five-pillar evaluation and Bicep contracts to saved extension and tier", () => {
    for (const kind of ["guide", "evaluation", "bicep"]) {
      expect(extensionArtifactRequestSchema.safeParse({ schemaVersion: 1, extensionId: ids.extension, tier: "balanced", kind }).success).toBe(true);
    }
    expect(extensionArtifactRequestSchema.safeParse({ extensionId: ids.extension, tier: "bad", kind: "guide" }).success).toBe(false);
    for (const artifact of extensionArtifacts) {
      expect(extensionArtifactSchema.safeParse({ ...artifact, extensionId: "bad" }).success).toBe(false);
      expect(extensionArtifactSchema.safeParse({ ...artifact, content: {} }).success).toBe(false);
    }
    const bicep = extensionArtifacts[2];
    expect(extensionArtifactSchema.safeParse({ ...bicep, content: { ...bicep.content, unverifiedDraft: false } }).success).toBe(false);
    expect(extensionArtifactSchema.safeParse({ ...bicep, content: { ...bicep.content,
      parameters: [{ name: "vnetName", description: { en: "VNet name", ko: "VNet 이름" } }] } }).success).toBe(true);
    expect(extensionArtifactSchema.safeParse({ ...bicep, content: { ...bicep.content,
      code: "// https://example.invalid" } }).success).toBe(false);
  });
});
it('preserves the closed persisted compiler-environment reason without admitting diagnostics',()=>{
 expect(reasonCodeSchema.parse('compiler-unavailable')).toBe('compiler-unavailable');
 expect(reasonCodeSchema.safeParse('compiler-version: /private/company').success).toBe(false);
});
