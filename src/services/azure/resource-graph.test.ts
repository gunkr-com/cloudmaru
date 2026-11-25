// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { collectInventoryRows, INVENTORY_MAX_ROWS, queryResourceGraph } from "./resource-graph";
import { AzureCredentialError } from "./credential";
import { toScanErrorCode } from "@/lib/scans/map-error";
import { RESOURCES_QUERY, CONTAINERS_QUERY } from "@/lib/inventory/arg-query";

function deps(...pages: unknown[]) {
  const fetch = vi.fn<typeof globalThis.fetch>();
  for (const page of pages) fetch.mockResolvedValueOnce(Response.json(page));
  return { getToken: vi.fn(async () => "secret-token"), fetch };
}
const args = { subscriptions: ["subscription-x"], query: RESOURCES_QUERY };
describe("Resource Graph", () => {
  it("skipToken을 그대로 보내 모든 페이지를 받는다", async () => {
    const d = deps({ data: [{ id: "a" }], $skipToken: "next+/=" }, { data: [{ id: "b" }] });
    expect(await queryResourceGraph(args, d)).toEqual([{ id: "a" }, { id: "b" }]);
    const bodies = d.fetch.mock.calls.map(([, init]) => JSON.parse(String(init!.body)));
    expect(bodies).toEqual([
      { ...args, options: { $top: 1000, resultFormat: "objectArray" } },
      { ...args, options: { $top: 1000, resultFormat: "objectArray", $skipToken: "next+/=" } },
    ]);
    expect(String(d.fetch.mock.calls[0][0])).toBe("https://management.azure.com/providers/Microsoft.ResourceGraph/resources?api-version=2022-10-01");
  });
  it("빈 구독 목록은 요청하지 않는다", async () => {
    const d = deps();
    await expect(queryResourceGraph({ ...args, subscriptions: [] }, d)).rejects.toThrow();
    expect(d.fetch).not.toHaveBeenCalled();
    expect(d.getToken).not.toHaveBeenCalled();
  });
  it("페이지 상한 뒤에는 요청하지 않는다", async () => {
    const d = deps({ data: [], $skipToken: "again" });
    await expect(queryResourceGraph(args, { ...d, maxPages: 1 })).rejects.toThrow();
    expect(d.fetch).toHaveBeenCalledOnce();
  });
  it("행 상한 초과 시 부분 결과를 반환하지 않는다", async () => {
    const d = deps({ data: [{}, {}] });
    await expect(queryResourceGraph(args, { ...d, maxRows: 1 })).rejects.toMatchObject({ kind: "too-many-rows" });
  });
  it("상한과 같은 결과는 허용한다", async () => {
    expect(await queryResourceGraph(args, { ...deps({ data: [{}] }), maxPages: 1, maxRows: 1 })).toEqual([{}]);
  });
  it("기본 페이지 상한은 100이다", async () => {
    const d = deps(...Array.from({ length: 100 }, () => ({ data: [], $skipToken: "next" })));
    await expect(queryResourceGraph(args, d)).rejects.toMatchObject({ kind: "invalid-response" });
    expect(d.fetch).toHaveBeenCalledTimes(100);
  });
  it("기본 행 상한은 50000이다", async () => {
    const page = { data: Array.from({ length: 1000 }, () => ({})), $skipToken: "next" };
    const d = deps(...Array.from({ length: 51 }, () => page));
    await expect(queryResourceGraph(args, d)).rejects.toMatchObject({ kind: "too-many-rows" });
    expect(d.fetch).toHaveBeenCalledTimes(51);
  });
  it.each([{ data: "bad" }, {}, { data: [], $skipToken: 1 }, { data: [null] }])("응답 형식을 검증한다: %j", async (page) => {
    await expect(queryResourceGraph(args, deps(page))).rejects.toMatchObject({ kind: "invalid-response" });
  });
  it.each([0, -1, NaN, Infinity, 1.5])("잘못된 상한 %s는 요청 전에 거절한다", async (limit) => {
    const d = deps();
    await expect(queryResourceGraph(args, { ...d, maxPages: limit })).rejects.toThrow();
    await expect(queryResourceGraph(args, { ...d, maxRows: limit })).rejects.toThrow();
    expect(d.fetch).not.toHaveBeenCalled();
  });
  it.each([[403, "forbidden"], [429, "throttled"]])("HTTP %i 분류를 유지한다", async (status, kind) => {
    const d = deps();
    d.fetch.mockResolvedValue(new Response("secret-token", { status: Number(status) }));
    await expect(queryResourceGraph(args, d)).rejects.toMatchObject({ kind });
  });
  it("토큰 provider의 자격 증명 오류를 바꾸지 않고 올려 스캔 오류 코드를 보존한다", async () => {
    const d = deps();
    d.getToken.mockRejectedValue(new AzureCredentialError("certificate-expired"));
    const error = await collectInventoryRows(args.subscriptions, d).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AzureCredentialError);
    expect(toScanErrorCode(error)).toBe("certificate-expired");
    expect(d.fetch).not.toHaveBeenCalled();
  });
  it("리소스와 컨테이너를 합해 상한을 넘으면 too-many-rows", async () => {
    const resources = Array.from({ length: INVENTORY_MAX_ROWS - 5 }, (_, i) => ({ id: `r${i}` }));
    const containers = Array.from({ length: 6 }, (_, i) => ({ id: `c${i}` }));
    await expect(collectInventoryRows(args.subscriptions, deps({ data: resources }, { data: containers })))
      .rejects.toMatchObject({ kind: "too-many-rows" });
    const exact = Array.from({ length: 5 }, (_, i) => ({ id: `c${i}` }));
    const result = await collectInventoryRows(args.subscriptions, deps({ data: resources }, { data: exact }));
    expect(result.resourceRows.length + result.containerRows.length).toBe(INVENTORY_MAX_ROWS);
  });
  it("resources와 resourcecontainers를 같은 래퍼로 수집한다", async () => {
    const d = deps({ data: [{ id: "resource" }] }, { data: [{ id: "container" }] });
    expect(await collectInventoryRows(args.subscriptions, d)).toEqual({ resourceRows: [{ id: "resource" }], containerRows: [{ id: "container" }] });
    expect(d.fetch.mock.calls.map(([, init]) => JSON.parse(String(init!.body)).query)).toEqual([RESOURCES_QUERY, CONTAINERS_QUERY]);
  });
});
