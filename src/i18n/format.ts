import type { Locale } from "@/types/i18n";
export type Currency = "CAD" | "USD";
export function formatNumber(value: number, locale: Locale, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(locale === "ko" ? "ko-KR" : "en-CA", options).format(value);
}
export function formatMoney(amount: number, currency: Currency, locale: Locale, options?: { maximumFractionDigits?: number }): string {
  const digits = options?.maximumFractionDigits ?? (currency === "USD" ? 2 : 0);
  const value = formatNumber(Math.abs(amount), locale, { maximumFractionDigits: digits, minimumFractionDigits: Math.min(2, digits) });
  // 반올림으로 0이 되는 음수에는 부호를 붙이지 않는다.
  const sign = amount < 0 && /[1-9]/.test(value) ? "-" : "";
  return `${sign}${currency === "CAD" ? "CA$" : "US$"}${value}`;
}
export function formatMonthlyMoney(amount: number, currency: Currency, locale: Locale): string {
  return `${formatMoney(amount, currency, locale, { maximumFractionDigits: 0 })}/${locale === "ko" ? "월" : "mo"}`;
}
export function formatPercent(ratio: number, locale: Locale): string {
  return formatNumber(ratio, locale, { style: "percent", maximumFractionDigits: 0 });
}
export function formatDate(value: string | Date, locale: Locale): string {
  const date = typeof value === "string" ? new Date(value) : value;
  const part = (number: number, width: number) => formatNumber(number, locale, { useGrouping: false, minimumIntegerDigits: width });
  return `${part(date.getFullYear(), 4)}-${part(date.getMonth() + 1, 2)}-${part(date.getDate(), 2)}`;
}

export function formatDateTime(value: string | Date, locale: Locale): string {
  const date = typeof value === "string" ? new Date(value) : value;
  const part = (number: number) => formatNumber(number, locale, { useGrouping: false, minimumIntegerDigits: 2 });
  return `${formatDate(date, locale)} ${part(date.getHours())}:${part(date.getMinutes())}`;
}
