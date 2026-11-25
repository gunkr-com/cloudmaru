import { getI18n, getLocale } from "@/i18n/server";
import { cache, type JSX } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AnalysisFailed } from "@/components/analysis/analysis-failed";
import { AnalysisPending } from "@/components/analysis/analysis-pending";
import { JourneySteps } from "@/components/analysis/journey-steps";
import { resolveAnalysisStatus } from "@/lib/analysis/analysis-job";
import { toArtifactViews } from "@/lib/artifacts/artifact-job";
import { buildAnalysisPageTitle } from "@/lib/dashboard/page-titles";
import { buildRerunHref, parseTierParam } from "@/lib/dashboard/result-links";
import { getAnalysis } from "@/services/db/analyses";
import { listArtifacts } from "@/services/db/artifacts";
import { AnalysisResultClient } from "./analysis-result-client";
import { AnalysisStatusPoller } from "./analysis-status-poller";

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

const getCachedAnalysis = cache(getAnalysis);

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// 문서 제목은 본문과 같은 판정(resolveAnalysisStatus)으로 고른다. 분석 중 화면은 폴러의 router.refresh()로
// 결과가 되는데, 이때 이 함수도 다시 실행되어 제목이 바뀌고 Next의 경로 알림이 새 제목을 읽는다.
// 본문과 같은 요청에서 React cache된 조회를 같이 쓰므로 DB를 더 읽지 않는다.
// 잘못된 ID는 저장소가 DB에 묻지 않고 null을 돌려준다. 조회가 실패하면 본문이 오류 화면을 그리므로 기본 제목으로 둔다.
export async function generateMetadata({ params }: Pick<PageProps, "params">): Promise<Metadata> {
  const { id } = await params;
  try {
    return { title: buildAnalysisPageTitle(await getCachedAnalysis(id), new Date(), await getLocale()) };
  } catch {
    return {};
  }
}

export default async function AnalysisPage({ params, searchParams }: PageProps): Promise<JSX.Element> {
  const { t } = await getI18n();
  const { id } = await params;
  if (!uuidPattern.test(id)) notFound();
  const record = await getCachedAnalysis(id);
  if (!record) notFound();

  const resolved = resolveAnalysisStatus(record, new Date());
  if (resolved.status === "pending") {
    return (
      <div className="space-y-8">
        <JourneySteps current="compare" />
        <h1 className="text-[32px] leading-[1.18] font-bold tracking-[-0.8px] text-ink">{t("analysis.pendingTitle")}</h1>
        <AnalysisPending input={record.input} createdAt={record.createdAt} />
        <AnalysisStatusPoller id={id} createdAt={record.createdAt} />
      </div>
    );
  }
  if (resolved.status === "failed" || !record.result) {
    return (
      <div className="space-y-8">
        <JourneySteps current="input" />
        <h1 className="text-[32px] leading-[1.18] font-bold tracking-[-0.8px] text-ink">{t("analysis.failedTitle")}</h1>
        <AnalysisFailed reason={resolved.failureReason ?? "failed"} retryHref={buildRerunHref(id)} input={record.input} />
      </div>
    );
  }

  const records = await listArtifacts(id).catch((error: unknown) => {
    const code = typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : undefined;
    console.warn("Artifact list lookup failed", { code });
    return [];
  });
  const initialArtifacts = toArtifactViews(records, new Date());
  const query = await searchParams;
  return (
    <div className="space-y-8">
      <JourneySteps current="compare" />
      {process.env.CLOUDSIGHT_DEMO === "1" && <p className="text-sm text-subtle">{t("pricing.syntheticDemo")}</p>}
      <AnalysisResultClient
        id={id}
        result={record.result}
        createdAt={record.createdAt}
        initialTier={parseTierParam(query.tier) ?? record.result.recommendedTier}
        initialArtifacts={initialArtifacts}
      />
    </div>
  );
}
