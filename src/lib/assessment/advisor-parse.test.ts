import { describe, expect, it } from "vitest";
import { mapAdvisorRows, parseAdvisorPage } from "./advisor-parse";
import { advisorResultSchema } from "@/lib/completion/schema";
const sub = "00000000-0000-0000-0000-000000000001";
const rid = `/subscriptions/${sub}/resourcegroups/test/providers/microsoft.compute/virtualmachines/vm`;
const row = (n: string = "one") => ({ id: `/subscriptions/${sub}/providers/Microsoft.Advisor/recommendations/${n}`,
  properties: { recommendationTypeId: "E10B1381-5F0A-47FF-8C7B-37BD13D7C974", resourceMetadata: { resourceId: rid.toUpperCase() },
    shortDescription: { problem: "https://evil.test private text" } } });
const map = (rows: unknown[]) => mapAdvisorRows(rows.map(value => ({ subscriptionId: sub, value })), [rid], "2026-11-11T00:00:00Z");
describe("Advisor parser", () => {
  it("API 자유 문장 없이 정규화된 승인 매핑만 반환한다", () => {
    const result = map([row()]);
    expect(advisorResultSchema.safeParse(result).success).toBe(true);
    expect(result.recommendations[0]).toMatchObject({ resourceId: rid, ruleId: "advisor-vm-sizing" });
    expect(JSON.stringify(result)).not.toMatch(/evil|private text|shortDescription/);
  });
  it("누락/잘못된 GUID/ID/다른 구독/스캔 밖/알 수 없는 유형/중복을 coverage로 센다", () => {
    const good = row();
    const badType = { ...row("two"), properties: { ...good.properties, recommendationTypeId: "https://evil.test" } };
    const missingType = { ...row("three"), properties: { resourceMetadata: { resourceId: rid } } };
    const unknown = { ...row("four"), properties: { ...good.properties, recommendationTypeId: "00000000-0000-0000-0000-000000000099" } };
    const outside = { ...row("five"), properties: { ...good.properties, resourceMetadata: { resourceId: rid + "-deleted" } } };
    const wrongSub = { ...row("six"), id: good.id.replace(sub, "00000000-0000-0000-0000-000000000002") };
    const result = map([good, good, badType, missingType, unknown, outside, wrongSub, {}, { ...good, id: "https://evil.test" }]);
    expect(result.coverage).toMatchObject({ total: 9, included: 1, excluded: 8 });
    expect(result.coverage.reasons).toEqual(expect.arrayContaining([
      { code: "unmapped-advisor-type", count: 2 }, { code: "scope-not-collected", count: 1 },
    ]));
    expect(advisorResultSchema.safeParse(result).success).toBe(true);
  });
  it("리소스 범위 추천과 디스크 seed를 지원하며 잘못된 ID는 제외한다", () => {
    const disk = rid.replace("virtualmachines/vm", "disks/disk");
    const scoped = { ...row(), id: `${disk}/providers/Microsoft.Advisor/recommendations/disk-one`,
      properties: { recommendationTypeId: "48eda464-1485-4dcf-a674-d0905df5054a", resourceMetadata: { resourceId: disk } } };
    expect(mapAdvisorRows([{ subscriptionId: sub, value: scoped }], [disk], "2026-11-11T00:00:00Z").recommendations[0])
      .toMatchObject({ resourceId: disk, ruleId: "advisor-unattached-disk" });
    for (const id of [scoped.id.replace("/test/", "/../"), scoped.id.replace("/test/", "/test\\evil/"),
      scoped.id.replace("/test/", "/test\nsecret/"), "https://evil.test"]) {
      expect(map([{ ...row(), id }]).coverage.included).toBe(0);
    }
  });
  it("누락/다른 구독/타입 불일치/예약 인스턴스를 추측하지 않는다", () => {
    const values = [
      { ...row("a"), properties: { ...row().properties, resourceMetadata: {} } },
      { ...row("b"), properties: { ...row().properties, resourceMetadata: { resourceId: "https://evil.test" } } },
      { ...row("c"), properties: { ...row().properties, resourceMetadata: { resourceId: rid.replace(sub, "00000000-0000-0000-0000-000000000002") } } },
      { ...row("d"), properties: { ...row().properties, recommendationTypeId: "84b1a508-fc21-49da-979e-96894f1665df" } },
    ];
    expect(map(values).coverage).toMatchObject({ total: 4, included: 0, excluded: 4 });
    const disk = rid.replace("virtualmachines/vm", "disks/disk");
    const result = mapAdvisorRows([{ subscriptionId: sub, value: { ...row(), properties: {
      ...row().properties, resourceMetadata: { resourceId: disk } } } }], [disk], "2026-11-11T00:00:00Z");
    expect(result.coverage.reasons).toEqual([{ code: "unsupported-type", count: 1 }]);
  });
  it("리소스 이름이 providers여도 provider 경로와 혼동하지 않는다", () => {
    const resourceId = rid.replace(/vm$/u, "providers");
    const value = { ...row(), properties: { ...row().properties, resourceMetadata: { resourceId } } };
    expect(mapAdvisorRows([{ subscriptionId: sub, value }], [resourceId], "2026-11-11T00:00:00Z").coverage.included).toBe(1);
  });
  it("부적합 페이지를 거절하고 원문 오류를 숨긴다", () => {
    for (const value of [null, {}, { value: {} }, { value: [], nextLink: 1 }, { value: [], nextLink: "" }]) {
      expect(() => parseAdvisorPage(value)).toThrow("Invalid Advisor page.");
    }
    expect(parseAdvisorPage({ value: [], nextLink: null })).toEqual({ value: [], nextLink: null });
  });
});
