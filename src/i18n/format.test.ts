import { describe, expect, it } from "vitest";
import { formatMoney, formatMonthlyMoney, formatNumber, formatPercent, formatDate, formatDateTime } from "./format";
describe.each(["en", "ko"] as const)("format %s", locale => {
  it("통화 기호와 0·음수·반올림 경계를 고정한다", () => {
    expect(formatMoney(62.5, "CAD", locale, { maximumFractionDigits: 2 })).toBe("CA$62.50");
    expect(formatMoney(0, "CAD", locale, { maximumFractionDigits: 2 })).toBe("CA$0.00");
    expect(formatMoney(1234, "CAD", locale)).toBe("CA$1,234");
    expect(formatMoney(0, "CAD", locale)).toBe("CA$0");
    expect(formatMoney(-1234.5, "CAD", locale)).toBe("-CA$1,235");
    expect(formatMoney(0.42, "USD", locale)).toBe("US$0.42");
    expect(formatMoney(0, "USD", locale)).toBe("US$0.00");
    expect(formatMoney(-0.004, "USD", locale)).toBe("US$0.00");
    expect(formatMoney(1.235, "USD", locale)).toBe("US$1.24");
    expect(formatMoney(0.12345, "CAD", locale, { maximumFractionDigits: 4 })).toBe("CA$0.1235");
    expect(formatMonthlyMoney(1234.5, "CAD", locale)).toBe(locale === "en" ? "CA$1,235/mo" : "CA$1,235/월");
  });
  it("숫자·비율·현지 날짜를 표시한다", () => {
    expect(formatNumber(1234.5, locale)).toBe("1,234.5");
    expect(formatNumber(1.234, locale, { maximumFractionDigits: 2 })).toBe("1.23");
    expect(formatPercent(1.4, locale)).toBe("140%");
    expect(formatPercent(123.456, locale)).toBe("12,346%");
    expect(formatPercent(-0.014, locale)).toBe("-1%");
    expect(formatDate(new Date(2026, 10, 5, 23, 59), locale)).toBe("2026-11-05");
    const date = new Date(2026, 0, 2, 0, 1);
    expect(formatDate(date.toISOString(), locale)).toBe("2026-01-02");
  });
});

it("formats dates in the process time zone", () => {
  const original = process.env.TZ;
  try {
    process.env.TZ = "America/Vancouver";
    expect(formatDate("2026-10-07T03:30:00Z", "en")).toBe("2026-10-06");
    process.env.TZ = "Asia/Seoul";
    expect(formatDate("2026-10-06T15:30:00Z", "ko")).toBe("2026-10-07");
  } finally {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  }
});

it.each([[0, "US$0.00"], [0.42, "US$0.42"], [12.3, "US$12.30"], [0.126, "US$0.13"]] as const)("formats API cost %s", (value, expected) => {
  expect(formatMoney(value, "USD", "en")).toBe(expected);
});

describe.each(["en", "ko"] as const)("날짜·시각 %s", locale => {
  it("현지 24시간 시각을 초 없이 채운다", () => {
    expect(formatDateTime(new Date(2026, 10, 7, 14, 5, 59), locale)).toBe("2026-11-07 14:05");
    expect(formatDateTime(new Date(2026, 0, 2, 0, 1).toISOString(), locale)).toBe("2026-01-02 00:01");
  });
  it("프로세스 시간대의 날짜와 시각을 쓴다", () => {
    const original = process.env.TZ;
    try {
      // 일광 절약 시간 규칙은 tzdata 버전마다 다를 수 있어(예: BC 영구 일광 절약 시간) 고정 오프셋 시간대를 쓴다.
      process.env.TZ = "Etc/GMT+8";
      expect(formatDateTime("2026-11-08T02:05:59Z", locale)).toBe("2026-11-07 18:05");
      process.env.TZ = "Asia/Seoul";
      expect(formatDateTime("2026-11-08T02:05:59Z", locale)).toBe("2026-11-08 11:05");
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
  });
});
