import { describe, expect, it } from "vitest";
import {
  ANALYSIS_HISTORY_PAGE_TITLE,
  ANALYSIS_NOT_FOUND_PAGE_TITLE,
  NOT_FOUND_PAGE_TITLE,
  SITE_NAME,
  buildAnalysisPageTitle,
  buildNewAnalysisPageTitle,
  withSiteName,
} from "./page-titles";
import type { AnalysisResult } from "@/types/analysis";

const createdAt = "2026-10-14T00:00:00.000Z";
const justAfter = new Date("2026-10-14T00:01:00.000Z");
const longAfter = new Date("2026-10-14T01:00:00.000Z");
const result = { requestTitle: { en: "Reservation service", ko: "예약 웹 서비스" } } as AnalysisResult;

describe("withSiteName", () => {
  it("화면 이름 뒤에 서비스 이름을 붙인다", () => {
    expect(SITE_NAME).toBe("CloudMaru");
    expect(withSiteName("분석 기록")).toBe("분석 기록 · CloudMaru");
  });
});

describe("고정 화면 제목", () => {
  it("분석 기록과 없는 페이지 제목", () => {
    expect(ANALYSIS_HISTORY_PAGE_TITLE).toBe("Analysis history · CloudMaru");
    expect(NOT_FOUND_PAGE_TITLE).toBe("Page not found · CloudMaru");
  });

  it("새 분석은 원래 분석을 불러왔을 때만 다시 분석 제목을 쓴다", () => {
    expect(buildNewAnalysisPageTitle({ rerun: false }, "ko")).toBe("새 분석 · CloudMaru");
    expect(buildNewAnalysisPageTitle({ rerun: true }, "ko")).toBe("조건 바꿔 다시 분석 · CloudMaru");
  });
});

describe("buildAnalysisPageTitle", () => {
  it("분석을 찾지 못하면 없는 분석 제목", () => {
    expect(ANALYSIS_NOT_FOUND_PAGE_TITLE).toBe("Analysis not found · CloudMaru");
    expect(buildAnalysisPageTitle(null, justAfter, "en")).toBe(ANALYSIS_NOT_FOUND_PAGE_TITLE);
  });

  it("진행 중이면 분석 중, 제한 시간을 넘긴 pending은 화면처럼 분석 실패", () => {
    const pending = { status: "pending" as const, createdAt, errorStage: null, result: null };
    expect(buildAnalysisPageTitle(pending, justAfter, "ko")).toBe("분석 중 · CloudMaru");
    expect(buildAnalysisPageTitle(pending, longAfter, "ko")).toBe("분석 실패 · CloudMaru");
  });

  it("실패했거나 성공인데 결과가 없으면 분석 실패", () => {
    expect(buildAnalysisPageTitle({ status: "failed", createdAt, errorStage: "llm", result: null }, justAfter, "ko")).toBe("분석 실패 · CloudMaru");
    expect(buildAnalysisPageTitle({ status: "succeeded", createdAt, errorStage: null, result: null }, justAfter, "ko")).toBe("분석 실패 · CloudMaru");
  });

  it("성공하면 요청 제목을 쓰고, 비어 있으면 기록 화면과 같은 대체 제목을 쓴다", () => {
    expect(buildAnalysisPageTitle({ status: "succeeded", createdAt, errorStage: null, result }, longAfter, "ko")).toBe("예약 웹 서비스 · CloudMaru");
    expect(buildAnalysisPageTitle({ status: "succeeded", createdAt, errorStage: null, result: { ...result, requestTitle: { en: "Reservation service", ko: "  예약 웹 서비스 " } } }, justAfter, "ko")).toBe("예약 웹 서비스 · CloudMaru");
    expect(buildAnalysisPageTitle({ status: "succeeded", createdAt, errorStage: null, result: { ...result, requestTitle: { en: "   ", ko: "   " } } }, justAfter, "ko")).toBe("분석 결과 · CloudMaru");
  });
});

it("영어 기본과 한국어 제목을 사전에서 고른다", () => {
  expect(buildNewAnalysisPageTitle({ rerun: false }, "en")).toBe("New analysis · CloudMaru");
  expect(buildAnalysisPageTitle(null, justAfter, "en")).toBe("Analysis not found · CloudMaru");
});

it("영어 기본 문서 제목에 영어 요청 제목을 쓴다", () => {
  expect(buildAnalysisPageTitle({ status: "succeeded", createdAt, errorStage: null, result }, justAfter)).toBe("Reservation service · CloudMaru");
});
