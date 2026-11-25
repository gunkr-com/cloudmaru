vi.mock("./workspace-secrets", () => ({ readWorkspaceSecret: vi.fn(async () => null) }));
import { roadmapModelFixture } from "@/lib/assessment/roadmap/fixtures.test-data";
// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
const runtime = vi.hoisted(() => ({ db: null as PGlite | null, owner: "", locale: "en" as "en" | "ko", tasks: [] as (() => Promise<void>)[], transport: vi.fn() }));
vi.mock("./db/client", () => ({ getDb: async () => runtime.db! }));
vi.mock("./current-workspace", () => ({ getCurrentWorkspace: async () => ({ id: runtime.owner }) }));
vi.mock("@/i18n/server", async () => {
  const { createTranslator } = await import("@/i18n/translate");
  return { getLocale: async () => runtime.locale, getI18n: async () => ({ locale: runtime.locale, t: createTranslator(runtime.locale) }) };
});
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }), notFound: () => { throw Error("404"); } }));
vi.mock("next/server", () => ({ after: (task: () => Promise<void>) => runtime.tasks.push(task) }));
// 최종 transport만 교체한다. 회사·키 참조는 실제 workspace-claude/DB 래퍼를 거친다.
vi.mock("./claude", async importOriginal => ({ ...await importOriginal<typeof import("./claude")>(), requestStructuredOutput: runtime.transport }));
import { GET as getRoadmap, POST } from "@/app/api/assessments/[id]/roadmap/route";
import { GET as download } from "@/app/api/assessments/[id]/report/route";
import { createTestDatabase, insertTestWorkspace } from "@/lib/db/test-db.test-data";
import { completeSnapshot, partialSnapshot, previousSnapshot } from "@/lib/completion/fixtures.test-data";
import { toCompletionSourceScan } from "@/lib/completion/source-scan";
import { evaluateAssessmentRules } from "@/lib/assessment/rules/engine";
import * as currentEngine from "@/lib/assessment/rules/engine";
import * as currentCatalog from "@/lib/assessment/app/saved-evidence";
import { compareScans } from "@/lib/inventory/diff";
import { summarizeInventory } from "@/lib/inventory/summarize";
import { advisorCatalog } from "@/lib/assessment/advisor-catalog";
import { type RoadmapModelOutput } from "@/lib/assessment/roadmap/model";
import { createScansDb } from "./db/scans";
import { createAssessmentsDb } from "./db/assessments";
import { createAssessmentRoadmapsDb } from "./db/assessment-roadmaps";
import { createWorkspaceClaudeDb } from "./db/workspace-claude";
import { createAssessmentRoadmapServices } from "./assessment-roadmap";
import { createAssessmentReportService } from "./assessment-roadmap-report";
import type { AssessmentResult, ActualCost, AdvisorResult } from "@/types/assessment";
import type { ScanInventory } from "@/types/scan";
import type { StructuredLlmRequest } from "@/types/analysis";
import { jsx } from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nProvider } from "@/i18n/provider";
import Detail from "@/app/(app)/assessments/[id]/page";
import ReportPage from "@/app/(app)/assessments/[id]/report/page";
import * as workspaceClaude from "./workspace-claude";
import * as azure from "./azure/request";
import * as compiler from "./extension-artifact-compiler";

