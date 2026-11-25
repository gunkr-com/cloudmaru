"use client";

import { useI18n } from "@/i18n/provider";
import Link from "next/link";
import type { JSX } from "react";

// DashboardShell의 <main id="main"> 안에 그려지므로 main 랜드마크와 화면 높이를 따로 잡지 않는다.
export default function DashboardError({ retry }: { error: Error & { digest?: string }; retry: () => void }): JSX.Element {
  const { t } = useI18n();
  return (
    <div className="flex max-w-xl flex-col gap-5 py-12">
      <section role="alert" className="space-y-3">
        <h1 className="text-2xl font-semibold text-ink">{t("common.loadError")}</h1>
        <p className="text-sm leading-relaxed text-muted">{t("common.loadErrorHelp")}</p>
      </section>
      <div className="flex flex-wrap items-center gap-4">
        <button type="button" onClick={retry} className="min-h-10 rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-canvas focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink">{t("common.retry")}</button>
        <Link href="/analyses/new" className="text-sm text-ink underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink">{t("common.newAnalysis")}</Link>
      </div>
    </div>
  );
}
