"use client";
import { LocalTime } from "@/components/ui/local-time";
import { useI18n } from "@/i18n/provider";
import type { JSX } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import type { HistoryRow } from "@/lib/dashboard/history";
import type { Tier } from "@/types/catalog";

export type HistoryListProps = { rows: HistoryRow[] };

const tierClasses = {
  low: { label: "text-tier-low", dot: "bg-tier-low" },
  balanced: { label: "text-tier-balanced", dot: "bg-tier-balanced" },
  ha: { label: "text-tier-ha", dot: "bg-tier-ha" },
} as const satisfies Record<Tier, { label: string; dot: string }>;

export function HistoryList({ rows }: HistoryListProps): JSX.Element {
  const { t } = useI18n();
  if (rows.length === 0) {
    return <section className="space-y-5 rounded-xl border border-hairline bg-surface-1 p-6 sm:p-8">
      <p className="text-sm text-body">{t("analysis.emptyHistory")}</p>
      <div className="flex flex-wrap items-center gap-5">
        <Link href="/analyses/new" className="inline-flex min-h-10 items-center rounded-md bg-ink px-[18px] text-sm font-semibold text-canvas hover:brightness-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink">{t("common.newAnalysis")}</Link>
      </div>
    </section>;
  }

  return <ul className="space-y-3">
    {rows.map((row) => {
      const colors = row.recommended ? tierClasses[row.recommended.tier] : null;
      return <li key={row.id} className="group relative flex flex-col gap-4 rounded-xl border border-hairline bg-surface-1 p-5 hover:brightness-105 sm:p-6 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0 space-y-2">
          <h2 className="text-base font-semibold text-ink"><Link href={row.href} className="after:absolute after:inset-0 after:rounded-xl after:content-[''] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink">{row.title}</Link></h2>
          <p className="text-[13px] leading-[1.6] text-subtle"><LocalTime value={row.createdAt} format="date" /> · {row.conditionSummary}</p>
        </div>
        <div className="relative z-10 flex shrink-0 flex-wrap items-center gap-x-5 gap-y-2 text-sm">
          {row.recommended && colors ? <>
            <span className={cn("inline-flex items-center gap-1.5 text-xs font-semibold tracking-[0.6px] uppercase", colors.label)}>
              <span aria-hidden="true" className={cn("size-2 shrink-0 rounded-full", colors.dot)} />{row.recommended.tierLabel}
            </span>
            <span className="font-semibold text-ink tabular-nums">{row.recommended.monthlyLabel}</span>
          </> : <span className="text-body">{row.statusLabel}</span>}
          {row.status !== "pending" && <Link href={row.rerunHref} className="inline-flex min-h-6 items-center text-ink underline underline-offset-[3px] hover:brightness-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink">{t("analysis.rerun")}</Link>}
        </div>
      </li>;
    })}
  </ul>;
}
