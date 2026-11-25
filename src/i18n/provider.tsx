"use client";
import { createContext, useContext, useMemo, type JSX, type ReactNode } from "react";
import type { Locale } from "@/types/i18n";
import { createTranslator, type Translate } from "./translate";
const I18nContext = createContext<{ locale: Locale; t: Translate } | null>(null);
export function I18nProvider({ locale, children }: { locale: Locale; children: ReactNode }): JSX.Element {
  const value = useMemo(() => ({ locale, t: createTranslator(locale) }), [locale]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
export function useI18n(): { locale: Locale; t: Translate } {
  const value = useContext(I18nContext);
  if (!value) throw new Error("useI18n must be used within I18nProvider");
  return value;
}
