import { acquireOperatorPrices } from "@/services/operator-prices";
import { getI18n, getLocale } from "@/i18n/server";
import { cache, type JSX } from "react";
import type { Metadata } from "next";
import { JourneySteps } from "@/components/analysis/journey-steps";
import { NewAnalysisClient } from "@/app/(app)/analyses/new/new-analysis-client";
import { buildNewAnalysisPageTitle } from "@/lib/dashboard/page-titles";
import { getCurrentWorkspace } from "@/services/current-workspace";
import { getAnalysis } from "@/services/db/analyses";
import type { AnalysisInput } from "@/types/analysis";

const getCachedAnalysis = cache(getAnalysis);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type SearchParams = { [key: string]: string | string[] | undefined };
type NewAnalysisPageProps = { searchParams: Promise<SearchParams> };

function parseSourceId(params: SearchParams): string | null {
  return typeof params.from === "string" && UUID.test(params.from) ? params.from : null;
}

// 문서 제목은 h1과 같은 조건(원래 분석을 실제로 불러왔는지)으로 고른다. 본문과 같은 요청에서 React cache된
// 조회를 같이 쓰므로 DB를 더 읽지 않는다. 조회가 실패하면 본문이 오류 화면을 그리므로 여기서는 새 분석 제목으로 둔다.
export async function generateMetadata({ searchParams }: NewAnalysisPageProps): Promise<Metadata> {
  const from = parseSourceId(await searchParams);
  const source = from ? await getCachedAnalysis(from).catch(() => null) : null;
  return { title: buildNewAnalysisPageTitle({ rerun: source !== null }, await getLocale()) };
}

export default async function NewAnalysisPage({ searchParams }: NewAnalysisPageProps): Promise<JSX.Element> {
  const { t } = await getI18n();
  const params = await searchParams;
  const from = parseSourceId(params);
  const [source, workspace, pricing] = await Promise.all([from ? getCachedAnalysis(from) : null, getCurrentWorkspace(), acquireOperatorPrices()]);
  const sourceAnalysisId = source ? from : null;
  const defaultValues: AnalysisInput | undefined = source ? source.input : undefined;

  return <div className="space-y-10">
    <JourneySteps current="input" />
    <section className="space-y-6">
      <h1 className="text-[32px] font-bold leading-[1.18] tracking-[-0.8px] text-ink">{sourceAnalysisId ? t("analysis.rerun") : t("common.newAnalysis")}</h1>
      {!pricing.ok && <p role="status" className="text-sm text-warning">{t("pricing.unavailable")}</p>}
      <NewAnalysisClient key={workspace.id} defaultRegion={workspace.defaultRegion} defaultValues={defaultValues} sourceAnalysisId={sourceAnalysisId} workspaceId={workspace.id} />
    </section>
  </div>;
}
