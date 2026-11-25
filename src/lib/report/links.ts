import type { Locale } from "@/types/i18n";
import type { Tier } from "@/types/catalog";

/**
 * Report link for a saved Build/Extend record. It names only the record, UI language and selected
 * option; the report route resolves the owner from the saved record, never from the URL or cookie.
 */
export function reportHref(kind: "build" | "extend", id: string, options: { locale: Locale; tier: Tier }): string {
  const query = new URLSearchParams({ lang: options.locale, tier: options.tier });
  return `/${kind === "build" ? "analyses" : "extensions"}/${encodeURIComponent(id)}/report?${query}`;
}
