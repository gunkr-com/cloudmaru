"use client";

import { useRef, useState, type JSX } from "react";
import { useRouter } from "next/navigation";
import { AnalysisForm } from "@/components/analysis/analysis-form";
import { buildStartAnalysisBody, getDraftKey, interpretStartAnalysisResponse, START_UNCONFIRMED_MESSAGE, type StartAnalysisClientOutcome } from "@/lib/analysis/start-request";
import type { AnalysisInput } from "@/types/analysis";

export type NewAnalysisClientProps = {
  defaultRegion?: string;
  defaultValues?: AnalysisInput;
  sourceAnalysisId: string | null;
  workspaceId: string;
};

export function NewAnalysisClient({ defaultRegion, defaultValues, sourceAnalysisId, workspaceId }: NewAnalysisClientProps): JSX.Element {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const [errorMessage, setErrorMessage] = useState<string>();
  const [errorWorkspaceId, setErrorWorkspaceId] = useState<string>();

  async function onSubmit(input: AnalysisInput): Promise<boolean> {
    if (pendingRef.current) return false;
    pendingRef.current = true;
    setPending(true);
    setErrorMessage(undefined);
    setErrorWorkspaceId(undefined);
    let outcome: StartAnalysisClientOutcome;
    try {
      const response = await fetch("/api/analyses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildStartAnalysisBody(input, sourceAnalysisId, workspaceId)),
      });
      let body: unknown = null;
      try { body = await response.json(); } catch { body = null; }
      outcome = interpretStartAnalysisResponse(response.status, body);
    } catch {
      // 요청이 서버에 닿아 예약됐는지 알 수 없다.
      outcome = { kind: "error" as const, message: START_UNCONFIRMED_MESSAGE };
    }

    if (outcome.kind === "started") {
      router.push(`/analyses/${outcome.id}`);
      // 공유 레이아웃의 API 비용도 다음 서버 렌더에서 다시 읽는다.
      // refresh는 라우터 큐에서 이동 다음에 실행되어 새 경로의 레이아웃까지 다시 그린다.
      router.refresh();
      return true;
    }
    setErrorMessage(outcome.message);
    setErrorWorkspaceId(outcome.workspaceId);
    pendingRef.current = false;
    setPending(false);
    return false;
  }

  // 사이드바로 워크스페이스를 바꾸면 같은 경로로 돌아와 이 컴포넌트가 그대로 남는다.
  // 초안 키로 폼을 다시 마운트해야 이전 워크스페이스의 입력이 새 초안에 저장되지 않는다.
  const draftKey = getDraftKey(sourceAnalysisId, workspaceId);
  return <AnalysisForm
    key={draftKey}
    workspaceId={errorWorkspaceId ?? workspaceId}
    defaultRegion={defaultRegion}
    defaultValues={defaultValues}
    onSubmit={onSubmit}
    draftKey={draftKey}
    mode={sourceAnalysisId ? "rerun" : "new"}
    sourceHref={sourceAnalysisId ? `/analyses/${sourceAnalysisId}` : undefined}
    pending={pending}
    errorMessage={errorMessage}
  />;
}