const usage = { promptTokens: 3, completionTokens: 4, costUsd: 0.1 };
const ownerRef = "CLOUDSIGHT_CLAUDE_KEY_ACCEPTANCE", retryRef = "CLOUDSIGHT_CLAUDE_KEY_ACCEPTANCE_RETRY", otherRef = "CLOUDSIGHT_CLAUDE_KEY_ACCEPTANCE_OTHER";
const db = () => runtime.db!;
const deps = { db: async () => db() };
const context = (id: string) => ({ params: Promise.resolve({ id }) });
const post = (id: string, workspaceId = runtime.owner) => POST(new Request(`http://localhost/api/assessments/${id}/roadmap`, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workspaceId }),
}), context(id));
const get = (id: string) => getRoadmap(new Request("http://localhost"), context(id));
function model(request: StructuredLlmRequest): RoadmapModelOutput {
  const payload = JSON.parse(request.user.split("\n")[0]);
  return roadmapModelFixture(payload);
}
async function key(workspaceId: string, apiKeyEnv: string | null) {
  await createWorkspaceClaudeDb(deps).saveWorkspaceClaudeSettings(workspaceId, { apiKeyEnv });
}
async function scan(workspaceId: string, inventory: ScanInventory, collectedAt: string) {
  const scans = createScansDb(deps);
  const pending = await scans.reserveLiveScan({ workspaceId, subscriptionIds: completeSnapshot.record.subscriptionIds, staleBefore: new Date(0) });
  await scans.completeScan(pending.id, { inventory, summary: summarizeInventory(inventory.resources, inventory.containers),
    subscriptionIds: completeSnapshot.record.subscriptionIds, collectedAt });
  return { scan: (await scans.getScan(pending.id))!, inventory };
}
async function seed(options: { noData?: boolean; passOnly?: boolean; insights?: "available" | "partial" | "unavailable" | "failed"; diff?: boolean } = {}) {
  const workspaceId = runtime.owner;
  const inventory = structuredClone(options.diff ? partialSnapshot.inventory : completeSnapshot.inventory);
  if (options.noData) {
    inventory.resources = inventory.resources.filter(r => r.type === (options.passOnly ? "microsoft.web/sites" : "microsoft.hybridcompute/machines"));
    if (options.passOnly) for (const resource of inventory.resources) resource.properties = { httpsOnly: true, siteConfig: { minTlsVersion: "1.2" } };
    expect(inventory.resources.length).toBeGreaterThan(0);
    inventory.relations = [];
  }
  const baseline = options.diff ? await scan(workspaceId, previousSnapshot.inventory, "2026-11-10T10:00:00Z") : null;
  const source = await scan(workspaceId, inventory, "2026-11-11T10:00:00Z");
  const parents = createAssessmentsDb(deps);
  const input = { schemaVersion: 1 as const, workspaceId, sourceScanId: source.scan.id, previousScanId: baseline?.scan.id ?? null };
  const id = (await parents.reserveAssessment(input))!.id;
  const createdAt = (await parents.getAssessment(id))!.createdAt, now = new Date().toISOString();
  const advisor: AdvisorResult = { schemaVersion: 1, retrievedAt: now, mappingVersion: advisorCatalog.version,
    coverage: { total: 0, included: 0, excluded: 0, reasons: [] }, recommendations: [] };
  const cost: ActualCost = { schemaVersion: 1, retrievedAt: now,
    period: { from: "2026-11-01T00:00:00Z", to: "2026-11-12T00:00:00Z", preset: "month-to-date" },
    scope: { kind: "subscriptions", requestedSubscriptionIds: source.scan.subscriptionIds,
      availableSubscriptionIds: source.scan.subscriptionIds, paginationComplete: true },
    rows: source.scan.subscriptionIds.map(subscriptionId => ({ subscriptionId, amount: 0, currency: "CAD", attribution: { kind: "unattributed", resourceId: null, reason: "missing-resource-id" } })),
    totals: [{ currency: "CAD", amount: 0, subscriptionIds: source.scan.subscriptionIds }] };
  const result: AssessmentResult = { schemaVersion: 1, id, workspaceId, sourceScanId: source.scan.id, createdAt,
    sourceScan: toCompletionSourceScan(source.scan, inventory), local: evaluateAssessmentRules(inventory.resources, now),
    advisor: { state: "unavailable", reason: "forbidden" },
    actualCost: { schemaVersion: 1, monthToDate: { state: "unavailable", reason: "no-data" }, trailing30Days: { state: "failed", reason: "timeout" } },
    diff: baseline ? { state: "partial", data: compareScans(baseline, source, now), reasons: ["collection-partial"] } : { state: "not-requested" },
    roadmap: { state: "not-requested" } };
  if (options.insights === "available") {
    result.advisor = { state: "available", data: advisor };
    result.actualCost.monthToDate = { state: "available", data: cost };
    result.actualCost.trailing30Days = { state: "available", data: { ...cost, period: { ...cost.period, preset: "trailing30-days" } } };
  } else if (options.insights === "partial") {
    result.advisor = { state: "partial", data: { ...advisor, coverage: { total: 1, included: 0, excluded: 1, reasons: [{ code: "unmapped-advisor-type", count: 1 }] } }, reasons: ["unmapped-advisor-type"] };
    cost.scope.availableSubscriptionIds = [source.scan.subscriptionIds[0]];
    cost.scope.paginationComplete = false;
    cost.rows = cost.rows.slice(0, 1); cost.totals[0].subscriptionIds = cost.scope.availableSubscriptionIds;
    result.actualCost.monthToDate = { state: "partial", data: cost, reasons: ["forbidden"] };
  } else if (options.insights === "failed") result.advisor = { state: "failed", reason: "timeout" };
  await parents.completeAssessment(id, result);
  return { id, workspaceId, result, parents, source };
}
beforeEach(async () => {
  vi.resetAllMocks(); runtime.tasks = []; runtime.locale = "en";
  runtime.db = await createTestDatabase(); runtime.owner = await insertTestWorkspace(db());
  for (const ref of [ownerRef, retryRef, otherRef]) vi.stubEnv(ref, "synthetic-test-value");
  // 명시적인 fake 전역 키가 있어도 미설정 회사를 대신하지 못한다.
  vi.stubEnv("ANTHROPIC_API_KEY", "synthetic-global-must-not-be-used");
  runtime.transport.mockImplementation(async request => ({ data: model(request), usage }));
});
afterEach(async () => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllEnvs(); await db().close(); runtime.db = null; });

