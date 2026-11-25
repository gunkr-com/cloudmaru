import { describe, expect, it } from "vitest";
import { isEmptyDraft, parseDraft, serializeDraft, type AnalysisDraft } from "@/lib/form/draft";

const draft: AnalysisDraft = {
  description: "예약 서비스",
  expectedUsers: "under-10k",
  monthlyBudget: "1,500,000", region: "canadacentral",
  availability: "medium",
};

describe("analysis draft", () => {
  it("직렬화한 초안을 왕복한다", () => {
    expect(parseDraft(serializeDraft(draft))).toEqual(draft);
  });

  it.each(["{", "[]", "null", JSON.stringify({ ...draft, description: 1 })])("잘못된 값 %s는 무시한다", (raw) => {
    expect(parseDraft(raw)).toBeNull();
  });

  it("지역이 없는 이전 초안은 버린다", () => {
    const old: Partial<AnalysisDraft> = { ...draft };
    delete old.region;
    expect(parseDraft(JSON.stringify(old))).toBeNull();
  });

  it("알 수 없는 선택지는 빈 값으로 초기화한다", () => {
    expect(parseDraft(JSON.stringify({ ...draft, expectedUsers: "many", availability: "always" }))).toEqual({ ...draft, expectedUsers: "", availability: "", region: "canadacentral" });
  });

  it("비어 있는 초안을 판정한다", () => {
    expect(isEmptyDraft({ description: "", expectedUsers: "", monthlyBudget: "", availability: "", region: "canadacentral" })).toBe(true);
    expect(isEmptyDraft(draft)).toBe(false);
  });
});
