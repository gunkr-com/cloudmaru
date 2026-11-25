import { quantityClaims, ordinaryNumbers, wrappedMonetaryClaims } from "@/lib/extend/prose-policy.test-data";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { getAllByRole, getByRole } from "@testing-library/dom";
import type { PGlite } from "@electric-sql/pglite";
import type { StructuredLlmRequest } from "@/types/analysis";
import type { ExtensionModelPayload } from "@/types/extend-context";
import type { ExtensionInput, ExtensionProposal } from "@/types/extension";
import type { ScanInventory } from "@/types/scan";

// 메모리 DB 연결·요청 쿠키·Next after·구조화 전송 경계만 대체한다.
// 코어·저장 소유자 키 선택·라우트·서비스·UI는 실제 구현을 사용한다.
const m = vi.hoisted(() => ({ db: vi.fn(), workspace: vi.fn(), after: vi.fn(), provider: vi.fn(), locale: "en" }));
vi.mock("@/services/db/client", () => ({ getDb: m.db }));
vi.mock("@/services/current-workspace", () => ({ getCurrentWorkspace: m.workspace }));
vi.mock("next/server", () => ({ after: m.after }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: m.locale }) }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }), notFound: () => { throw Error("404"); } }));
vi.mock("@/services/claude", async original => ({ ...await original<typeof import("@/services/claude")>(), requestStructuredOutput: m.provider }));
vi.mock("@/services/operator-prices", async () => {
  const { proposalCatalog, proposalSupport } = await import("@/lib/extend/proposal.test-data");
  return { acquireOperatorPrices: async () => ({ ok: true, catalog: proposalCatalog, support: proposalSupport }) };
});
import { ClaudeError } from "@/services/claude";
import { POST, GET } from "@/app/api/extensions/route";
import { GET as detail } from "@/app/api/extensions/[id]/route";
import ResultPage from "@/app/(app)/extensions/[id]/page";
import HistoryPage from "@/app/(app)/extensions/page";
import { I18nProvider } from "@/i18n/provider";
import { createTranslator } from "@/i18n/translate";
import { createTestDatabase, insertTestWorkspace } from "@/lib/db/test-db.test-data";
import { createScansDb } from "@/services/db/scans";
import { createExtensionsDb } from "@/services/db/extensions";
import { extensionResults } from "@/services/extension-job-result";
import { proposalInput, proposalInventory, proposalScan, savedProposal } from "@/lib/extend/proposal.test-data";
import { summarizeInventory } from "@/lib/inventory/summarize";
import * as catalog from "@/lib/catalog/load";
import * as processing from "@/lib/extend/process";

let db: PGlite;
let input: ExtensionInput;
let inventory: ScanInventory;
let store: ReturnType<typeof createExtensionsDb>;
const usage = { promptTokens: 120, completionTokens: 80, costUsd: 0.02 };
const aggregate = { promptTokens: 240, completionTokens: 160, costUsd: 0.04 };
const endpoint = "http://localhost/api/extensions";
const post = (body: unknown = input) => POST(new Request(endpoint, { method: "POST", body: JSON.stringify(body) }));
const read = (id: string) => detail(new Request(endpoint), { params: Promise.resolve({ id }) });
const list = () => GET(new Request(endpoint));
const bills = async () => (await db.query("select source_id,prompt_tokens,completion_tokens,cost_usd from llm_calls where source='extension'")).rows;
const payload = (request: StructuredLlmRequest): ExtensionModelPayload =>
  JSON.parse(request.user.match(/<inventory>\n([\s\S]*?)\n<\/inventory>/)![1]);

