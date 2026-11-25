import { describe, expect, it } from "vitest";
import { buildStartAnalysisBody, getDraftKey, interpretStartAnalysisResponse, START_FALLBACK_MESSAGE, START_UNCONFIRMED_MESSAGE } from "@/lib/analysis/start-request";
import type { AnalysisInput } from "@/types/analysis";

const input: AnalysisInput = { description: "예약 서비스", expectedUsers: "under-1k", monthlyBudget: 300_000, region: "canadacentral", availability: "medium" };
const id = "550e8400-e29b-41d4-a716-446655440000";

describe("start-request", () => {
  it("preserves the owning workspace for a missing-key settings link", () => {
    expect(interpretStartAnalysisResponse(409, { errors: ["workspace.claude.unavailable"], workspaceId: "original-company" })).toEqual({ kind: "error", message: "workspace.claude.unavailable", workspaceId: "original-company" });
  });
  it("builds new and rerun request bodies and draft keys", () => {
    const workspaceId = "6f1c1d2e-1111-4a5b-8c9d-0123456789ab";
    expect(buildStartAnalysisBody(input, null, workspaceId)).toEqual({ input, sourceAnalysisId: null, workspaceId });
    expect(buildStartAnalysisBody(input, id, workspaceId)).toEqual({ input, sourceAnalysisId: id, workspaceId });
    // 새 분석 초안은 워크스페이스마다 따로 둔다. 고객사 A에서 쓰던 요구사항이 B로 넘어가면 안 된다.
    expect(getDraftKey(null, workspaceId)).toBe(`new:${workspaceId}`);
    expect(getDraftKey(null, "other")).not.toBe(getDraftKey(null, workspaceId));
    expect(getDraftKey(id, workspaceId)).toBe(`rerun:${id}`);
  });
  it("accepts 202 only with a UUID", () => {
    expect(interpretStartAnalysisResponse(202, { id })).toEqual({ kind: "started", id });
    expect(interpretStartAnalysisResponse(202, { id: "bad" })).toMatchObject({ kind: "error" });
  });
  it("interprets validation errors and treats retired statuses as generic failures", () => {
    expect(interpretStartAnalysisResponse(400, { errors: ["첫 오류"] })).toEqual({ kind: "error", message: "첫 오류" });
    expect(interpretStartAnalysisResponse(409, { errors: ["워크스페이스가 바뀌었습니다."] })).toEqual({ kind: "error", message: "워크스페이스가 바뀌었습니다." });
    expect(interpretStartAnalysisResponse(400, { errors: [] })).toEqual({ kind: "error", message: START_FALLBACK_MESSAGE });
    for (const status of [401, 429, 503]) expect(interpretStartAnalysisResponse(status, { message: "private" })).toEqual({ kind: "error", message: START_UNCONFIRMED_MESSAGE });
    expect(START_FALLBACK_MESSAGE).not.toMatch(/횟수|차감|로그인|구독/);
  });
  it("예약 여부를 알 수 없는 응답에는 차감되지 않았다고 말하지 않는다", () => {
    const unconfirmed = { kind: "error", message: START_UNCONFIRMED_MESSAGE };
    expect(START_UNCONFIRMED_MESSAGE).not.toContain("차감되지 않았습니다");
    expect(START_UNCONFIRMED_MESSAGE).toBe("analysis.startUnconfirmed");
    // 202는 서버가 이미 예약했다는 뜻이다.
    expect(interpretStartAnalysisResponse(202, { id: "bad" })).toEqual(unconfirmed);
    expect(interpretStartAnalysisResponse(202, null)).toEqual(unconfirmed);
    // 예약 뒤에 실패했을 수 있는 5xx와 알 수 없는 상태는 서버 메시지도 믿지 않는다.
    expect(interpretStartAnalysisResponse(500, undefined)).toEqual(unconfirmed);
    expect(interpretStartAnalysisResponse(500, null)).toEqual(unconfirmed);
    expect(interpretStartAnalysisResponse(500, { message: "분석을 시작하지 못했습니다. 횟수는 차감되지 않았습니다." })).toEqual(unconfirmed);
    expect(interpretStartAnalysisResponse(504, null)).toEqual(unconfirmed);
    expect(interpretStartAnalysisResponse(200, { id })).toEqual(unconfirmed);
    // 플랜 확인 503은 본문 메시지가 있을 때만 서버의 명시적 거절로 본다.
    expect(interpretStartAnalysisResponse(503, null)).toEqual(unconfirmed);
  });
});
