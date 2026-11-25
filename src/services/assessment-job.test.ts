// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDatabase, insertTestWorkspace } from "@/lib/db/test-db.test-data";
import { completeSnapshot, ids } from "@/lib/completion/fixtures.test-data";
import { evaluateAssessmentRules } from "@/lib/assessment/rules/engine";
import { ASSESSMENT_TIMEOUT_MS } from "@/lib/assessment/app/job";
import { createScansDb } from "./db/scans";
import { createAssessmentsDb } from "./db/assessments";
import { createAssessmentJobServices } from "./assessment-job";

let db: PGlite;
beforeEach(async () => { db = await createTestDatabase(); });
afterEach(async () => { vi.useRealTimers(); await db.close(); vi.restoreAllMocks(); });
async function fixture() {
  const workspaceId = await insertTestWorkspace(db);
  const inventory = structuredClone(completeSnapshot.inventory);
  const sourceScanId = await createScansDb({ db: async () => db }).createImportScan({ workspaceId,
    inventory, summary: completeSnapshot.record.summary!, collectedAt: completeSnapshot.record.collectedAt!, subscriptionIds: [ids.subscription] });
  await db.query("update scans set source='live' where id=$1", [sourceScanId]);
  const store = createAssessmentsDb({ db: async () => db });
  const input = { schemaVersion: 1 as const, workspaceId, sourceScanId, previousScanId: null };
  const reserved = (await store.reserveAssessment(input))!;
  const getToken = vi.fn(async () => "PRIVATE TOKEN");
  const createTokenProvider = vi.fn(() => getToken);
  const settings = vi.fn(async () => ({ connection: { tenantId: ids.subscription, clientId: ids.subscription,
    certificatePath: "/private/test.pem", certificatePasswordEnv: null }, subscriptionIds: [ids.subscription] }));
  const rid = inventory.resources.find(r => r.type === "microsoft.web/sites")!.id;
  const cost = (amount: number, currency: string) => Response.json({ properties: { columns: [
    { name: "Currency", type: "String" }, { name: "ResourceId", type: "String" }, { name: "PreTaxCost", type: "Number" }],
    rows: [[currency, rid, amount]], nextLink: null } });
  const fetch = vi.fn<typeof globalThis.fetch>(async (url, init) => {
    if (String(url).includes("Microsoft.Advisor")) return Response.json({ value: [{
      id: `/subscriptions/${ids.subscription}/providers/microsoft.advisor/recommendations/test`,
      properties: { recommendationTypeId: "cc9d34f5-f9b8-4d4f-9de7-98b45c698a49", resourceMetadata: { resourceId: rid } },
    }, { properties: { recommendationTypeId: ids.subscription } }] });
    return cost(JSON.parse(init!.body as string).timePeriod.from.endsWith("01T00:00:00.000Z") ? -2 : 0, "USD");
  });
  const services = () => createAssessmentJobServices({ db: async () => db, getWorkspaceAzureSettings: settings, createTokenProvider, fetch });
  return { input, inventory, store, reserved, getToken, createTokenProvider, settings, fetch, services, cost };
}

it("wires real storage/rules/phase14 collectors with signed original costs, zero and partial Advisor", async () => {
  const f = await fixture();
  await f.services().runJob(f.reserved.id);
  const saved = (await f.store.getAssessment(f.reserved.id))!;
  expect(saved.status).toBe("succeeded");
  expect(saved.result!.local).toEqual(evaluateAssessmentRules(f.inventory.resources, saved.result!.local.evaluatedAt));
  expect(saved.result!.advisor).toMatchObject({ state: "partial", reasons: expect.any(Array) });
  expect(saved.result!.actualCost.monthToDate).toMatchObject({ state: "available", data: { totals: [{ currency: "USD", amount: -2 }] } });
  expect(saved.result!.actualCost.trailing30Days).toMatchObject({ state: "available", data: { totals: [{ currency: "USD", amount: 0 }] } });
  expect(f.settings).toHaveBeenCalledExactlyOnceWith(f.input.workspaceId);
  expect(f.fetch).toHaveBeenCalledTimes(3);
  expect(saved.result!.sourceScan.collectedAt).not.toBe(saved.result!.local.evaluatedAt);
  expect(JSON.stringify(saved)).not.toContain("PRIVATE TOKEN");
});