it("composes the actual saved Assess page through no-key, pending, failure, retry and success, with read-only bilingual reports", async () => {
  const f = await seed({ diff: true, insights: "available" });
  const savedLocal = structuredClone((await f.parents.getAssessment(f.id))!.result);
  const markup = (element: React.ReactElement, locale: "en" | "ko") => renderToStaticMarkup(jsx(I18nProvider, { locale, children: element }));
  const detail = async (locale: "en" | "ko") => {
    runtime.locale = locale;
    const html = markup(await Detail(context(f.id)), locale);
    expect(html).toContain(locale === "en" ? "Local checks" : "로컬 점검");
    expect(html).toContain(f.source.scan.id);
    expect(html).toContain(`/assessments/${f.id}/report?lang=${locale}`);
    expect(html).toContain(`/api/assessments/${f.id}/report?format=markdown&amp;lang=${locale}`);
    expect((await f.parents.getAssessment(f.id))!.result).toEqual(savedLocal);
    return html;
  };
  expect(await detail("en")).toContain("Generate roadmap");
  expect((await post(f.id)).status).toBe(409);
  expect((await db().query("select * from assessment_roadmap_attempts")).rows).toHaveLength(0);
  expect(runtime.transport).not.toHaveBeenCalled();
  await key(f.workspaceId, ownerRef);
  await post(f.id);
  expect(await detail("ko")).toContain("로드맵 생성 중");
  const store = createAssessmentRoadmapsDb(deps);
  const attempt = (await store.getAssessmentRoadmap(f.id))!.roadmap.attemptId!;
  await store.failAssessmentRoadmap(f.id, attempt, "timeout", null);
  const failed = await detail("en");
  expect(failed).toContain("Retry roadmap"); expect(failed).toContain("did not finish in time");
  await post(f.id); await runtime.tasks[1]();
  expect((await store.getAssessmentRoadmap(f.id))!.roadmap.status).toBe("succeeded");
  expect(runtime.transport).toHaveBeenCalledTimes(1);
  await key(f.workspaceId, null);
  runtime.owner = await insertTestWorkspace(db());
  await scan(f.workspaceId, completeSnapshot.inventory, new Date().toISOString());
  const hasKey = vi.spyOn(workspaceClaude, "hasCompletionClaudeKey");
  const azureCall = vi.spyOn(azure, "azureRequest").mockRejectedValue(Error("unexpected Azure call"));
  const compilerCheck = vi.spyOn(compiler, "checkExtensionArtifactCompilerAvailability").mockRejectedValue(Error("unexpected compiler check"));
  const compile = vi.spyOn(compiler, "validateExtensionArtifact").mockRejectedValue(Error("unexpected compilation"));
  const engine = vi.spyOn(currentEngine, "evaluateAssessmentRules").mockImplementation(() => { throw Error("NO REPLAY"); });
  const saved = (await db().query("select * from assessments order by id")).rows;
  for (const locale of ["en", "ko"] as const) {
    const html = await detail(locale);
    expect(html).toContain(locale === "en" ? "This assessment belongs to" : "점검은");
    expect(html).not.toContain(locale === "en" ? ">Generate roadmap<" : ">로드맵 생성<");
    const file = await download(new Request(`http://localhost/api/assessments/${f.id}/report?format=markdown&lang=${locale}`), context(f.id));
    expect(file.status).toBe(200); expect(await file.text()).toContain(f.source.scan.id);
    // 보고서 lang은 서로 다른 셸 쿠키/현재 회사와 무관하다.
    runtime.locale = locale === "en" ? "ko" : "en";
    const report = markup(await ReportPage({ ...context(f.id), searchParams: Promise.resolve({ lang: locale }) }), runtime.locale);
    expect(report).toContain(`<article lang="${locale}"`);
    expect(report).toContain(f.source.scan.id);
    expect(report).toContain(locale === "en" ? "Print / save PDF" : "인쇄 / PDF 저장");
  }
  expect((await db().query("select * from assessments order by id")).rows).toEqual(saved);
  expect((await db().query("select * from llm_calls")).rows).toHaveLength(1);
  for (const call of [hasKey, azureCall, compilerCheck, compile, engine]) expect(call).not.toHaveBeenCalled();
  expect(runtime.transport).toHaveBeenCalledTimes(1);
});

