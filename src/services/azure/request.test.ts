// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { ARM_BASE_URL, AzureRequestError, azureRequest, isAllowedAzureRequest, type AzureRequest } from "./request";

const token = "private-test-token";
const path = "/subscriptions/x/resources?api-version=2022-10-01";
const request: AzureRequest = { method: "GET", path };
function deps() {
  return { getToken: vi.fn(async () => token), fetch: vi.fn<typeof fetch>().mockResolvedValue(Response.json({ ok: true })) };
}
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("Azure 요청 허용 목록", () => {
  it.each([
    ["PUT", path], ["PATCH", path], ["DELETE", path], ["get", path],
    ["POST", "/subscriptions/x/resourcegroups/y/providers/microsoft.resources/tags/default?api-version=1"],
    ["POST", "/providers/Microsoft.CostManagement/query?api-version=1"],
    ["GET", "https://evil.test/?api-version=1"], ["GET", "//evil.test/?api-version=1"],
    ["GET", "/subscriptions/x/../providers?api-version=1"], ["GET", "/a/..?api-version=1"], ["GET", "/a/./b?api-version=1"], ["GET", "/.%2e/resources?api-version=1"], ["GET", "/../resources?api-version=1"], ["GET", "/%2e%2e/resources?api-version=1"],
    ["GET", "/\\evil.test/?api-version=1"], ["GET", "/resources"],
    ["GET", "/resources?api-version="], ["GET", "/resources?api-version=1#fragment"],
    ["POST", "/providers/Microsoft.ResourceGraph/resources/extra?api-version=1"],
    // 인코딩한 슬래시로 다른 POST 경로를 비용 조회처럼 꾸미는 요청
    ["POST", "/subscriptions/x/resourceGroups/y%2Fproviders%2FMicrosoft.Web%2Fsites%2Fz%2Frestart/providers/Microsoft.CostManagement/query?api-version=1"],
    ["POST", "/subscriptions/x%2Fy/providers/Microsoft.CostManagement/query?api-version=1"],
    ["POST", "/subscriptions/x/resourceGroups/y%252Fz/providers/Microsoft.CostManagement/query?api-version=1"],
  ])("%s %s는 토큰 조회와 fetch 전에 차단한다", async (method, path) => {
    const d = deps();
    const input = { method, path } as AzureRequest;
    expect(isAllowedAzureRequest(input)).toBe(false);
    await expect(azureRequest(input, d)).rejects.toMatchObject({ kind: "disallowed" });
    expect(d.getToken).not.toHaveBeenCalled();
    expect(d.fetch).not.toHaveBeenCalled();
  });
  it.each([
    request,
    { method: "GET", path: "/subscriptions/x/resourceGroups/rg..prod?api-version=1" },
    { method: "POST", path: "/subscriptions/x/resourceGroups/rg.prod/providers/Microsoft.CostManagement/query?api-version=1" },
    { method: "POST", path: "/subscriptions/x/resourceGroups/rg..prod/providers/Microsoft.CostManagement/query?api-version=1" },
    { method: "POST", path: "/providers/Microsoft.ResourceGraph/resources?api-version=2022-10-01" },
    { method: "POST", path: "/subscriptions/x/providers/Microsoft.CostManagement/query?api-version=1" },
    { method: "POST", path: "/subscriptions/x/resourceGroups/y/providers/Microsoft.CostManagement/query?api-version=1" },
    // Azure는 리소스 그룹 이름에 유니코드를 허용한다. 인코딩해서 보낸다.
    { method: "POST", path: `/subscriptions/x/resourceGroups/${encodeURIComponent("운영-rg")}/providers/Microsoft.CostManagement/query?api-version=1` },
  ] satisfies AzureRequest[])("읽기 요청을 허용한다: %j", (input) => {
    expect(isAllowedAzureRequest(input)).toBe(true);
  });
});

