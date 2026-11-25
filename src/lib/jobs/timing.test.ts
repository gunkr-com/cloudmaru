import { describe, expect, it } from "vitest";
import {
  JOB_MAX_DURATION_SECONDS,
  JOB_STALE_AFTER_SECONDS,
  getStaleBefore,
  isJobStale,
} from "@/lib/jobs/timing";

const now = new Date("2026-10-14T03:00:00.000Z");

describe("작업 시간 설정", () => {
  it("오래된 작업 기준은 라우트 최대 실행 시간보다 길다", () => {
    expect(JOB_MAX_DURATION_SECONDS).toBe(300);
    expect(JOB_STALE_AFTER_SECONDS).toBeGreaterThan(JOB_MAX_DURATION_SECONDS);
  });
});

describe("getStaleBefore", () => {
  it("지금에서 오래된 작업 기준 시간을 뺀 시각이다", () => {
    expect(getStaleBefore(now).getTime()).toBe(now.getTime() - JOB_STALE_AFTER_SECONDS * 1000);
  });
});

describe("isJobStale", () => {
  it("기준 시각보다 먼저 만든 작업은 오래된 작업이다", () => {
    const created = new Date(now.getTime() - (JOB_STALE_AFTER_SECONDS + 1) * 1000).toISOString();
    expect(isJobStale(created, now)).toBe(true);
  });

  it("기준 시각 이후에 만든 작업은 아직 유효하다", () => {
    const created = new Date(now.getTime() - (JOB_STALE_AFTER_SECONDS - 1) * 1000).toISOString();
    expect(isJobStale(created, now)).toBe(false);
  });

  it("날짜로 읽을 수 없는 값이면 오래된 작업으로 본다", () => {
    expect(isJobStale("not-a-date", now)).toBe(true);
  });
});