it("accepts the real local→no-key→POST/retry→proof→GET/reopen/report/download flow with immutable owner and partial scope", async () => {
  const f = await seed({ diff: true, insights: "partial" });
  expect(f.result.sourceScan.completeness.state).toBe("partial");
  expect(f.result.diff.state).toBe("partial");
  if ("data" in f.result.diff) expect(f.result.diff.data.counts.removed).toBe(0);
  const noKey = await post(f.id);
  expect(noKey.status).toBe(409); expect(await noKey.json()).toEqual({ code: "key-unavailable", workspaceId: f.workspaceId });
  expect((await db().query("select * from assessment_roadmap_attempts")).rows).toHaveLength(0);
  const other = await insertTestWorkspace(db()); await key(other, otherRef); await key(f.workspaceId, ownerRef);
  runtime.owner = other;
  expect((await post(f.id, f.workspaceId)).status).toBe(409);
  runtime.owner = f.workspaceId;
  expect((await post(f.id)).status).toBe(202); expect((await post(f.id)).status).toBe(202); expect(runtime.tasks).toHaveLength(1);
  // 검증 재시도 직전에 다른 탭·소유 회사 설정·새 스캔을 바꾼다.
  runtime.transport.mockImplementationOnce(async request => {
    expect(request.apiKeyEnv).toBe(ownerRef);
    runtime.owner = other; await key(f.workspaceId, retryRef);
    await scan(f.workspaceId, completeSnapshot.inventory, new Date().toISOString());
    return { data: {}, usage };
  });
  await runtime.tasks[0]();
  expect(runtime.transport).toHaveBeenCalledTimes(2);
  expect(runtime.transport.mock.calls[1][0].apiKeyEnv).toBe(retryRef);
  const payload = JSON.parse(runtime.transport.mock.calls[1][0].user.split("\n")[0]);
  expect(payload.coverage.excluded).toBeGreaterThan(0);
  for (const secret of [f.id, f.workspaceId, f.source.scan.id, "/subscriptions/", "synthetic-test-value"])
    expect(JSON.stringify(payload)).not.toContain(secret);
  const response = await get(f.id), status = await response.json();
  expect(status).toMatchObject({ id: f.id, workspaceId: f.workspaceId, sourceScanId: f.source.scan.id, workspaceMismatch: true,
    roadmap: { status: "succeeded", usage: { promptTokens: 6, completionTokens: 8, costUsd: 0.2 } } });
  expect(status).not.toHaveProperty("result"); expect(status).not.toHaveProperty("saved_evidence");
  const proofs = (await db().query<{evidence: {validation: {policyVersion: string}}}>("select evidence from assessment_roadmap_evidence")).rows;
  expect(proofs).toHaveLength(1); expect(JSON.stringify(proofs)).toContain("assessment-roadmap-v3");
  await key(f.workspaceId, null); // 조회·다운로드는 키 없이도 가능하다.
  const replay = vi.spyOn(currentEngine, "evaluateAssessmentRules").mockImplementation(() => { throw Error("NO REPLAY"); });
  const catalog = vi.spyOn(currentCatalog, "currentAssessmentCatalogData").mockImplementation(() => { throw Error("NO CURRENT CATALOG"); });
  const before = (await db().query("select * from assessments order by id")).rows;
  for (const locale of ["en", "ko", "en"] as const) {
    runtime.locale = locale;
    const file = await download(new Request(`http://localhost/api/assessments/${f.id}/report`), context(f.id));
    expect(file.status).toBe(200); expect(file.headers.get("vary")).toBe("Cookie");
    expect(file.headers.get("content-disposition")).toContain(locale === "ko" ? ".ko.md" : `${f.id}.md`);
    const text = await file.text(); expect(text).toContain(f.source.scan.id); expect(text).toContain(locale === "ko" ? "AI가" : "AI&#45;organized");
    expect((await createAssessmentReportService(deps).get(f.id, locale))!.locale).toBe(locale);
    expect((await get(f.id)).status).toBe(200);
  }
  expect((await db().query("select * from assessments order by id")).rows).toEqual(before);
  expect((await db().query("select * from llm_calls")).rows).toHaveLength(1);
  expect((await f.parents.getAssessment(f.id))!.result).toEqual(f.result);
  expect(runtime.transport).toHaveBeenCalledTimes(2); expect(replay).not.toHaveBeenCalled(); expect(catalog).not.toHaveBeenCalled();
});