// 모의 모델도 실제 전송된 지원 후보만 고른다. 비공개 ID 매핑을 받거나
// 계산 비용·검사·출처 링크를 만들어 반환하지 않는다.
function output(request: StructuredLlmRequest): ExtensionProposal {
  const candidates = payload(request).candidates;
  const raw = structuredClone(savedProposal);
  for (const plan of raw.plans) {
    for (const item of [...plan.reusedResources, ...plan.usageIncreases]) {
      item.resourceId = candidates.find(c => c.componentId === item.componentId && c.eligibility === "supported")!.alias;
    }
    for (const subnet of plan.subnetProposals) if (subnet.parent.kind === "existing") {
      subnet.parent.resourceId = plan.reusedResources.find(r => r.componentId === "virtual-network")!.resourceId;
    }
  }
  return raw;
}
function resources(count: number): ScanInventory {
  const saved = structuredClone(proposalInventory);
  while (saved.resources.length < count) {
    const row = structuredClone(saved.resources[1]);
    row.name = `z-private-workload-${saved.resources.length}`;
    row.id = row.id.slice(0, row.id.lastIndexOf("/") + 1) + row.name;
    row.tags = { password: "synthetic-secret-never-transmit" };
    saved.resources.push(row);
  }
  return saved;
}
async function scan(saved = inventory, workspaceId = input.workspaceId) {
  return createScansDb({ db: async () => db }).createImportScan({ workspaceId, inventory: saved,
    subscriptionIds: proposalScan.subscriptionIds, summary: summarizeInventory(saved.resources, []),
    collectedAt: proposalScan.collectedAt! });
}
async function queued(body: unknown = input) {
  const response = await post(body);
  expect(response.status).toBe(202);
  return (await response.json()).id as string;
}
async function run() { await m.after.mock.calls.at(-1)![0](); }
async function page(id: string, tier = "ha") {
  const tree = await ResultPage({ params: Promise.resolve({ id }), searchParams: Promise.resolve({ tier }) });
  // aria-labelledby를 Window가 있는 실제 문서 안에서 해석한다.
  const body = document.createElement("div");
  document.body.append(body);
  body.innerHTML = renderToStaticMarkup(<I18nProvider locale={m.locale === "ko" ? "ko" : "en"}>{tree}</I18nProvider>);
  return body;
}
beforeEach(async () => {
  vi.resetAllMocks(); m.locale = "en";
  db = await createTestDatabase(); m.db.mockResolvedValue(db);
  const workspaceId = await insertTestWorkspace(db, "Synthetic saved owner");
  input = { ...proposalInput, workspaceId }; inventory = resources(40);
  input.sourceScanId = await scan();
  store = createExtensionsDb({ db: async () => db });
  m.workspace.mockResolvedValue({ id: workspaceId, name: "Synthetic saved owner" });
  await db.query("update workspaces set claude_api_key_env='CLOUDSIGHT_CLAUDE_KEY_ACCEPTANCE' where id=$1", [workspaceId]);
  vi.stubEnv("CLOUDSIGHT_CLAUDE_KEY_ACCEPTANCE", "fake-owner-key");
  vi.stubEnv("CLOUDSIGHT_CLAUDE_KEY_ROTATED", "fake-rotated-key");
  vi.stubEnv("ANTHROPIC_API_KEY", "fake-personal-key");
  m.provider.mockImplementation(async request => ({ data: output(request), usage }));
  vi.spyOn(globalThis, "fetch").mockRejectedValue(Error("unexpected external I/O"));
});
afterEach(async () => {
  document.body.replaceChildren();
  vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks(); await db.close();
});

