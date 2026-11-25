import { expect, it } from "vitest";
import { inventoryRows, networkRows, assessmentRows } from "./adapters";
import { resource, ids } from "@/lib/inventory/fixtures.test-data";
import { assessment, networkDiagnostic } from "@/lib/completion/fixtures.test-data";
it("projects inventory metadata without serializing properties, tags or secrets", () => {
 const r = resource(ids.vm, { password: "do-not-project" });
 const rows = inventoryRows([r]);
 expect(rows[0].values).toMatchObject({ name: r.name, type: r.type, group: r.resourceGroup, region: r.location });
 expect(JSON.stringify(rows)).not.toContain("do-not-project"); expect(rows[0].values).not.toHaveProperty("properties");
});
it("derives finding region/type/group only from the saved ARM resource id", () => {
 const rows = assessmentRows(assessment.local.findings, {}, {});
 expect(rows).toHaveLength(assessment.local.findings.length);
 expect(rows.every(r => r.values.region === undefined)).toBe(true);
 expect(rows[0].values).toHaveProperty("verdict");
});
it("retains path and hop indexes without inventing hops for unknown empty paths", () => {
 const result = structuredClone(networkDiagnostic); result.engine.paths = [{ verdict: "unknown", reasonCodes: [], hops: [] }];
 expect(networkRows(result.engine.paths)).toEqual([]);
 result.engine.paths = [{ verdict: "unknown", reasonCodes: [], hops: [{ resourceId: "r", hopType: "route_table", verdict: "unknown", reasonCodes: [], evidence: [] }] }];
 expect(networkRows(result.engine.paths)[0].values).toMatchObject({ path: 1, hop: 1, verdict: "unknown", resource: "r" });
});
