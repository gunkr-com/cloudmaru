// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { collectActualCosts, costPeriods, COST_API_VERSION } from "./cost-management";
import { actualCostWindowsSchema } from "@/lib/completion/schema";
const sub = "00000000-0000-0000-0000-000000000001";
const other = "00000000-0000-0000-0000-000000000002";
const rid = `/subscriptions/${sub}/resourcegroups/test/providers/microsoft.web/sites/app`;
const endpoint = `https://management.azure.com/subscriptions/${sub}/providers/Microsoft.CostManagement/query`;
const next = `${endpoint}?api-version=2026-06-01&$skiptoken=next`;
const columns = [{ name: "PreTaxCost", type: "Number" }, { name: "ResourceId", type: "String" }, { name: "Currency", type: "String" }];
const page = (rows: unknown[][] = [[0, rid, "CAD"]], nextLink: string | null = null) => ({ properties: { columns, rows, nextLink } });
const args = { subscriptionIds: [sub], resourceIds: [rid], retrievedAt: "2026-11-11T15:30:00Z" };
function deps(...responses: unknown[]) {
  const fetch = vi.fn<typeof globalThis.fetch>();
  for (const value of responses) fetch.mockResolvedValueOnce(value instanceof Response ? value : Response.json(value));
  return { fetch, getToken: vi.fn(async () => "fake-token") };
}
describe("actual cost collection", () => {
  it("UTC 월 경계·윤년·최근 30일을 계산한다", () => {
    expect(costPeriods("2024-03-01T02:00:00+02:00")).toEqual({
      monthToDate: { preset: "month-to-date", from: "2024-03-01T00:00:00.000Z", to: "2024-03-01T00:00:00.000Z" },
      trailing30Days: { preset: "trailing30-days", from: "2024-01-31T00:00:00.000Z", to: "2024-03-01T00:00:00.000Z" },
    });
    expect(costPeriods("2027-01-01T00:01:00Z").monthToDate.from).toBe("2027-01-01T00:00:00.000Z");
    expect(() => costPeriods("bad")).toThrow();
  });
  it("고정 API·ActualCost·Custom POST와 원 본문을 다음 페이지에도 사용한다", async () => {
    const d = deps(page([[0, rid, "CAD"]], next), page([[-2, rid, "USD"], [5, null, "USD"]]), page());
    const result = await collectActualCosts(args, d);
    expect(COST_API_VERSION).toBe("2026-06-01");
    expect(result.actualCost.monthToDate).toMatchObject({ state: "available", data: {
      totals: [{ currency: "CAD", amount: 0, subscriptionIds: [sub] }, { currency: "USD", amount: 3, subscriptionIds: [sub] }],
      scope: { paginationComplete: true }, period: costPeriods(args.retrievedAt).monthToDate, retrievedAt: args.retrievedAt } });
    expect(d.fetch.mock.calls.map(([url]) => url)).toEqual([`${endpoint}?api-version=${COST_API_VERSION}`, next, `${endpoint}?api-version=${COST_API_VERSION}`]);
    const bodies = d.fetch.mock.calls.map(([, init]) => JSON.parse(init!.body as string));
    expect(bodies[0]).toEqual({ type: "ActualCost", timeframe: "Custom", timePeriod: { from: costPeriods(args.retrievedAt).monthToDate.from, to: costPeriods(args.retrievedAt).monthToDate.to },
      dataset: { granularity: "None", aggregation: { totalCost: { name: "PreTaxCost", function: "Sum" } }, grouping: [{ type: "Dimension", name: "ResourceId" }] } });
    expect(bodies[1]).toEqual(bodies[0]);
    expect(d.fetch.mock.calls.every(([, init]) => init?.method === "POST" && init.redirect === "error")).toBe(true);
    expect(actualCostWindowsSchema.safeParse(result.actualCost).success).toBe(true);
  });
  it.each([new Response(null, { status: 204 }), page([])])("데이터 없음은 0원이 아니다", async response => {
    const r = await collectActualCosts(args, deps(response, page()));
    expect(r.actualCost.monthToDate).toEqual({ state: "unavailable", reason: "no-data" });
    expect(r.actualCost.trailing30Days).toMatchObject({ state: "available", data: { totals: [{ amount: 0 }] } });
  });
  it("정확한 월 시작에는 빈 월 기간을 요청하지 않는다", async () => {
    const d = deps(page());
    const r = await collectActualCosts({ ...args, retrievedAt: "2026-12-01T00:00:00Z" }, d);
    expect(r.actualCost.monthToDate).toEqual({ state: "unavailable", reason: "no-data" });
    expect(d.fetch).toHaveBeenCalledOnce();
    expect(r.scopes.monthToDate.availableSubscriptionIds).toEqual([]);
    expect(r.scopes.monthToDate.subscriptions[0]).toMatchObject({ state: "unavailable", reason: "no-data", paginationComplete: false });
  });
  it.each([403, 429, 404, 500])("구독별 HTTP %i 실패가 다른 성공과 다른 기간을 지우지 않는다", async status => {
    const d = deps(page(), new Response("secret raw error", { status }), page(), page([[0, rid.replace(sub, other), "CAD"]]));
    const r = await collectActualCosts({ ...args, subscriptionIds: [sub, other] }, d);
    expect(r.actualCost.monthToDate).toMatchObject({ state: "partial", reasons: [status === 403 ? "forbidden" : status === 429 ? "throttled" : status === 404 ? "not-supported" : "internal"], data: { scope: { availableSubscriptionIds: [sub], paginationComplete: false } } });
    expect(r.scopes.monthToDate.subscriptions[1].state).toBe(status === 403 || status === 404 ? "unavailable" : "failed");
    expect(r.actualCost.trailing30Days.state).toBe("available");
    expect(JSON.stringify(r)).not.toContain("secret");
    expect(actualCostWindowsSchema.safeParse(r.actualCost).success).toBe(true);
  });
  it("전체 403·인증 실패·잘못된 JSON도 정제한 상태다", async () => {
    expect((await collectActualCosts(args, deps(new Response("private", { status: 403 }), page()))).actualCost.monthToDate).toEqual({ state: "unavailable", reason: "forbidden" });
    const d = deps(); d.getToken.mockRejectedValue(Object.assign(new Error("private"), { name: "AzureCredentialError" }));
    expect((await collectActualCosts(args, d)).actualCost.monthToDate).toEqual({ state: "unavailable", reason: "auth-failed" });
    expect((await collectActualCosts(args, deps(new Response("bad"), page()))).actualCost.monthToDate).toEqual({ state: "failed", reason: "invalid-response" });
  });
  it.each([next.replace("management.azure.com", "evil.test"), next.replace(sub, other), next.replace("query?", "other?"),
    next.replace("2026-06-01", "2020-01-01"), next + "#bad", next + "&arbitrary=bad", next + "&api-version=2026-06-01",
    next.replace("https:", "http:"), next.replace("query?", "x/../query?"), next.replace("Microsoft.CostManagement", "Microsoft%2eCostManagement"), next.replace("management.azure.com", "user@management.azure.com")])("위험한 다음 페이지 링크를 인증 전에 거절한다 %s", async nextLink => {
    const d = deps(page([[1, rid, "CAD"]], nextLink), page());
    expect((await collectActualCosts(args, d)).actualCost.monthToDate).toMatchObject({ state: "partial", reasons: ["invalid-response"] });
    expect(d.getToken).toHaveBeenCalledTimes(2); // 첫 요청과 독립적인 30일 기간만 요청
  });
  it("순환·페이지/행 상한·다음 페이지 실패에서 받은 금액을 보존한다", async () => {
    for (const tail of [new Response("private", { status: 403 }), { properties: { columns, rows: [["1", rid, "CAD"]] } },
      page([], `${endpoint}?$skiptoken=next&api-version=2026-06-01`)]) {
      const d = deps(page([[3, rid, "CAD"]], next), tail, page());
      const r = await collectActualCosts(args, d);
      expect(r.actualCost.monthToDate).toMatchObject({ state: "partial", data: { totals: [{ amount: 3 }], scope: { paginationComplete: false } } });
      expect(d.fetch).toHaveBeenCalledTimes(3);
    }
    for (const limits of [{ maxPages: 1 }, { maxRows: 1 }]) {
      const d = deps(page([[3, rid, "CAD"]], next), page());
      expect((await collectActualCosts(args, { ...d, ...limits })).actualCost.monthToDate).toMatchObject({ state: "partial", reasons: ["collection-partial"] });
      expect(d.fetch).toHaveBeenCalledTimes(2);
    }
    expect((await collectActualCosts(args, { ...deps(page([[1, rid, "CAD"], [2, rid, "CAD"]]), page()), maxRows: 1 })).actualCost.monthToDate).toMatchObject({ state: "partial", data: { totals: [{ amount: 1 }] } });
  });
  it("빈 페이지 구독도 성공 범위에 포함하되 금액은 만들지 않는다", async () => {
    const r = await collectActualCosts({ ...args, subscriptionIds: [sub, other] }, deps(page(), page([]), page(), page([])));
    expect(r.actualCost.monthToDate).toMatchObject({ state: "available", data: { scope: { availableSubscriptionIds: [sub, other] } } });
  });
  it("ARM 경로의 대소문자만 다른 안전한 다음 페이지도 원 본문으로 읽는다", async () => {
    const link = next.replace("/query?", "/Query?");
    const d = deps(page([[1, rid, "CAD"]], link), page([[2, rid, "CAD"]]), page());
    expect((await collectActualCosts(args, d)).actualCost.monthToDate).toMatchObject({ state: "available", data: { totals: [{ amount: 3 }] } });
    expect(d.fetch.mock.calls[1][0]).toBe(link);
  });
  it("잘못된 percent encoding에는 토큰을 보내지 않는다", async () => {
    const d = deps(page([[1, rid, "CAD"]], next + "%zz"), page());
    expect((await collectActualCosts(args, d)).actualCost.monthToDate).toMatchObject({ state: "partial", reasons: ["invalid-response"] });
    expect(d.getToken).toHaveBeenCalledTimes(2);
  });
  it("행 상한을 구독 사이에도 유지한다", async () => {
    const d = deps(page(), page());
    const r = await collectActualCosts({ ...args, subscriptionIds: [sub, other] }, { ...d, maxRows: 1 });
    expect(r.actualCost.monthToDate).toMatchObject({ state: "partial", reasons: ["collection-partial"], data: { scope: { availableSubscriptionIds: [sub] } } });
    expect(d.fetch).toHaveBeenCalledTimes(2);
  });
  it("합계 overflow와 timeout도 다른 기간의 성공을 보존한다", async () => {
    expect((await collectActualCosts(args, deps(page([[1e308, rid, "CAD"], [1e308, rid, "CAD"]]), page()))).actualCost.monthToDate)
      .toEqual({ state: "failed", reason: "invalid-response" });
    const d = deps();
    d.fetch.mockImplementationOnce(() => new Promise(() => {})).mockResolvedValueOnce(Response.json(page()));
    const result = await collectActualCosts(args, { ...d, timeoutMs: 5 });
    expect(result.actualCost.monthToDate).toEqual({ state: "failed", reason: "timeout" });
    expect(result.actualCost.trailing30Days.state).toBe("available");
  });
  it("잘못된 입력은 토큰 조회 전에 거절한다", async () => {
    const d = deps();
    for (const subscriptionIds of [[], ["bad"], [sub, sub]]) await expect(collectActualCosts({ ...args, subscriptionIds }, d)).rejects.toThrow();
    for (const n of [0, -1, NaN, Infinity, 1.5]) for (const key of ["maxRows", "maxPages"]) await expect(collectActualCosts(args, { ...d, [key]: n })).rejects.toThrow();
    await expect(collectActualCosts({ ...args, retrievedAt: "bad" }, d)).rejects.toThrow();
    expect(d.getToken).not.toHaveBeenCalled();
  });
});
