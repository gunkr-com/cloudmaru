// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { collectAdvisorRecommendations, ADVISOR_API_VERSION } from "./advisor";
const sub = "00000000-0000-0000-0000-000000000001";
const other = "00000000-0000-0000-0000-000000000002";
const rid = `/subscriptions/${sub}/resourcegroups/test/providers/microsoft.compute/virtualmachines/vm`;
const endpoint = `https://management.azure.com/subscriptions/${sub}/providers/Microsoft.Advisor/recommendations`;
const next = `${endpoint}?api-version=2026-10-01&$skipToken=next`;
const row = { id: `/subscriptions/${sub}/providers/Microsoft.Advisor/recommendations/one`, properties: {
  recommendationTypeId: "e10b1381-5f0a-47ff-8c7b-37bd13d7c974", resourceMetadata: { resourceId: rid } } };
const args = { subscriptionIds: [sub], resourceIds: [rid], retrievedAt: "2026-11-11T00:00:00Z" };
function deps(...responses: unknown[]) {
  const fetch = vi.fn<typeof globalThis.fetch>();
  for (const value of responses) fetch.mockResolvedValueOnce(value instanceof Response ? value : Response.json(value));
  return { fetch, getToken: vi.fn(async () => "fake-token") };
}
describe("cached Advisor collection", () => {
  it("GET만 사용해 고정 버전과 검증된 다음 페이지를 요청한다", async () => {
    const d = deps({ value: [row], nextLink: next }, { value: [] });
    const result = await collectAdvisorRecommendations(args, d);
    expect(ADVISOR_API_VERSION).toBe("2026-10-01");
    expect(result.advisor.state).toBe("available");
    expect(result.scope).toMatchObject({ requestedSubscriptionIds: [sub], availableSubscriptionIds: [sub], paginationComplete: true });
    expect(d.fetch.mock.calls.map(([url]) => url)).toEqual([`${endpoint}?api-version=2026-10-01`, next]);
    expect(d.fetch.mock.calls.every(([, init]) => init?.method === "GET" && init.redirect === "error")).toBe(true);
  });
  it.each([
    next.replace("management.azure.com", "evil.test"), next.replace(sub, other), next.replace("recommendations?", "generateRecommendations?"),
    next.replace("2026-10-01", "2020-01-01"), next + "&api-version=2026-10-01", next + "#fragment",
    next.replace("https:", "http:"), next.replace("management.azure.com", "user@management.azure.com"),
    next.replace("recommendations?", "x/../recommendations?"), next + "&arbitrary=secret",
    next.replace("Microsoft.Advisor", "Microsoft%2eAdvisor"),
  ])("호스트/구독/경로/버전이 다른 nextLink에 토큰을 보내지 않는다: %s", async (nextLink) => {
    const d = deps({ value: [row], nextLink });
    const result = await collectAdvisorRecommendations(args, d);
    expect(result.advisor).toMatchObject({ state: "partial", reasons: ["invalid-response"], data: { recommendations: [expect.anything()] } });
    expect(d.getToken).toHaveBeenCalledOnce();
    expect(d.fetch).toHaveBeenCalledOnce();
  });
  it("순서만 다른 query를 포함해 순환을 감지한다", async () => {
    const d = deps({ value: [row], nextLink: next }, { value: [], nextLink: `${endpoint}?$skipToken=next&api-version=2026-10-01` });
    expect((await collectAdvisorRecommendations(args, d)).advisor).toMatchObject({ state: "partial", reasons: ["invalid-response"] });
    expect(d.getToken).toHaveBeenCalledTimes(2);
  });
  it("다른 구독의 403이 성공한 결과를 지우지 않는다", async () => {
    const d = deps({ value: [row] }, new Response("private", { status: 403 }));
    const result = await collectAdvisorRecommendations({ ...args, subscriptionIds: [sub, other] }, d);
    expect(result.advisor).toMatchObject({ state: "partial", reasons: ["forbidden"] });
    expect(result.scope.availableSubscriptionIds).toEqual([sub]);
    expect(result.scope.subscriptions[1]).toEqual({ subscriptionId: other, state: "unavailable", reason: "forbidden", paginationComplete: false });
    expect(JSON.stringify(result)).not.toContain("private");
  });
  it.each([403, 429, 500])("전체 HTTP 실패 %i를 코드로 분류한다", async status => {
    const result = await collectAdvisorRecommendations(args, deps(new Response("private", { status })));
    expect(result.advisor).toEqual(status === 403 ? { state: "unavailable", reason: "forbidden" } :
      { state: "failed", reason: status === 429 ? "throttled" : "internal" });
  });
  it("빈 성공과 미매핑을 조회 실패로 바꾸지 않는다", async () => {
    expect((await collectAdvisorRecommendations(args, deps({ value: [] }))).advisor).toMatchObject({ state: "available", data: { coverage: { total: 0 } } });
    expect((await collectAdvisorRecommendations({ ...args, resourceIds: [] }, deps({ value: [row] }))).advisor).toMatchObject({ state: "partial", reasons: ["scope-not-collected"] });
  });
  it("부분 페이지 뒤 형식 오류/403/상한에서도 받은 행을 보존한다", async () => {
    for (const response of [{ value: "bad" }, new Response("private", { status: 403 })]) {
      const d = deps({ value: [row], nextLink: next }, response);
      expect((await collectAdvisorRecommendations(args, d)).advisor).toMatchObject({ state: "partial", data: { coverage: { included: 1 } } });
    }
    const d = deps({ value: [row], nextLink: next });
    expect((await collectAdvisorRecommendations(args, { ...d, maxPages: 1 })).advisor).toMatchObject({ state: "partial" });
    expect(d.getToken).toHaveBeenCalledOnce();
    const capped = deps({ value: [row], nextLink: next });
    expect((await collectAdvisorRecommendations(args, { ...capped, maxRows: 1 })).advisor).toMatchObject({ state: "partial" });
    expect(capped.getToken).toHaveBeenCalledOnce();
  });
  it("토큰 오류/204/잘못된 JSON은 자유 문장 없이 실패한다", async () => {
    const d = deps();
    d.getToken.mockRejectedValue(Object.assign(new Error("secret-token"), { name: "AzureCredentialError" }));
    expect((await collectAdvisorRecommendations(args, d)).advisor).toEqual({ state: "unavailable", reason: "auth-failed" });
    expect(d.fetch).not.toHaveBeenCalled();
    for (const response of [new Response(null, { status: 204 }), new Response("not json")]) {
      expect((await collectAdvisorRecommendations(args, deps(response))).advisor).toEqual({ state: "failed", reason: "invalid-response" });
    }
  });
  it("전체 행 상한은 구독 사이에도 유지되고 초과 페이지는 부분으로 보존한다", async () => {
    const d = deps({ value: [row] });
    const result = await collectAdvisorRecommendations({ ...args, subscriptionIds: [sub, other] }, { ...d, maxRows: 1 });
    expect(result.advisor).toMatchObject({ state: "partial", data: { coverage: { included: 1 } } });
    expect(d.fetch).toHaveBeenCalledOnce();
    const capped = await collectAdvisorRecommendations(args, { ...deps({ value: [row, row] }), maxRows: 1 });
    expect(capped.advisor).toMatchObject({ state: "partial", reasons: ["collection-partial"] });
    expect(capped.scope.paginationComplete).toBe(false);
  });
  it("잘못된 입력/상한은 토큰 전에 거절한다", async () => {
    const d = deps();
    for (const subscriptionIds of [[], ["bad"], [sub, sub]]) await expect(collectAdvisorRecommendations({ ...args, subscriptionIds }, d)).rejects.toThrow();
    for (const maxPages of [0, -1, NaN, Infinity, 1.5]) await expect(collectAdvisorRecommendations(args, { ...d, maxPages })).rejects.toThrow();
    for (const maxRows of [0, -1, NaN, Infinity, 1.5]) await expect(collectAdvisorRecommendations(args, { ...d, maxRows })).rejects.toThrow();
    expect(d.getToken).not.toHaveBeenCalled();
  });
});