it.each([false, true])("returns real no-actionable state (pass-only=%s) before key/reservation while preserving the local report", async passOnly => {
  const f = await seed({ noData: true, passOnly });
  expect(f.result.local.findings.every(finding => finding.verdict === "pass")).toBe(true);
  const response = await post(f.id);
  expect(response.status).toBe(409); expect(await response.json()).toEqual({ code: "no-data" });
  expect(await (await get(f.id)).json()).toMatchObject({ availability: "no-data", roadmap: { status: "not-requested" } });
  const page = renderToStaticMarkup(jsx(I18nProvider, { locale: "en", children: await Detail(context(f.id)) }));
  expect(page).toContain("Local checks"); expect(page).toContain("No actionable code findings");
  expect(page).not.toContain(">Generate roadmap<");
  expect(page).toContain(`/assessments/${f.id}/report?lang=en`);
  expect((await download(new Request("http://localhost"), context(f.id))).status).toBe(200);
  expect((await db().query("select * from assessment_roadmap_attempts")).rows).toHaveLength(0);
  expect(runtime.transport).not.toHaveBeenCalled();
});

it.each(["available", "partial", "unavailable", "failed"] as const)("preserves %s optional components across real persistence and EN/KO reports", async insights => {
  const f = await seed({ insights });
  await key(f.workspaceId, ownerRef); expect((await post(f.id)).status).toBe(202); await runtime.tasks[0]();
  const saved = (await f.parents.getAssessment(f.id))!;
  expect(saved.result).toEqual(f.result); expect(saved.roadmap.status).toBe("succeeded");
  for (const locale of ["en", "ko"] as const) {
    const report = await createAssessmentReportService(deps).get(f.id, locale);
    expect(report!.sections.length).toBeGreaterThan(5);
    if (insights === "available") expect(JSON.stringify(report)).toContain("CAD");
  }
});

