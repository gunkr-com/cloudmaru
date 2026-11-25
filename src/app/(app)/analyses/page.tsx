import { getI18n } from "@/i18n/server";
import type { JSX } from "react";
import type { Metadata } from "next";
import { HistoryList } from "@/components/analysis/history-list";
import { toHistoryRow } from "@/lib/dashboard/history";
import { withSiteName } from "@/lib/dashboard/page-titles";
import { listAnalyses } from "@/services/db/analyses";
import { getCurrentWorkspace } from "@/services/current-workspace";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: withSiteName(t("shell.titles.history")) };
}

export default async function AnalysisHistoryPage(): Promise<JSX.Element> {
  const { locale, t } = await getI18n();
  const workspace = await getCurrentWorkspace();

  const items = await listAnalyses(workspace.id);
  const rows = items.map((item) => toHistoryRow(item, new Date(), locale));

  return <section className="space-y-6">
    <header className="space-y-2">
      <p className="text-xs font-semibold tracking-[0.6px] text-subtle">{t("common.analysisHistory")}</p>
      <h1 className="text-[32px] leading-[1.18] font-bold tracking-[-0.8px] text-ink">{t("common.analysisHistory")}</h1>
    </header>
    <HistoryList rows={rows} />
  </section>;
}