it("keeps an independent no-data month, malformed trailing response and local success", async () => {
  const f = await fixture();
  f.fetch.mockImplementation(async (url, init) => String(url).includes("Microsoft.Advisor")
    ? new Response(null, { status: 403 })
    : JSON.parse(init!.body as string).timePeriod.from.endsWith("01T00:00:00.000Z")
      ? new Response(null, { status: 204 }) : Response.json({ private: "malformed" }));
  await f.services().runJob(f.reserved.id);
  const saved = (await f.store.getAssessment(f.reserved.id))!;
  expect(saved.status).toBe("succeeded");
  expect(saved.result!.actualCost.monthToDate).toEqual({ state: "unavailable", reason: "no-data" });
  expect(saved.result!.actualCost.trailing30Days).toEqual({ state: "failed", reason: "invalid-response" });
  expect(saved.result!.advisor).toEqual({ state: "unavailable", reason: "forbidden" });
});

it.each(["fetch", "body", "credential"])("bounds optional %s and ignores late completion while preserving finished periods", async kind => {
  const f = await fixture();
  vi.useFakeTimers();
  let late!: () => void;
  const pending = new Promise<Response>(resolve => { late = () => resolve(f.cost(99, "CAD")); });
  f.fetch.mockImplementation(async (url, init) => {
    if (String(url).includes("Microsoft.Advisor")) return Response.json({ value: [] });
    if (JSON.parse(init!.body as string).timePeriod.from.endsWith("01T00:00:00.000Z")) return f.cost(0, "CAD");
    if (kind === "body") { const response = f.cost(99, "CAD"); response.json = () => pending.then(r => r.json()); return response; }
    return pending;
  });
  if (kind === "credential") f.getToken.mockImplementation(() => pending.then(() => "late private token"));
  const work = f.services().runJob(f.reserved.id);
  // PGlite uses real I/O; wait until transport has actually started before moving the clock.
  await vi.waitFor(() => expect(f.getToken).toHaveBeenCalled(), { interval: 1 });
  await vi.advanceTimersByTimeAsync(ASSESSMENT_TIMEOUT_MS - 1_000);
  await work;
  const saved = (await f.store.getAssessment(f.reserved.id))!;
  expect(saved.status).toBe("succeeded");
  expect(saved.result!.local.findings.length).toBeGreaterThan(0);
  expect(saved.result!.actualCost.trailing30Days).toEqual({ state: "failed", reason: "timeout" });
  if (kind !== "credential") expect(saved.result!.actualCost.monthToDate).toMatchObject({ state: "available", data: { totals: [{ amount: 0 }] } });
  late(); await vi.advanceTimersByTimeAsync(1);
  expect(await f.store.getAssessment(f.reserved.id)).toEqual(saved);
});

it("ends a continuing paginated collection at the job deadline with partial rows and a completed month preserved", async () => {
  const f = await fixture(); vi.useFakeTimers();
  let pages = 0;
  f.fetch.mockImplementation(async (url, init) => {
    if (String(url).includes("Microsoft.Advisor")) return Response.json({ value: [] });
    if (JSON.parse(init!.body as string).timePeriod.from.endsWith("01T00:00:00.000Z")) return f.cost(0, "CAD");
    await new Promise(resolve => setTimeout(resolve, 20_000));
    return Response.json({ properties: { ...(await f.cost(1, "USD").json()).properties,
      nextLink: String(url).split("&")[0] + `&$skiptoken=page-${++pages}` } });
  });
  const work = f.services().runJob(f.reserved.id);
  await vi.waitFor(() => expect(f.fetch).toHaveBeenCalledTimes(3), { interval: 1 });
  await vi.advanceTimersByTimeAsync(ASSESSMENT_TIMEOUT_MS - 1_000);
  await work;
  const saved = (await f.store.getAssessment(f.reserved.id))!;
  expect(saved.result!.advisor.state).toBe("available");
  expect(saved.result!.actualCost.monthToDate).toMatchObject({ state: "available", data: { totals: [{ amount: 0 }] } });
  expect(saved.result!.actualCost.trailing30Days).toMatchObject({ state: "partial", reasons: ["timeout"], data: { totals: [{ currency: "USD", amount: 8 }] } });
  const calls = f.fetch.mock.calls.length;
  await vi.advanceTimersByTimeAsync(30_000);
  expect(await f.store.getAssessment(f.reserved.id)).toEqual(saved);
  expect(f.fetch).toHaveBeenCalledTimes(calls);
});

it("closes reservations when persisted source inventory fails revalidation", async () => {
  const f = await fixture();
  await db.query("update scans set inventory=$2 where id=$1", [f.input.sourceScanId, { resources: [] }]);
  await f.services().runJob(f.reserved.id);
  expect((await db.query("select status,error from assessments where id=$1", [f.reserved.id])).rows[0]).toEqual({
    status: "failed", error: { schemaVersion: 1, code: "internal" },
  });
  expect(f.createTokenProvider).not.toHaveBeenCalled(); expect(f.fetch).not.toHaveBeenCalled();
});