it.each(["unknown-ids", "provider", "validation"])("closes %s failures with at most one retry and preserves known billing once", async failure => {
  const f = await seed(); await key(f.workspaceId, ownerRef);
  if (failure === "provider") runtime.transport.mockRejectedValue({ usage, message: "PRIVATE provider error" });
  else runtime.transport.mockImplementation(async request => {
    const data = model(request);
    if (failure === "unknown-ids") { data.phases[0].findingAliases = ["f999999"]; data.phases[0].actionAliases = ["a999999"]; }
    else data.summary = { en: "Deploy redis", ko: "레디스를 배포합니다." };
    return { data, usage };
  });
  await post(f.id); await runtime.tasks[0]();
  const saved = (await createAssessmentRoadmapsDb(deps).getAssessmentRoadmap(f.id))!;
  expect(saved.roadmap.status).toBe("failed"); expect(saved.status).toBe("succeeded");
  const calls = failure === "provider" ? 1 : 2;
  expect(runtime.transport).toHaveBeenCalledTimes(calls);
  expect(saved.roadmap.usage).toEqual({ promptTokens: 3 * calls, completionTokens: 4 * calls, costUsd: 0.1 * calls });
  expect((await db().query("select * from llm_calls")).rows).toHaveLength(1);
  expect((await db().query("select * from assessment_roadmap_evidence")).rows).toHaveLength(0);
  const file = await download(new Request("http://localhost"), context(f.id));
  expect(file.status).toBe(200); expect(await file.text()).not.toContain("PRIVATE");
});

it("times out a real job then bills its late aggregate after a new success with zero terminal/proof writes", async () => {
  const f = await seed(); await key(f.workspaceId, ownerRef);
  let resolve!: (value: {data: ReturnType<typeof model>; usage: typeof usage}) => void, entered!: () => void;
  const started = new Promise<void>(done => { entered = done; });
  let request!: StructuredLlmRequest;
  runtime.transport.mockImplementationOnce(input => { request = input; entered(); return new Promise(done => { resolve = done; }); });
  let offset = 0;
  const jobs = createAssessmentRoadmapServices({ ...deps, now: () => new Date(Date.now() + offset) });
  let task!: () => Promise<void>; await jobs.start(f.id, f.workspaceId, f.workspaceId, value => { task = value; });
  const old = (await createAssessmentRoadmapsDb(deps).getAssessmentRoadmap(f.id))!.roadmap.attemptId!;
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const running = task(); await started; offset = 280_001;
  await vi.advanceTimersByTimeAsync(280_001); await running; vi.useRealTimers();
  expect((await createAssessmentRoadmapsDb(deps).getAssessmentRoadmap(f.id))!.roadmap.error?.code).toBe("timeout");
  expect((await db().query("select * from llm_calls")).rows).toHaveLength(0);
  offset = 0; await jobs.start(f.id, f.workspaceId, f.workspaceId, value => { task = value; }); await task();
  const saved = (await createAssessmentRoadmapsDb(deps).getAssessmentRoadmap(f.id))!, proof = (await db().query("select * from assessment_roadmap_evidence")).rows;
  expect(saved.roadmap.attemptId).not.toBe(old); expect(saved.roadmap.status).toBe("succeeded");
  resolve({ data: model(request), usage });
  await vi.waitFor(async () => { expect((await db().query("select * from llm_calls")).rows).toHaveLength(2); });
  const store = createAssessmentRoadmapsDb(deps);
  expect(await store.completeAssessmentRoadmap(f.id, old, {}, usage)).toBe(false);
  expect(await store.failAssessmentRoadmap(f.id, old, "timeout", usage)).toBe(false);
  expect((await store.getAssessmentRoadmap(f.id))!.roadmap).toEqual({ ...saved.roadmap, usage: { promptTokens: 6, completionTokens: 8, costUsd: 0.2 } });
  expect((await db().query("select * from assessment_roadmap_evidence")).rows).toEqual(proof);
  expect(runtime.transport).toHaveBeenCalledTimes(2);
});


