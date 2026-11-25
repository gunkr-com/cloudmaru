"use server";
import { cookies } from "next/headers";
import { LOCALE_COOKIE, parseLocale } from "@/i18n/locale";
export async function setLocale(locale: unknown): Promise<void> {
  (await cookies()).set(LOCALE_COOKIE, parseLocale(locale), { path: "/", sameSite: "lax", httpOnly: true, maxAge: 365 * 24 * 60 * 60 });
}
