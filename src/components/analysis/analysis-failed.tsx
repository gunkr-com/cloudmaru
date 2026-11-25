"use client";
import { useI18n } from "@/i18n/provider";
import type { JSX } from "react";
import { InputSummary } from "@/components/analysis/input-summary";
import type { AnalysisInput } from "@/types/analysis";

export type AnalysisFailedProps = {
  reason: "failed" | "timeout";
  retryHref: string;
  input?: AnalysisInput;
};

const MESSAGES = {
  failed: "analysis.failedMessage",
  timeout: "analysis.timeoutMessage",
} as const;

export function AnalysisFailed({ reason, retryHref, input }: AnalysisFailedProps): JSX.Element {
  const { t } = useI18n();
  return (
    <div className="space-y-8">
      <div className="space-y-4">
        <p role="alert" className="text-sm leading-[1.7] text-warning">{t(MESSAGES[reason])}</p>
        <a href={retryHref} className="inline-flex min-h-10 items-center rounded-lg bg-ink px-[18px] text-sm font-semibold text-canvas focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink">{t("common.retry")}</a>
      </div>
      {input && <InputSummary input={input} />}
    </div>
  );
}
