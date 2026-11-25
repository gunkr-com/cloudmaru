import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DRAFT_STORAGE_PREFIX } from "@/lib/form/draft";
import { useAnalysisDraft } from "@/components/analysis/use-analysis-draft";

describe("useAnalysisDraft", () => {
  beforeEach(() => sessionStorage.clear());

  it("sessionStorage에서 읽고 쓰고 지운다", () => {
    const { result } = renderHook(() => useAnalysisDraft("one"));
    const draft = { description: "예약 서비스", expectedUsers: "under-10k", monthlyBudget: "1,500,000", region: "canadacentral", availability: "medium" };
    act(() => result.current.write(draft));
    expect(sessionStorage.getItem(`${DRAFT_STORAGE_PREFIX}one`)).toBe(JSON.stringify(draft));
    expect(result.current.read()).toEqual(draft);
    act(() => result.current.clear());
    expect(result.current.read()).toBeNull();
  });

  it("키가 없거나 저장소가 예외를 던지면 조용히 무시한다", () => {
    const { result: noKey } = renderHook(() => useAnalysisDraft(undefined));
    expect(noKey.current.read()).toBeNull();
    act(() => noKey.current.write({ description: "", expectedUsers: "", monthlyBudget: "", region: "canadacentral", availability: "" }));
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
    const { result } = renderHook(() => useAnalysisDraft("one"));
    act(() => result.current.write({ description: "", expectedUsers: "", monthlyBudget: "", region: "canadacentral", availability: "" }));
    expect(() => result.current.read()).not.toThrow();
    setItem.mockRestore();
  });
});
