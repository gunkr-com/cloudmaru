import { describe, expect, it } from "vitest";
import { parseCostPage } from "./cost-management-parse";
const sub = "00000000-0000-0000-0000-000000000001";
const rid = `/subscriptions/${sub}/resourcegroups/test/providers/microsoft.web/sites/app`;
const columns = [{ name: "Currency", type: "String" }, { name: "ResourceId", type: "String" }, { name: "PreTaxCost", type: "Number" }];
const page = (rows: unknown[], cols = columns) => ({ properties: { columns: cols, rows, nextLink: null } });
describe("Cost query parser", () => {
  it("열 이름과 타입으로 0·음수·통화·중복 청구 행을 보존한다", () => {
    const result = parseCostPage(page([["CAD", rid.toUpperCase(), 0], ["USD", rid, -3], ["USD", rid, 4]]), sub, [rid]);
    expect(result.rows.map(r => [r.currency, r.amount])).toEqual([["CAD", 0], ["USD", -3], ["USD", 4]]);
    expect(result.rows[0].attribution).toEqual({ kind: "resource", resourceId: rid });
  });
  it("스캔 밖/잘못된/없는 ResourceId의 금액도 보존한다", () => {
    expect(parseCostPage(page([["CAD", rid, 2], ["CAD", "secret-invalid", 3], ["CAD", null, 4], ["CAD", "", 5]]), sub, []).rows.map(r => r.attribution)).toEqual([
      { kind: "unattributed", resourceId: rid, reason: "outside-inventory" },
      { kind: "unattributed", resourceId: null, reason: "invalid-resource-id" },
      { kind: "unattributed", resourceId: null, reason: "missing-resource-id" },
      { kind: "unattributed", resourceId: null, reason: "missing-resource-id" },
    ]);
  });
  it.each(["3", null, true, NaN, Infinity, {}, "NaN"])("숫자를 강제 변환하거나 행을 조용히 버리지 않는다 %s", amount => {
    expect(() => parseCostPage(page([["CAD", rid, amount]]), sub, [rid])).toThrow("Invalid cost response.");
  });
  it.each(["cad", "", 3, null])("잘못된 통화를 거절한다 %s", currency => {
    expect(() => parseCostPage(page([[currency, rid, 1]]), sub, [])).toThrow();
  });
  it("열 누락·타입·중복·잘린 행·다른 구독을 거절한다", () => {
    for (const raw of [page([], columns.slice(1)), page([], columns.map(c => ({ ...c, type: "String" }))),
      page([], [...columns, columns[0]]), page([["CAD", rid]]), page([["CAD", rid, 1, "extra"]]),
      page([["CAD", rid.replace(sub, "00000000-0000-0000-0000-000000000002"), 1]]),
      { properties: { columns, rows: [], nextLink: 3 } }, {}]) {
      expect(() => parseCostPage(raw, sub, [])).toThrow("Invalid cost response.");
    }
  });
  it("null과 정상 빈 페이지를 데이터 없음으로 남긴다", () => {
    expect(parseCostPage(null, sub, [])).toEqual({ rows: [], nextLink: null });
    expect(parseCostPage(page([]), sub, [])).toEqual({ rows: [], nextLink: null });
  });
});