it.each(["en", "ko"])("accepts full-length %s input through saved source, alias transport, three real plans and pinned page/history reads", async locale => {
  m.locale = locale;
  input.description = (locale === "en" ? "Add a reservation service with a database. " : "기존 환경에 예약 서비스와 데이터베이스를 추가합니다. ").repeat(100).slice(0, 2000);
  const id = await queued();
  expect((await store.getExtension(id))!.input).toEqual(input);
  expect(m.provider).not.toHaveBeenCalled();
  await run();
  const saved = (await store.getExtension(id))!;
  expect(saved.status).toBe("succeeded");
  expect(saved.result!.plans.map(p => p.tier)).toEqual(["low", "balanced", "ha"]);
  expect(saved.result!.contextCoverage).toEqual({ total: 40, included: 40, excluded: 0, reasons: [] });
  const request = m.provider.mock.calls[0][0] as StructuredLlmRequest;
  expect(JSON.parse(request.user.match(/<requirements>\n([\s\S]*?)\n<\/requirements>/)![1])).toBe(input.description);
  expect(payload(request).inventory.resources).toHaveLength(40);
  expect(request.user).not.toMatch(/sample-rg|sample-plan|z-private-workload|synthetic-secret|\/subscriptions\/|10\.1\.0|P1v3|aliasToResourceId|"prices"|"meterId"/);
  expect(request).toMatchObject({ apiKeyEnv: "CLOUDSIGHT_CLAUDE_KEY_ACCEPTANCE", timeoutMs: expect.any(Number) });
  for (const plan of saved.result!.plans) {
    expect(plan.incrementalCost.state).toBe("available");
    if (plan.incrementalCost.state !== "available") throw Error("missing saved cost");
    const lines = plan.incrementalCost.data.lines;
    expect(lines.some(l => l.componentId === "app-service-linux-p1v3")).toBe(false);
    expect(lines).toHaveLength(plan.newItems.length + plan.usageIncreases.length);
    for (const increase of plan.usageIncreases) {
      expect(lines).toContainEqual(expect.objectContaining({ ...increase, kind: "usage-increase" }));
      expect(lines.find(l => l.componentId === increase.componentId)!.amount).toBeGreaterThan(0);
    }
    expect(lines.find(l => l.componentId === "virtual-network-subnet")!.amount).toBe(0);
    expect(plan.incrementalCost.data.total).toBeCloseTo(lines.reduce((sum, l) => sum + l.amount, 0), 8);
    expect(plan.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "capacity", verdict: "unknown", reasonCodes: ["capacity-unverified"] }),
      expect.objectContaining({ kind: "path", verdict: "unknown", reasonCodes: ["unsupported-path"] }),
    ]));
  }
  const display = await extensionResults.getDisplay(id);
  const first = await page(id);
  expect(getAllByRole(first, "button", { pressed: false, name: locale === "en" ? /Select / : /선택/ })).toHaveLength(2);
  expect(getByRole(first, "button", { pressed: true }).textContent).toContain(locale === "en" ? "High availability" : "고가용성");
  const t = createTranslator(locale === "ko" ? "ko" : "en");
  const artifacts = getByRole(first, "region", { name: t("extensionArtifacts.title") });
  for (const kind of ["guide", "evaluation", "bicep"] as const) {
    expect(getByRole(artifacts, "heading", { name: t(`extensionArtifacts.${kind}`) })).toBeTruthy();
  }
  expect(artifacts.textContent).toContain(t("extensionArtifacts.draftNotice"));
  expect(first.textContent).toContain(locale === "en" ? "Account benefits have not been measured" : "계정의 혜택을 측정한 것이 아닙니다");
  expect(first.textContent).toContain("10.2.0.0/16");
  const sources = getAllByRole(first, "link").filter(a => a.getAttribute("target") === "_blank").map(a => a.getAttribute("href"));
  expect(sources.length).toBeGreaterThan(0);
  expect(sources.every(url => url!.startsWith("https://learn.microsoft.com/"))).toBe(true);
  // 재열기·다운로드 소비자는 현재 카탈로그나 엔진을 필요로 하지 않는다.
  vi.spyOn(catalog, "loadCatalog").mockImplementation(() => { throw Error("must use pinned catalog"); });
  vi.spyOn(processing, "processExtensionOutput").mockImplementation(() => { throw Error("must not regenerate"); });
  vi.spyOn(processing, "validateStoredExtensionResult").mockImplementation(() => { throw Error("must not recalculate"); });
  const newer = structuredClone(inventory); newer.resources.forEach(r => { r.name = "LATEST SCAN NAME"; });
  const latestId = await scan(newer);
  expect(latestId).not.toBe(input.sourceScanId);
  vi.stubEnv("CLOUDSIGHT_CLAUDE_KEY_ACCEPTANCE", "");
  for (let n = 0; n < 2; n++) {
    expect(await (await read(id)).json()).toEqual({ ...saved, workspaceMismatch: false });
    expect((await (await list()).json()).extensions).toEqual([{ ...saved, workspaceMismatch: false }]);
    expect(await extensionResults.getDisplay(id)).toEqual(display);
    expect(await store.getExtensionCoreData(id)).toMatchObject({ catalog: { prices: { asOf: display!.priceAsOf } } });
    expect((await page(id)).innerHTML).toBe(first.innerHTML);
    const history = renderToStaticMarkup(<I18nProvider locale={locale === "ko" ? "ko" : "en"}>{await HistoryPage()}</I18nProvider>);
    expect(history).toContain(`/extensions/${id}`);
    expect(history).not.toContain("LATEST SCAN NAME");
  }
  m.workspace.mockResolvedValue({ id: await insertTestWorkspace(db), name: "Other cookie" });
  expect(await (await read(id)).json()).toEqual({ ...saved, workspaceMismatch: true });
  expect(await (await list()).json()).toEqual({ extensions: [] });
  expect(getAllByRole(await page(id), "status").some(node => node.textContent?.includes("Synthetic saved owner"))).toBe(true);
  expect(JSON.stringify(await (await read(id)).json())).not.toMatch(/saved_evidence|aliasToResourceId|synthetic-secret|fake-owner-key/);
  expect(await bills()).toEqual([{ source_id: id, prompt_tokens: 120, completion_tokens: 80, cost_usd: 0.02 }]);
  expect(m.provider).toHaveBeenCalledTimes(1); expect(globalThis.fetch).not.toHaveBeenCalled();
});

