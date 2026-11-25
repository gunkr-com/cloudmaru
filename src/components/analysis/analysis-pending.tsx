"use client";
import { useI18n } from "@/i18n/provider";

import { useEffect, useState, type JSX } from "react";
import { InputSummary } from "@/components/analysis/input-summary";
import type { AnalysisInput } from "@/types/analysis";

export type AnalysisPendingProps = {
  input: AnalysisInput;
  createdAt: string;
  now?: () => number;
};

function formatElapsed(milliseconds: number): string {
  const totalSeconds = Math.floor(Math.max(0, milliseconds) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

export function AnalysisPending({ input, createdAt, now = Date.now }: AnalysisPendingProps): JSX.Element {
  const { t } = useI18n();
  const [elapsedMilliseconds, setElapsedMilliseconds] = useState(0);

  useEffect(() => {
    const updateElapsed = () => setElapsedMilliseconds(Math.max(0, now() - Date.parse(createdAt)));
    updateElapsed();
    const timer = window.setInterval(updateElapsed, 1000);
    return () => window.clearInterval(timer);
  }, [createdAt, now]);

  const isLongRunning = elapsedMilliseconds >= 120_000;

  return (
    <div className="space-y-8">
      <section aria-label={t("analysis.pendingSection")} className="space-y-4">
        <p role="status" className="text-base font-semibold text-ink">
          {isLongRunning ? t("analysis.longRunning") : t("analysis.pendingMessage")}
        </p>
        <div role="progressbar" aria-label={t("analysis.pendingProgress")} className="h-2 overflow-hidden rounded-full bg-progress-track motion-reduce:hidden">
          <div className="progress-indeterminate h-full w-1/3 rounded-full bg-ink" />
        </div>
        <p className="text-sm tabular-nums text-subtle"><span className="sr-only">{t("analysis.elapsed")}</span>{formatElapsed(elapsedMilliseconds)}</p>
        <div className="space-y-1 text-[13px] leading-[1.7] text-subtle">
          <p>{t("analysis.pendingExplanation")}</p>
          <p>{t("analysis.leaveMessage")}</p>
        </div>
      </section>
      <InputSummary input={input} />
    </div>
  );
}
