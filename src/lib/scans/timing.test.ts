import { describe, expect, it } from "vitest";
import { SCAN_TIMEOUT_MS, SCAN_STALE_AFTER_SECONDS, getScanStaleBefore, resolveScanStatus } from "./timing";

describe("스캔 시간 제한", () => {
  const now = new Date("2026-11-06T12:00:00Z");
  it("수집은 10분, stale은 15분이다", () => {
    expect(SCAN_TIMEOUT_MS).toBe(600_000);
    expect(SCAN_STALE_AFTER_SECONDS).toBe(900);
    expect(getScanStaleBefore(now).toISOString()).toBe("2026-11-06T11:45:00.000Z");
  });
  it.each(["2026-11-06T11:44:59Z", "invalid"])("오래되거나 잘못된 pending 시각 %s는 복사해 interrupted로 보여 준다", createdAt => {
    const record = Object.freeze({ id: "scan", status: "pending" as const, createdAt, errorCode: null });
    expect(resolveScanStatus(record, now)).toEqual({ ...record, status: "failed", errorCode: "interrupted" });
    expect(record.status).toBe("pending");
  });
  it.each(["pending", "succeeded", "failed"] as const)("경계 시각과 최종 상태 %s는 유지한다", status => {
    const record = { status, createdAt: "2026-11-06T11:45:00Z", errorCode: null };
    expect(resolveScanStatus(record, now)).toEqual(record);
    if (status !== "pending") expect(resolveScanStatus({ ...record, createdAt: "2020-01-01" }, now).status).toBe(status);
  });
});
