// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
const m = vi.hoisted(() => ({ db: vi.fn(), workspace: vi.fn(), after: vi.fn(), provider: vi.fn(), acquire: vi.fn() }));
vi.mock("@/services/db/client", () => ({ getDb: m.db }));
vi.mock("@/services/current-workspace", () => ({ getCurrentWorkspace: m.workspace }));
vi.mock("next/server", () => ({ after: m.after }));
vi.mock("@/services/claude", async original => ({ ...await original<typeof import("@/services/claude")>(), requestStructuredOutput: m.provider }));
vi.mock("@/services/operator-prices", () => ({ acquireOperatorPrices: m.acquire }));
import { loadExtensionSupportCatalog } from "@/lib/catalog/extension-support";
import { POST, GET, maxDuration } from "./route";
import { GET as detail } from "./[id]/route";
import { createTestDatabase, insertTestWorkspace } from "@/lib/db/test-db.test-data";
import { createScansDb } from "@/services/db/scans";
import { createExtensionsDb } from "@/services/db/extensions";
import { fixture, proposalInput, proposalInventory, proposalScan } from "@/lib/extend/proposal.test-data";
import { ids } from "@/lib/completion/fixtures.test-data";
import type { ExtensionInput } from "@/types/extension";
import * as catalogLoader from "@/lib/catalog/load";
import * as core from "@/lib/extend/process";

let db: PGlite;
let input: ExtensionInput;
let store: ReturnType<typeof createExtensionsDb>;
const usage = { promptTokens: 200, completionTokens: 100, costUsd: 0.03 };
const url = "http://localhost/api/extensions";
const post = (body: unknown = input) => POST(new Request(url, { method: "POST", body: JSON.stringify(body) }));
const list = (query = "") => GET(new Request(url + query));
const read = (id: string) => detail(new Request(url), { params: Promise.resolve({ id }) });
async function scan(workspaceId = input.workspaceId) {
  return createScansDb({ db: async () => db }).createImportScan({ workspaceId,
    inventory: structuredClone(proposalInventory), subscriptionIds: proposalScan.subscriptionIds,
    summary: proposalScan.summary!, collectedAt: proposalScan.collectedAt! });
}
async function count() { return (await db.query("select id from extensions")).rows.length; }
async function queued() {
  const response = await post(); expect(response.status).toBe(202);
  return (await response.json()).id as string;
}
beforeEach(async () => {
  vi.resetAllMocks();
  const catalog = catalogLoader.loadCatalog();
  m.acquire.mockResolvedValue({ ok: true, catalog, support: loadExtensionSupportCatalog(catalog) });
  db = await createTestDatabase(); m.db.mockResolvedValue(db);
  const workspaceId = await insertTestWorkspace(db);
  input = { ...proposalInput, workspaceId }; input.sourceScanId = await scan();
  store = createExtensionsDb({ db: async () => db });
  m.workspace.mockResolvedValue({ id: workspaceId });
  await db.query("update workspaces set claude_api_key_env='CLOUDSIGHT_CLAUDE_KEY_TEST' where id=$1", [workspaceId]);
  vi.stubEnv("CLOUDSIGHT_CLAUDE_KEY_TEST", "fake-dedicated-key");
  vi.stubEnv("ANTHROPIC_API_KEY", "fake-personal-key");
  m.provider.mockResolvedValue({ data: fixture().raw, usage });
  vi.spyOn(globalThis, "fetch").mockRejectedValue(Error("unexpected network"));
});
afterEach(async () => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks(); await db.close(); });

