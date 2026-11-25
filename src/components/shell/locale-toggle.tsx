"use client";
import { useTransition, type JSX } from "react";
import { setLocale } from "@/app/(app)/locale-actions";
import { useI18n } from "@/i18n/provider";
import { LOCALES } from "@/i18n/locale";
export function LocaleToggle(): JSX.Element {
  const { locale, t } = useI18n();
  const [pending, startTransition] = useTransition();
  return <div role="group" aria-label={t("common.language")} className="inline-flex h-8 shrink-0 self-start rounded-lg border border-control">
    {LOCALES.map(value => <button key={value} type="button" lang={value} aria-pressed={locale === value} disabled={pending} onClick={() => {
      if (value === locale) return;
      // 쿠키 쓰기 응답이 현재 경로를 다시 그린다. 제공자와 폼을 remount하지 않는다.
      startTransition(async () => { await setLocale(value); });
    }} className={`min-w-10 rounded-[7px] px-2 text-[13px] font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink ${locale === value ? "bg-ink text-canvas" : "text-body"}`}>{t(`common.languages.${value}`)}</button>)}
  </div>;
}
