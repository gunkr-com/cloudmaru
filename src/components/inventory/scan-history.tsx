"use client";
import { LocalTime } from "@/components/ui/local-time";
import Link from "next/link";
import { useI18n } from "@/i18n/provider";
import { formatNumber } from "@/i18n/format";
import { scanErrorMessageKey } from "@/lib/scans/error-messages";
import type { ScanRecord } from "@/types/scan";

export function ScanHistory({ scans }: { scans: readonly ScanRecord[] }) {
  const { locale, t } = useI18n();
  if (!scans.length) return <p className="text-sm text-body">{t("inventory.history.empty")}</p>;
  const columns = "md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,2fr)_minmax(0,0.7fr)]";
  return <div className="space-y-3">
    <div aria-hidden="true" className={"hidden gap-5 border-b border-strong px-5 pb-3 text-xs font-semibold uppercase tracking-[0.6px] text-subtle md:grid " + columns}>
      <span>{t("inventory.history.date")}</span><span>{t("inventory.history.source")}</span><span>{t("inventory.history.status")}</span><span className="text-right">{t("inventory.history.resources")}</span>
    </div>
    <ul className="space-y-3">{scans.map(scan => <li key={scan.id} className={"relative grid min-w-0 gap-3 rounded-xl border border-hairline bg-surface-1 p-5 text-sm hover:brightness-105 md:gap-5 " + columns}>
      <Link href={"/inventory/scans/" + scan.id} className="min-w-0 text-ink tabular-nums after:absolute after:inset-0 after:rounded-xl after:content-[''] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink">
        <span className="sr-only">{t("inventory.history.date")} · </span><LocalTime value={scan.createdAt} format="datetime" />
      </Link>
      <p className="min-w-0 break-words text-body"><span className="sr-only">{t("inventory.history.source")} · </span>{t(scan.source === "live" ? "inventory.source.live" : "inventory.source.import")}</p>
      <div className="min-w-0 space-y-1">
        <p className="text-body"><span className="sr-only">{t("inventory.history.status")} · </span>{t(`inventory.status.${scan.status}`)}</p>
        {scan.status === "failed" && <p className="text-[13px] leading-[1.7] text-muted">{t(scanErrorMessageKey(scan.errorCode ?? "internal"))}</p>}
      </div>
      <p className="break-words text-ink tabular-nums md:text-right"><span className="text-subtle md:sr-only">{t("inventory.history.resources")} · </span>{scan.status === "succeeded" && scan.summary ? formatNumber(scan.summary.resourceCount, locale) : "—"}</p>
    </li>)}</ul>
  </div>;
}
