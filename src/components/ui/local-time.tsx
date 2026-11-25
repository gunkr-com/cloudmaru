"use client";
import { useSyncExternalStore, type JSX } from "react";
import { formatDate, formatDateTime } from "@/i18n/format";
import { useI18n } from "@/i18n/provider";

type TimeFormat = "date" | "datetime";
const subscribe = () => () => {};

/**
 * 날짜·시각을 브라우저 시간대로 그린다. 서버(Node의 tz 데이터)와 브라우저(macOS)가 같은 시간대의 오프셋을
 * 다르게 계산할 수 있어(2026-11 America/Vancouver), 서버가 그리면 시각이 틀리고 하이드레이션이 어긋난다.
 * 서버 HTML과 하이드레이션 첫 렌더는 빈 <time>이고, 그 직후 브라우저에서 채운다.
 */
export function LocalTime({ value, format }: { value: string; format: TimeFormat }): JSX.Element {
  const { locale } = useI18n();
  const text = useSyncExternalStore(subscribe, () => (format === "date" ? formatDate : formatDateTime)(value, locale), () => "");
  return <time dateTime={value}>{text}</time>;
}

/** 번역된 문장의 {slot} 자리에 LocalTime을 끼운다. 문장은 slot 값을 넘기지 않고 번역해 자리표시자를 남겨 둔다. */
export function TextWithLocalTime({ text, value, format, slot = "date" }: { text: string; value: string; format: TimeFormat; slot?: string }): JSX.Element {
  const marker = `{${slot}}`;
  const index = text.indexOf(marker);
  if (index < 0) return <>{text}</>;
  return <>{text.slice(0, index)}<LocalTime value={value} format={format} />{text.slice(index + marker.length)}</>;
}
