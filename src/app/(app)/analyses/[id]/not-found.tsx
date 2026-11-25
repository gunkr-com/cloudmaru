import { getI18n } from "@/i18n/server";
import type { JSX } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { withSiteName } from "@/lib/dashboard/page-titles";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: withSiteName(t("shell.titles.analysisNotFound")) };
}

export default async function AnalysisNotFound(): Promise<JSX.Element> {
  const { t } = await getI18n();
  return (
    <div className="space-y-5">
      <h1 className="text-[32px] leading-[1.18] font-bold tracking-[-0.8px] text-ink">{t("common.analysisNotFound")}</h1>
      <p className="text-sm leading-[1.7] text-body">{t("common.analysisNotFoundHelp")}</p>
      <div className="flex flex-wrap items-center gap-5">
        <Link href="/analyses" className="inline-flex min-h-10 items-center rounded-lg bg-ink px-[18px] text-sm font-semibold text-canvas focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink">{t("common.analysisHistory")}</Link>
        <Link href="/analyses/new" className="text-sm text-ink underline underline-offset-[3px]">{t("common.newAnalysis")}</Link>
      </div>
    </div>
  );
}
