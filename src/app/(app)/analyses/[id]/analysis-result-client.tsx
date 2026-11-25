"use client";

import { useEffect, useState, type JSX } from "react";
import { AnalysisResultView } from "@/components/analysis/analysis-result-view";
import { ArtifactsSection } from "@/components/artifacts/artifacts-section";
import type { ArtifactView } from "@/lib/artifacts/artifact-job";
import { buildResultHref, buildRerunHref, RESULT_FOCUS_FLAG_PREFIX } from "@/lib/dashboard/result-links";
import type { AnalysisResult } from "@/types/analysis";
import type { Tier } from "@/types/catalog";

export type AnalysisResultClientProps = {
  id: string;
  result: AnalysisResult;
  createdAt: string;
  initialTier: Tier;
  initialArtifacts: ArtifactView[];
};

export function AnalysisResultClient({ id, result, createdAt, initialTier, initialArtifacts }: AnalysisResultClientProps): JSX.Element {
  const [tier, setTier] = useState(initialTier);
  const [focusHeading, setFocusHeading] = useState(false);
  useEffect(() => {
    let timer: number | undefined;
    try {
      const key = `${RESULT_FOCUS_FLAG_PREFIX}${id}`;
      if (window.sessionStorage.getItem(key) !== null) {
        // 표시는 타이머가 실제로 돌 때 지운다. StrictMode는 effect를 실행·정리·재실행하는데,
        // 첫 실행에서 지우면 정리가 타이머를 취소한 뒤 재실행이 표시를 찾지 못해 포커스를 놓친다.
        timer = window.setTimeout(() => {
          try { window.sessionStorage.removeItem(key); } catch { /* storage may be unavailable */ }
          setFocusHeading(true);
        }, 0);
      }
    } catch { /* storage may be unavailable */ }
    return () => { if (timer !== undefined) window.clearTimeout(timer); };
  }, [id]);

  return (
    <AnalysisResultView
      result={result}
      selectedTier={tier}
      onSelectTier={(nextTier) => {
        setTier(nextTier);
        // 서버 페이지를 다시 실행하지 않고 URL만 바꾼다. Next.js가 history API 호출을 useSearchParams와 맞춘다.
        window.history.replaceState(null, "", buildResultHref(id, nextTier));
      }}
      createdAt={createdAt}
      rerunHref={buildRerunHref(id)}
      reportId={id}
      showBuildAction
      focusHeadingOnMount={focusHeading}
      renderArtifacts={(plan) => <div className="scroll-mt-6">
        <ArtifactsSection analysisId={id} plan={plan} initialArtifacts={initialArtifacts} />
      </div>}
    />
  );
}