it("stores the real default 200 cap with explicit exclusions above 35 resources", async () => {
  inventory = resources(205); input.sourceScanId = await scan();
  const id = await queued(); await run();
  expect((await store.getExtension(id))!.result!.contextCoverage).toEqual({ total: 205, included: 200, excluded: 5, reasons: [{ code: "context-limit", count: 5 }] });
  expect(payload(m.provider.mock.calls[0][0]).inventory.resources).toHaveLength(200);
});
it.each(["partial", "legacy"])("preserves %s source uncertainty separately from complete model coverage", async kind => {
  if (kind === "partial") inventory.skippedRows = 2;
  else inventory.resources.forEach(r => { delete r.observedFields; });
  input.sourceScanId = await scan();
  const id = await queued(); await run();
  const saved = (await store.getExtension(id))!;
  expect(saved.status).toBe("succeeded");
  expect(saved.sourceScan.completeness).toEqual({ state: kind === "partial" ? "partial" : "unknown",
    reasons: kind === "partial" ? ["collection-partial", "import-scope-unverified"] : ["import-scope-unverified", "legacy-completeness-unknown"] });
  expect(saved.result!.contextCoverage).toMatchObject({ total: 40, included: 40, excluded: 0 });
  expect((await (await read(id)).json()).sourceScan).toEqual(saved.sourceScan);
  expect((await page(id)).textContent).toMatch(kind === "partial" ? /Partial/ : /Unknown/);
});

