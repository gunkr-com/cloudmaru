"use client";
import { useEffect, useState } from "react";
import { useI18n } from "@/i18n/provider";

export function ScanPending({ createdAt }: { createdAt: string }) {
  const { t } = useI18n();
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const update = () => setElapsed(Math.max(0, Math.floor((Date.now() - Date.parse(createdAt)) / 1000)));
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [createdAt]);
  return <section className="space-y-4">
    <p role="status" className="text-base font-semibold text-ink">{t(elapsed >= 300 ? "inventory.pending.longRunning" : "inventory.pending.message")}</p>
    <div role="progressbar" aria-label={t("inventory.pending.progress")} className="h-2 overflow-hidden rounded-full bg-progress-track motion-reduce:hidden">
      <div className="progress-indeterminate h-full w-1/3 rounded-full bg-ink" />
    </div>
    <p className="text-sm tabular-nums text-subtle"><span className="sr-only">{t("inventory.pending.elapsed")}</span>{Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")}</p>
    <div className="space-y-1 text-[13px] leading-[1.7] text-subtle">
      <p>{t("inventory.pending.explanation")}</p>
      <p>{t("inventory.pending.leave")}</p>
    </div>
  </section>;
}
