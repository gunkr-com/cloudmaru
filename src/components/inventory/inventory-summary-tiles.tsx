"use client";
import { formatNumber } from "@/i18n/format";
import { useI18n } from "@/i18n/provider";
import { inventoryFacts } from "@/lib/inventory/view";
import type { InventorySummary } from "@/types/inventory";

export function InventorySummaryTiles({ summary }: { summary: InventorySummary }) {
  const { locale, t } = useI18n();
  const facts = inventoryFacts(summary);
  const labels = {
    resources: "inventory.summary.resources",
    subscriptions: "inventory.summary.subscriptions",
    resourceGroups: "inventory.summary.resourceGroups",
    regions: "inventory.summary.regions",
    untagged: "inventory.summary.untagged",
  } as const;
  return <dl className="grid grid-cols-1 gap-3 min-[400px]:grid-cols-2 xl:grid-cols-5">
    {(Object.keys(labels) as (keyof typeof labels)[]).map(key => <div key={key} className="min-w-0 rounded-xl border border-hairline bg-surface-1 p-5">
      <dt className="text-sm text-muted">{t(labels[key])}</dt>
      <dd className="mt-2 break-words text-3xl font-bold tracking-tight text-ink tabular-nums">{formatNumber(facts[key], locale)}</dd>
    </div>)}
  </dl>;
}