it.each(["existing-outside", "existing-sibling", "new-overlap"])("keeps a code CIDR violation for %s through API and page", async kind => {
  if (kind === "existing-sibling") {
    inventory.resources[0].properties.subnets = [{ name: "occupied", properties: { addressPrefix: "10.1.1.0/24" } }];
    input.sourceScanId = await scan();
  }
  m.provider.mockImplementation(async request => {
    const raw = output(request);
    if (kind === "existing-outside") raw.plans[0].subnetProposals[0].addressPrefixes = ["10.9.1.0/24"];
    if (kind === "new-overlap") {
      const subnet = raw.plans[2].subnetProposals[0];
      subnet.addressPrefixes = ["10.1.2.0/24"];
      if (subnet.parent.kind !== "new") throw Error("fixture");
      subnet.parent.addressPrefixes = ["10.1.0.0/16"];
    }
    return { data: raw, usage };
  });
  const id = await queued(); await run();
  const saved = (await (await read(id)).json()).result;
  expect(saved.plans[kind === "new-overlap" ? 2 : 0].checks).toContainEqual(expect.objectContaining({ kind: "cidr", verdict: "violation", evidence: expect.any(Array) }));
  expect((await page(id, kind === "new-overlap" ? "ha" : "low")).textContent).toContain("Violation");
});

it("shows catalog region uncertainty and incomplete cost without approving paths/capacity", async () => {
  m.provider.mockImplementation(async request => {
    const raw = output(request);
    raw.plans[0].newItems.push({ componentId: "static-web-apps-standard", quantity: 1, instanceCount: 1 });
    return { data: raw, usage };
  });
  const id = await queued(); await run();
  const plan = (await store.getExtension(id))!.result!.plans[0];
  expect(plan.incrementalCost.state).toBe("partial");
  expect(plan.checks).toContainEqual(expect.objectContaining({ kind: "region", verdict: "unknown", reasonCodes: ["unsupported-region"] }));
  expect((await page(id, "low")).textContent).toContain("Priced subtotal");
});

it.each(["unknown-alias", "foreign-id", "price", "verdict", "url", "new-parent-outside"])("rejects model %s, retries at most once, renders failure and bills once", async kind => {
  m.provider.mockImplementation(async request => {
    const raw = output(request);
    if (kind === "unknown-alias") raw.plans[0].reusedResources[0].resourceId = "r999999";
    if (kind === "foreign-id") raw.plans[0].reusedResources[0].resourceId = "/subscriptions/00000000-0000-4000-8000-000000000099/resourcegroups/foreign/providers/microsoft.network/virtualnetworks/foreign";
    if (kind === "price") Object.assign(raw.plans[0], { incrementalCost: { total: 0 } });
    if (kind === "verdict") Object.assign(raw.plans[0], { checks: [{ kind: "capacity", verdict: "pass" }] });
    if (kind === "url") raw.recommendationReason.en = "Use https://unapproved.invalid/";
    if (kind === "new-parent-outside") raw.plans[2].subnetProposals[0].addressPrefixes = ["10.9.0.0/24"];
    return { data: raw, usage };
  });
  const id = await queued(); await run();
  expect((await (await read(id)).json())).toMatchObject({ status: "failed", result: null, error: { code: "validation-failed" }, usage: aggregate });
  expect(m.provider).toHaveBeenCalledTimes(2);
  expect(m.provider.mock.calls[1][0].user).toContain("<validation_errors>");
  expect(getByRole(await page(id), "alert")).toBeTruthy();
  expect(await bills()).toEqual([{ source_id: id, prompt_tokens: 240, completion_tokens: 160, cost_usd: 0.04 }]);
});

