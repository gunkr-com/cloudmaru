import { describe, expect, it } from "vitest";
import { toHistoryRow } from "@/lib/dashboard/history";
import type { AnalysisListItem } from "@/types/db";

const base: AnalysisListItem = {
  id: "analysis-1", workspaceId: "workspace-1", status: "succeeded",
  input: { description: "개인 정보가 있을 수 있는 원문 설명", expectedUsers: "under-10k", monthlyBudget: 300_000, region: "canadacentral", availability: "medium" },
  requestTitle: { en: "Reservation service", ko: "예약 서비스" }, recommendedTier: "balanced", recommendedMonthly: 286_700,
  sourceAnalysisId: null, createdAt: "2026-10-06T11:00:00Z",
};

describe("analysis history rows", () => {
  it("formats successful rows without exposing the input description", () => {
    expect(toHistoryRow(base, new Date("2026-10-07T00:00:00Z"), "ko")).toEqual({
      id: "analysis-1", href: "/analyses/analysis-1", rerunHref: "/analyses/new?from=analysis-1",
      title: "예약 서비스", createdAt: "2026-10-06T11:00:00Z", status: "succeeded", statusLabel: null,
      recommended: { tier: "balanced", tierLabel: "균형", monthlyLabel: "CA$286,700/월" },
      conditionSummary: "사용자 10,000명 이하 · 월 예산 CA$300,000/월 · 가용성 보통 · Canada Central",
    });
  });

  it("uses a safe fallback title and omits recommendation when incomplete", () => {
    expect(toHistoryRow({ ...base, requestTitle: { en: "", ko: "" }, recommendedMonthly: null }, new Date(), "ko").title).toBe("분석 결과");
    expect(toHistoryRow({ ...base, recommendedTier: null }, new Date(), "ko").recommended).toBeNull();
  });

  it("marks active and stale pending rows with resolved status", () => {
    const pending = { ...base, status: "pending" as const, requestTitle: null, recommendedTier: null, recommendedMonthly: null };
    expect(toHistoryRow(pending, new Date("2026-10-06T11:01:00Z"), "ko")).toMatchObject({ title: "분석 중인 요청", status: "pending", statusLabel: "분석 중", recommended: null });
    expect(toHistoryRow(pending, new Date("2026-10-07T00:00:00Z"), "ko")).toMatchObject({ title: "분석하지 못한 요청", status: "failed", statusLabel: "실패", recommended: null });
  });

  it("shows failed status without using the input as its title", () => {
    expect(toHistoryRow({ ...base, status: "failed", requestTitle: null }, new Date(), "ko")).toMatchObject({ title: "분석하지 못한 요청", statusLabel: "실패", recommended: null });
  });
});

it("영어 기록의 상태와 조건을 번역한다", () => {
  const row = toHistoryRow({ ...base, status: "failed" }, new Date(), "en");
  expect(row.title).toBe("Failed analysis");
  expect(row.statusLabel).toBe("Failed");
  expect(row.conditionSummary).toContain("Users: Up to 10,000");
});

it("성공한 요청 제목은 현재 언어로 고른다", () => {
  expect(toHistoryRow(base, new Date(), "en").title).toBe("Reservation service");
  expect(toHistoryRow(base, new Date(), "ko").title).toBe("예약 서비스");
});