describe("azureRequest", () => {
  it("호출 때 받은 토큰과 JSON을 고정 ARM 호스트에 보내고 리다이렉트를 막는다", async () => {
    const d = deps();
    expect(await azureRequest({ method: "POST", path: "/providers/Microsoft.ResourceGraph/resources?api-version=1", body: { query: "resources" } }, d)).toEqual({ ok: true });
    expect(d.fetch).toHaveBeenCalledExactlyOnceWith(`${ARM_BASE_URL}/providers/Microsoft.ResourceGraph/resources?api-version=1`, expect.objectContaining({
      method: "POST", redirect: "error", cache: "no-store", body: JSON.stringify({ query: "resources" }), signal: expect.any(AbortSignal),
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    }));
  });
  it.each([[401, "forbidden"], [403, "forbidden"], [404, "not-found"], [429, "throttled"], [500, "http"], [302, "http"]])("HTTP %i를 %s로 분류하고 재시도하지 않는다", async (status, kind) => {
    const d = deps();
    d.fetch.mockResolvedValue(new Response(token, { status: Number(status), headers: { "Retry-After": "12" } }));
    const error = await azureRequest(request, d).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AzureRequestError);
    expect(error).toMatchObject({ kind, status });
    if (status === 429) expect(error).toHaveProperty("retryAfterSeconds", 12);
    expect(String(error)).not.toContain(token);
    expect(error).not.toHaveProperty("cause");
    expect(d.fetch).toHaveBeenCalledOnce();
  });
  it.each(["bad", "-1", "Infinity"])("잘못된 Retry-After %s를 무시한다", async (value) => {
    const d = deps();
    d.fetch.mockResolvedValue(new Response(token, { status: 429, headers: { "Retry-After": value } }));
    await expect(azureRequest(request, d)).rejects.toMatchObject({ kind: "throttled", retryAfterSeconds: undefined });
  });
  it("204 응답을 비용 0으로 만들지 않고 본문 없는 null로 보존한다", async () => {
    const d = deps();
    const response = new Response(null, { status: 204 });
    const json = vi.spyOn(response, "json");
    d.fetch.mockResolvedValue(response);
    await expect(azureRequest({
      method: "POST",
      path: "/subscriptions/x/providers/Microsoft.CostManagement/query?api-version=2026-06-01",
      body: { type: "ActualCost", timeframe: "MonthToDate" },
    }, d)).resolves.toBeNull();
    expect(json).not.toHaveBeenCalled();
    expect(d.fetch).toHaveBeenCalledOnce();
  });
  it("JSON 오류 원문을 노출하지 않는다", async () => {
    const d = deps();
    d.fetch.mockResolvedValue(new Response(token));
    await expect(azureRequest(request, d)).rejects.toMatchObject({ kind: "invalid-response" });
  });
  it.each(["token", "fetch"])("%s 실패의 원문을 노출하지 않는다", async (stage) => {
    const d = deps();
    if (stage === "token") d.getToken.mockRejectedValue(new Error(token));
    else d.fetch.mockRejectedValue(new Error(token));
    const error = await azureRequest(request, d).catch((e: unknown) => e);
    expect(error).toMatchObject({ kind: "http" });
    expect(String(error)).not.toContain(token);
  });
  it.each(["token", "fetch", "body"])("%s 대기 중에도 시간 제한이 적용된다", async (stage) => {
    vi.useFakeTimers();
    const d = deps();
    if (stage === "token") d.getToken.mockImplementation(() => new Promise(() => {}));
    if (stage === "fetch") d.fetch.mockImplementation(() => new Promise(() => {}));
    if (stage === "body") d.fetch.mockResolvedValue(new Response(new ReadableStream({ start() {} })));
    const pending = expect(azureRequest(request, { ...d, timeoutMs: 25 })).rejects.toMatchObject({ kind: "timeout" });
    await vi.advanceTimersByTimeAsync(25);
    await pending;
    expect(vi.getTimerCount()).toBe(0);
  });
});
