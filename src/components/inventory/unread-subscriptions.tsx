"use client";
import { useI18n } from "@/i18n/provider";
import { formatNumber } from "@/i18n/format";
import { pluralKey } from "@/i18n/translate";
import { unreadSubscriptions } from "@/lib/inventory/view";
import type { InventorySummary } from "@/types/inventory";

export function UnreadSubscriptions({ subscriptionIds, summary }: { subscriptionIds: readonly string[]; summary: InventorySummary }) {
  const { locale, t } = useI18n();
  const unread = unreadSubscriptions(subscriptionIds, summary);
  if (!unread.length) return null;
  return <section className="space-y-2 text-sm text-body">
    <h3 className="font-semibold text-ink">{t("inventory.summary.unreadTitle")}</h3>
    <p className="leading-[1.7]">{t(pluralKey(unread.length, "inventory.summary.unreadOne", "inventory.summary.unread"), { count: formatNumber(unread.length, locale) })}</p>
    <ul className="space-y-1">{unread.map((id, index) => <li key={index} className="break-all font-mono text-xs">{id}</li>)}</ul>
  </section>;
}
