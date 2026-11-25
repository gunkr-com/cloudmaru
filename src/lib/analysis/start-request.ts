import { z } from "zod";
import type { AnalysisInput } from "@/types/analysis";

export type StartAnalysisClientOutcome =
  | { kind: "started"; id: string }
  | { kind: "error"; message: string; workspaceId?: string };

export const START_FALLBACK_MESSAGE = "analysis.startFallback";
export const START_UNCONFIRMED_MESSAGE = "analysis.startUnconfirmed";

// workspaceId는 폼을 연 워크스페이스다. 서버가 제출 시점의 현재 워크스페이스와 비교한다.
export function buildStartAnalysisBody(input: AnalysisInput, sourceAnalysisId: string | null, workspaceId: string): { input: AnalysisInput; sourceAnalysisId: string | null; workspaceId: string } {
  return { input, sourceAnalysisId, workspaceId };
}

export function interpretStartAnalysisResponse(status: number, body: unknown): StartAnalysisClientOutcome {
  if (status === 202) {
    const id = typeof body === "object" && body !== null && "id" in body ? (body as { id?: unknown }).id : undefined;
    return typeof id === "string" && z.uuid().safeParse(id).success ? { kind: "started", id } : { kind: "error", message: START_UNCONFIRMED_MESSAGE };
  }
  if (status === 400 || status === 409) {
    const errors = typeof body === "object" && body !== null && "errors" in body ? (body as { errors?: unknown }).errors : undefined;
    const first = Array.isArray(errors) ? errors[0] : undefined;
    const workspaceId = typeof body === "object" && body !== null && "workspaceId" in body ? (body as { workspaceId?: unknown }).workspaceId : undefined;
    return { kind: "error", message: typeof first === "string" && first.trim() ? first : START_FALLBACK_MESSAGE, ...(typeof workspaceId === "string" && workspaceId ? { workspaceId } : {}) };
  }
  return { kind: "error", message: START_UNCONFIRMED_MESSAGE };
}

// 새 분석 초안은 워크스페이스마다 따로 둔다. 고객사 A에서 쓰던 요구사항이 B를 고른 뒤에도 남아
// B의 분석으로 저장되면 안 된다. 다시 분석 초안은 원 분석 ID가 이미 한 워크스페이스에 속한다.
export function getDraftKey(sourceAnalysisId: string | null, workspaceId: string): string {
  return sourceAnalysisId ? `rerun:${sourceAnalysisId}` : `new:${workspaceId}`;
}