it("rereads saved-owner keys on retry and preserves parent/scan after cookie/latest-source changes", async () => {
  m.provider.mockImplementationOnce(async () => {
    await db.query("update workspaces set claude_api_key_env='CLOUDSIGHT_CLAUDE_KEY_ROTATED' where id=$1", [input.workspaceId]);
    m.workspace.mockResolvedValue({ id: await insertTestWorkspace(db), name: "Other cookie" });
    return { data: {}, usage };
  });
  const parent = await queued(); await run();
  expect(m.provider.mock.calls.map(([request]) => request.apiKeyEnv)).toEqual(["CLOUDSIGHT_CLAUDE_KEY_ACCEPTANCE", "CLOUDSIGHT_CLAUDE_KEY_ROTATED"]);
  const original = (await store.getExtension(parent))!;
  const newerScan = await scan();
  expect((await post({ ...input, sourceExtensionId: parent, sourceScanId: newerScan })).status).toBe(409);
  const child = await queued({ ...input, monthlyBudget: 500, sourceExtensionId: parent }); await run();
  expect(await store.getExtension(child)).toMatchObject({ status: "succeeded", sourceExtensionId: parent,
    workspaceId: input.workspaceId, sourceScanId: input.sourceScanId, input: { monthlyBudget: 500 } });
  expect(await store.getExtension(parent)).toEqual(original);
  expect(m.provider.mock.calls[2][0].apiKeyEnv).toBe("CLOUDSIGHT_CLAUDE_KEY_ROTATED");
  expect(await bills()).toHaveLength(2);
});

it.each(["missing-key", "wrong-owner", "foreign-scan"])("rejects %s before scheduling or billing", async kind => {
  const other = await insertTestWorkspace(db);
  if (kind === "missing-key") vi.stubEnv("CLOUDSIGHT_CLAUDE_KEY_ACCEPTANCE", "");
  if (kind === "wrong-owner") m.workspace.mockResolvedValue({ id: other });
  if (kind === "foreign-scan") input.sourceScanId = await scan(inventory, other);
  const response = await post();
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual(kind === "missing-key" ? { code: "claude-unavailable", workspaceId: input.workspaceId }
    : { code: kind === "wrong-owner" ? "workspace-changed" : "invalid-source" });
  expect((await db.query("select id from extensions")).rows).toEqual([]);
  expect(m.after).not.toHaveBeenCalled(); expect(m.provider).not.toHaveBeenCalled(); expect(await bills()).toEqual([]);
});

it("keeps a stale terminal error after a late second response and records the aggregate only once", async () => {
  const late = Promise.withResolvers<{ data: unknown; usage: typeof usage }>();
  let valid: ExtensionProposal;
  m.provider.mockImplementationOnce(async () => ({ data: {}, usage })).mockImplementationOnce(request => {
    valid = output(request); return late.promise;
  });
  const id = await queued(); const running = m.after.mock.calls.at(-1)![0]();
  await vi.waitFor(() => expect(m.provider).toHaveBeenCalledTimes(2));
  await db.query("update extensions set created_at=$2 where id=$1", [id, new Date(Date.now() - 331_000).toISOString()]);
  expect((await (await list()).json()).extensions[0]).toMatchObject({ status: "failed", error: { code: "interrupted" } });
  const terminal = await store.getExtension(id);
  expect(await bills()).toEqual([]);
  late.resolve({ data: valid!, usage }); await running;
  expect(await store.getExtension(id)).toMatchObject({ status: "failed", result: null, completedAt: terminal!.completedAt, error: { code: "interrupted" }, usage: aggregate });
  expect(await bills()).toHaveLength(1);
  expect(getByRole(await page(id), "alert").textContent).toContain("interrupted");
});

it("renders sanitized provider errors with known usage and no retry of provider failures", async () => {
  m.provider.mockRejectedValue(new ClaudeError("http", "private-response-never-display", 403, usage));
  const id = await queued(); await run();
  expect(await store.getExtension(id)).toMatchObject({ status: "failed", error: { code: "forbidden" }, usage });
  const body = await page(id);
  expect(getByRole(body, "alert")).toBeTruthy();
  expect(body.innerHTML).not.toContain("private-response-never-display");
  expect(m.provider).toHaveBeenCalledTimes(1); expect(await bills()).toHaveLength(1);
});

