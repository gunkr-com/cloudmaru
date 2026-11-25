import type { Locale } from "@/types/i18n";
export const LOCALES = ["en", "ko"] as const satisfies readonly Locale[];
export const DEFAULT_LOCALE: Locale = "en";
export const LOCALE_COOKIE = "cs_locale";
export function parseLocale(value: unknown): Locale { return value === "ko" ? "ko" : DEFAULT_LOCALE; }
