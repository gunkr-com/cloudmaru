import "server-only";
import { cookies } from "next/headers";
import type { Locale } from "@/types/i18n";
import { LOCALE_COOKIE, parseLocale } from "./locale";
import { createTranslator, type Translate } from "./translate";
export async function getLocale(): Promise<Locale> { return parseLocale((await cookies()).get(LOCALE_COOKIE)?.value); }
export async function getI18n(): Promise<{ locale: Locale; t: Translate }> {
  const locale = await getLocale();
  return { locale, t: createTranslator(locale) };
}