it("rechecks a removed owner key before retry, preserving the first call bill without personal fallback", async () => {
  m.provider.mockImplementationOnce(async () => {
    await db.query("update workspaces set claude_api_key_env=null where id=$1", [input.workspaceId]);
    return { data: {}, usage };
  });
  const id = await queued(); await run();
  expect(await store.getExtension(id)).toMatchObject({ status: "failed", error: { code: "not-configured" }, usage });
  expect(m.provider).toHaveBeenCalledTimes(1); expect(await bills()).toHaveLength(1);
  expect(getByRole(await page(id), "link", { name: "Configure Claude key" }).getAttribute("href"))
    .toBe(`/workspaces/${input.workspaceId}/claude`);
});

it("charges new metered logs without a second free grant while other options charge only increased usage", async () => {
  m.provider.mockImplementation(async request => {
    const raw = output(request), plan = raw.plans[0];
    plan.reusedResources = plan.reusedResources.filter(r => r.componentId !== "log-analytics-ingestion");
    plan.usageIncreases = plan.usageIncreases.filter(r => r.componentId !== "log-analytics-ingestion");
    plan.newItems.push({ componentId: "log-analytics-ingestion", quantity: 1, instanceCount: 1 });
    return { data: raw, usage };
  });
  const id = await queued(); await run();
  for (const plan of (await store.getExtension(id))!.result!.plans) {
    if (plan.incrementalCost.state !== "available") throw Error("missing cost");
    const logs = plan.incrementalCost.data.lines.filter(l => l.componentId === "log-analytics-ingestion");
    expect(logs).toHaveLength(1);
    expect(logs[0].kind).toBe(plan.tier === "low" ? "new" : "usage-increase");
    expect(logs[0].amount).toBeGreaterThan(0);
  }
  expect((await page(id, "low")).textContent).toContain("Account benefits have not been measured");
});

it("preserves independent billing and renders a sanitized failure if the success UPDATE fails", async () => {
  const id = await queued();
  const query = db.query.bind(db);
  let rejectWrite = true;
  vi.spyOn(db, "query").mockImplementation(async (...args: Parameters<typeof db.query>) => {
    if (rejectWrite && String(args[0]).startsWith("update extensions set status='succeeded'")) {
      rejectWrite = false; throw Error("private-database-failure");
    }
    return query(...args);
  });
  await run();
  expect(await store.getExtension(id)).toMatchObject({ status: "failed", result: null, error: { code: "internal" }, usage });
  expect(await bills()).toHaveLength(1);
  expect(getByRole(await page(id), "alert").textContent).not.toContain("private-database-failure");
  m.db.mockRejectedValue(Error("private-database-unavailable"));
  const response = await post();
  expect(response.status).toBe(500); expect(await response.json()).toEqual({ code: "internal" });
});

for(const locale of ['en','ko'] as const)it.each([...quantityClaims,...wrappedMonetaryClaims])(`rejects bounded quantity monetary claims in the actual saved job (${locale}): %j`,async text=>{
 m.provider.mockImplementation(async request=>{
  const raw=output(request);raw.recommendationReason[locale]=text[locale];return {data:raw,usage};
 });
 const id=await queued();await run();
 expect((await store.getExtension(id))!).toMatchObject({status:'failed',result:null,error:{code:'validation-failed'},usage:aggregate});
 expect(m.provider).toHaveBeenCalledTimes(2);
 expect(await bills()).toEqual([{source_id:id,prompt_tokens:240,completion_tokens:160,cost_usd:0.04}]);
 expect((await db.query('select saved_evidence from extensions where id=$1',[id])).rows).toEqual([{saved_evidence:null}]);
});
it.each(ordinaryNumbers.slice(0,5))('seals ordinary quantity advice in the actual saved job: %j',async text=>{
 m.provider.mockImplementation(async request=>{const raw=output(request);raw.recommendationReason=text;return {data:raw,usage};});
 const id=await queued();await run();
 expect((await store.getExtension(id))!).toMatchObject({status:'succeeded',result:{recommendationReason:text},usage});
 expect(m.provider).toHaveBeenCalledTimes(1);
 expect((await db.query('select saved_evidence is not null as sealed from extensions where id=$1',[id])).rows).toEqual([{sealed:true}]);
});