it("reserves once, runs real core/store with fake provider, reopens saved history after cookie/latest-scan/key changes", async () => {
  expect(maxDuration).toBe(300);
  const id = await queued();
  expect(await count()).toBe(1); expect(m.after).toHaveBeenCalledTimes(1);
  expect(m.provider).not.toHaveBeenCalled();
  expect((await store.getExtension(id))!.status).toBe("pending");
  await m.after.mock.calls[0][0]();
  const saved = (await store.getExtension(id))!;
  expect(saved.status).toBe("succeeded");
  expect(saved.result!.plans).toHaveLength(3);
  expect(saved.sourceScan.completeness.reasons).toContain("import-scope-unverified");
  expect(m.provider.mock.calls[0][0].apiKeyEnv).toBe("CLOUDSIGHT_CLAUDE_KEY_TEST");
  const originalList = await list(); expect(originalList.status).toBe(200);
  expect(await originalList.json()).toEqual({ extensions: [{ ...saved, workspaceMismatch: false }] });
  // 저장 사본이 있는 조회는 현재 카탈로그·가격·검사 엔진을 실행하지 않는다.
  vi.spyOn(catalogLoader, "loadCatalog").mockImplementation(() => { throw Error("current catalog changed"); });
  vi.spyOn(core, "validateStoredExtensionResult").mockImplementation(() => { throw Error("must not recalculate"); });
  expect(await (await list()).json()).toEqual({ extensions: [{ ...saved, workspaceMismatch: false }] });
  await scan(); vi.stubEnv("CLOUDSIGHT_CLAUDE_KEY_TEST", "");
  m.workspace.mockResolvedValue({ id: await insertTestWorkspace(db) });
  for (let n = 0; n < 2; n++) {
    const response = await read(id); expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const payload = await response.json(); expect(payload).toEqual({ ...saved, workspaceMismatch: true });
    expect(JSON.stringify(payload)).not.toMatch(/saved_evidence|aliasToResourceId|"inventory"|fake-dedicated|fake-personal/);
  }
  expect(await (await list()).json()).toEqual({ extensions: [] });
  expect(m.provider).toHaveBeenCalledTimes(1); expect(m.after).toHaveBeenCalledTimes(1);
  expect((await db.query("select * from llm_calls where source='extension'")).rows).toHaveLength(1);
  expect(globalThis.fetch).not.toHaveBeenCalled();
});
it.each([false, true])("accepts a 2000-character Korean description, unicode escaped=%s", async escaped => {
  input.description = "한".repeat(2000);
  let text = JSON.stringify(input);
  if (escaped) text = text.replaceAll("한", "\\ud55c");
  const response = await POST(new Request(url, { method: "POST", body: text }));
  expect(response.status).toBe(202);
  expect((await store.getExtension((await response.json()).id))!.input.description).toBe(input.description);
  expect(m.after).toHaveBeenCalledTimes(1); expect(m.provider).not.toHaveBeenCalled();
});
it.each([
  { extra: true }, { sourceExtensionId: "bad" }, { workspaceId: "bad" }, { sourceScanId: "bad" },
  { schemaVersion: 2 }, { description: "한".repeat(2001) }, { input: {} }, { monthlyBudget: null },
])("rejects strict invalid input before reservation: %j", async change => {
  const response = await post({ ...input, ...change });
  expect(response.status).toBe(400); expect(await response.json()).toEqual({ code: "invalid-body" });
  expect(await count()).toBe(0); expect(m.after).not.toHaveBeenCalled();
});
it.each(["{", "null", "[]"])("rejects malformed or non-object body %s", async body => {
  const response = await POST(new Request(url, { method: "POST", body }));
  expect(response.status).toBe(400); expect(await count()).toBe(0);
});
it.each(["length", "stream", "dishonest-length"])("bounds request bytes via %s", async kind => {
  const headers = kind === "length" ? { "content-length": "16385" }
    : kind === "dishonest-length" ? { "content-length": "1" } : undefined;
  const response = await POST(new Request(url, { method: "POST", headers, body: " ".repeat(16385) }));
  expect(response.status).toBe(413); expect(await response.json()).toEqual({ code: "invalid-body" });
  expect(await count()).toBe(0); expect(m.after).not.toHaveBeenCalled();
});
it("rejects changed current workspace without a pending row", async () => {
  m.workspace.mockResolvedValue({ id: await insertTestWorkspace(db) });
  const response = await post(); expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ code: "workspace-changed" });
  expect(await count()).toBe(0); expect(m.after).not.toHaveBeenCalled();
});
it.each(["missing", "foreign", "failed"])("rejects %s source before reserve", async kind => {
  if (kind === "missing") input.sourceScanId = ids.scan;
  if (kind === "foreign") input.sourceScanId = await scan(await insertTestWorkspace(db));
  if (kind === "failed") await db.query("update scans set status='failed', inventory=null, summary=null, error_code='internal' where id=$1", [input.sourceScanId]);
  const response = await post(); expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ code: "invalid-source" });
  expect(await count()).toBe(0); expect(m.after).not.toHaveBeenCalled();
});
it("requires the dedicated key before reserve even with personal key present", async () => {
  vi.stubEnv("CLOUDSIGHT_CLAUDE_KEY_TEST", "");
  const response = await post(); expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ code: "claude-unavailable", workspaceId: input.workspaceId });
  expect(await count()).toBe(0); expect(m.after).not.toHaveBeenCalled(); expect(m.provider).not.toHaveBeenCalled();
});
it("derives reanalysis options from strict HTTP input and retains saved owner after cookie change", async () => {
  const parent = await queued(); await store.failExtension(parent, "internal"); m.after.mockClear();
  m.workspace.mockResolvedValue({ id: await insertTestWorkspace(db) });
  const response = await post({ ...input, sourceExtensionId: parent }); expect(response.status).toBe(202);
  const id = (await response.json()).id;
  expect(id).not.toBe(parent);
  expect(await store.getExtension(id)).toMatchObject({ sourceExtensionId: parent, workspaceId: input.workspaceId });
  await m.after.mock.calls[0][0]();
  expect((await store.getExtension(id))!.status).toBe("succeeded");
  expect(m.provider.mock.calls[0][0].apiKeyEnv).toBe("CLOUDSIGHT_CLAUDE_KEY_TEST");
});
it.each(["missing", "foreign"])("rejects %s original extension without another reservation", async kind => {
  const parent = await queued(); m.after.mockClear();
  if (kind === "foreign") {
    input.workspaceId = await insertTestWorkspace(db); input.sourceScanId = await scan();
    m.workspace.mockResolvedValue({ id: input.workspaceId });
  }
  const response = await post({ ...input, sourceExtensionId: kind === "missing" ? ids.extension : parent });
  expect(response.status).toBe(409); expect(await response.json()).toEqual({ code: "invalid-source" });
  expect(await count()).toBe(1); expect(m.after).not.toHaveBeenCalled();
});
it("fails the actual pending row if after scheduling fails", async () => {
  m.after.mockImplementation(() => { throw Error("PRIVATE scheduling error"); });
  const response = await post(); expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ code: "internal" });
  const rows = await store.listExtensions(input.workspaceId);
  expect(rows).toHaveLength(1); expect(rows[0]).toMatchObject({ status: "failed", error: { code: "internal" } });
  expect(m.provider).not.toHaveBeenCalled();
});
it("sanitizes database and current-workspace errors on all endpoints", async () => {
  m.db.mockRejectedValue(Error("PRIVATE database details"));
  for (const response of [await post(), await list(), await read(ids.extension)]) {
    expect(response.status).toBe(500); expect(await response.json()).toEqual({ code: "internal" });
  }
  expect(m.after).not.toHaveBeenCalled();
  m.db.mockResolvedValue(db); m.workspace.mockRejectedValue(Error("PRIVATE cookie failure"));
  expect((await post()).status).toBe(500); expect((await list()).status).toBe(500);
  expect(await count()).toBe(0);
});
it("lists only current workspace, newest first, with bounded limit and optional source filter", async () => {
  const first = await queued();
  input.sourceScanId = await scan(); const second = await queued();
  const all = await (await list()).json(); expect(all.extensions.map((r: { id: string }) => r.id)).toEqual([second, first]);
  expect((await (await list("?limit=1")).json()).extensions.map((r: { id: string }) => r.id)).toEqual([second]);
  expect((await (await list(`?sourceScanId=${input.sourceScanId}`)).json()).extensions.map((r: { id: string }) => r.id)).toEqual([second]);
  const foreign = await insertTestWorkspace(db);
  expect(await (await list(`?sourceScanId=${await scan(foreign)}`)).json()).toEqual({ extensions: [] });
  expect(m.provider).not.toHaveBeenCalled();
});
it.each(["?limit=0", "?limit=101", "?limit=1.5", "?limit=", "?sourceScanId=no", "?limit=1&limit=2", "?workspaceId=bad", "?extra=1"])("rejects invalid list query %s", async query => {
  const response = await list(query); expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ code: "invalid-query" });
});
it("recovers stale history and detail, preserves late aggregate usage without replacing failure", async () => {
  const id = await queued();
  // 실제 모델은 대기시켜 조회 중 stale 종료와 늦은 성공 청구를 교차한다.
  let finish!: (value: unknown) => void;
  m.provider.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const task = m.after.mock.calls[0][0]();
  await vi.waitFor(() => expect(m.provider).toHaveBeenCalledTimes(1));
  const createdAt = new Date(Date.now() - 330_001).toISOString();
  await db.query("update extensions set created_at=$2 where id=$1", [id, createdAt]);
  const history = await (await list()).json();
  expect(history.extensions[0]).toMatchObject({ id, status: "failed", error: { code: "interrupted" } });
  finish({ data: fixture().raw, usage }); await task;
  const saved = (await store.getExtension(id))!;
  expect(saved).toMatchObject({ status: "failed", error: { code: "interrupted" } });
  expect((await db.query("select * from llm_calls where source='extension'")).rows).toHaveLength(1);
  expect(await (await read(id)).json()).toEqual({ ...saved, workspaceMismatch: false });
});

it.each(["missing", "unreadable", "invalid", "synthetic", "incomplete"])("returns 409 before reserving when pricing is %s", async reason => {
  m.acquire.mockResolvedValueOnce({ ok: false, reason });
  const response = await post();
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ code: "pricing_unavailable" });
  expect(await count()).toBe(0);
  expect(m.after).not.toHaveBeenCalled();
  expect(m.provider).not.toHaveBeenCalled();
});

it("seals the request-time prices even when the operator snapshot is replaced", async () => {
  const id = await queued();
  const catalog = catalogLoader.loadCatalog();
  catalog.prices.asOf = "2034-01-01";
  m.acquire.mockResolvedValue({ ok: true, catalog, support: loadExtensionSupportCatalog(catalog) });
  await m.after.mock.calls[0][0]();
  const saved = await store.getExtension(id);
  expect(saved?.result?.plans[0].incrementalCost).toMatchObject({ data: { priceAsOf: catalogLoader.loadCatalog().prices.asOf } });
  expect(m.acquire).toHaveBeenCalledTimes(1);
});