it("skips validation retry when fewer than ninety seconds remain and preserves the one known call", async () => {
  const f = await seed(); await key(f.workspaceId, ownerRef);
  let offset = 0;
  const jobs = createAssessmentRoadmapServices({ ...deps, now: () => new Date(Date.now() + offset) });
  runtime.transport.mockImplementationOnce(async () => { offset = 200_000; return { data: {}, usage }; });
  let task!: () => Promise<void>;
  await jobs.start(f.id, f.workspaceId, f.workspaceId, value => { task = value; }); await task();
  const saved = (await createAssessmentRoadmapsDb(deps).getAssessmentRoadmap(f.id))!;
  expect(saved.roadmap).toMatchObject({ status: "failed", error: { code: "validation-failed" }, usage });
  expect(runtime.transport).toHaveBeenCalledTimes(1);
  expect((await db().query("select * from llm_calls")).rows).toHaveLength(1);
});

it("rechecks the actual saved-owner key on retry and blocks fallback after that key is disabled", async () => {
  const f = await seed(); await key(f.workspaceId, ownerRef);
  runtime.transport.mockImplementationOnce(async () => { await key(f.workspaceId, null); return { data: {}, usage }; });
  await post(f.id); await runtime.tasks[0]();
  expect(runtime.transport).toHaveBeenCalledTimes(1);
  const saved = (await createAssessmentRoadmapsDb(deps).getAssessmentRoadmap(f.id))!;
  expect(saved.roadmap).toMatchObject({ status: "failed", usage });
  expect((await db().query("select * from llm_calls")).rows).toHaveLength(1);
  expect((await f.parents.getAssessment(f.id))!.result).toEqual(f.result);
});

it.each([false, true])("retries a one-shot actual billing INSERT failure with the exact final aggregate (late=%s)", async late => {
  const f = await seed(); await key(f.workspaceId, ownerRef);
  let resolve!: (value: { data: ReturnType<typeof model>; usage: typeof usage }) => void;
  let entered!: () => void;
  const started = new Promise<void>(done => { entered = done; });
  let request!: StructuredLlmRequest;
  if (late) runtime.transport.mockImplementationOnce(input => {
    request = input; entered(); return new Promise(done => { resolve = done; });
  });
  await db().exec(`create sequence fail_once;
    create function fail_one_bill() returns trigger language plpgsql as $$ begin
      if nextval('fail_once')=1 then raise exception 'synthetic-billing-failure'; end if; return new;
    end $$;
    create trigger fail_one_bill before insert on llm_calls for each row execute function fail_one_bill();`);
  const jobs = createAssessmentRoadmapServices(deps);
  let task!: () => Promise<void>;
  await jobs.start(f.id, f.workspaceId, f.workspaceId, value => { task = value; });
  const attempt = (await createAssessmentRoadmapsDb(deps).getAssessmentRoadmap(f.id))!.roadmap.attemptId!;
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  if (late) vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  const running = task();
  if (late) {
    await started; await vi.advanceTimersByTimeAsync(281_000); await running; vi.useRealTimers();
    resolve({ data: model(request), usage });
    await vi.waitFor(async () => { expect((await db().query("select * from llm_calls")).rows).toHaveLength(1); });
  } else await running;
  const store = createAssessmentRoadmapsDb(deps), saved = (await store.getAssessmentRoadmap(f.id))!;
  expect(saved.roadmap).toMatchObject({ attemptId: attempt, status: late ? "failed" : "succeeded", usage });
  expect((await db().query("select usage from assessment_roadmap_attempts where assessment_id=$1 and attempt_id=$2", [f.id, attempt])).rows).toEqual([{ usage }]);
  expect((await db().query("select * from llm_calls")).rows).toHaveLength(1);
  await jobs.runJob(f.id, attempt);
  expect((await db().query("select * from llm_calls")).rows).toHaveLength(1);
  expect(JSON.stringify(log.mock.calls)).not.toContain("synthetic-billing-failure");
});
