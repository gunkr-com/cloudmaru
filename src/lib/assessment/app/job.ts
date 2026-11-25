import { evaluateAssessmentRules } from "@/lib/assessment/rules/engine";
import { compareScans } from "@/lib/inventory/diff";
import { assessmentInputSchema, validateAssessmentResult, validateAssessmentSources } from "./storage-validation";
import type { AssessmentInput, AssessmentRecord, AssessmentSnapshot } from "./storage-validation";
import type { AssessmentInsights, AssessmentInsightsDeps, AssessmentInsightsInput } from "@/services/azure/insights";
import type { AzureConnection, WorkspaceAzureSettings } from "@/types/scan";
import type { AssessmentResult } from "@/types/assessment";
import type { CompletionReasonCode } from "@/types/completion";

// 전체 실행 3분, 프로세스 중단 판정 5분. 선택 transport는 1초 먼저 닫아
// phase14가 이미 받은 행/기간을 partial 또는 성공 상태로 조립할 시간을 남긴다.
export const ASSESSMENT_TIMEOUT_MS = 180_000;
export const ASSESSMENT_STALE_MS = 300_000;
export function getAssessmentStaleBefore(now: Date): Date { return new Date(now.getTime() - ASSESSMENT_STALE_MS); }
export function isAssessmentStale(record: {status:string;createdAt:string}, now:Date): boolean {
  return record.status === "pending" && Date.parse(record.createdAt) <= getAssessmentStaleBefore(now).getTime();
}
type SourceDeps = { loadSnapshot: (id: string) => Promise<AssessmentSnapshot | null> };
type Fail = (id: string, code: CompletionReasonCode) => Promise<boolean>;
export type StartAssessmentDeps = SourceDeps & {
  reserveAssessment: (input: AssessmentInput) => Promise<{ id: string; status: "pending"; created: true } | null>;
  schedule: (task: () => Promise<void>) => void;
  runJob: (id: string) => Promise<void>;
  failAssessment: Fail;
};
export type StartAssessmentResult = { status: 202; id: string }
  | { status: 400 | 409 | 500; code: "invalid-body" | "workspace-changed" | "invalid-source" | "internal" };

export async function startAssessment(request: { workspaceId: string; body: unknown }, deps: StartAssessmentDeps): Promise<StartAssessmentResult> {
  const parsed = assessmentInputSchema.safeParse(request.body);
  if (!parsed.success) return { status: 400, code: "invalid-body" };
  const input = parsed.data;
  if (input.workspaceId !== request.workspaceId) return { status: 409, code: "workspace-changed" };
  try {
    const source = await deps.loadSnapshot(input.sourceScanId);
    const previous = input.previousScanId === null ? null : await deps.loadSnapshot(input.previousScanId);
    try {
      if (!source) throw new Error();
      validateAssessmentSources(input, source, previous);
    } catch { return { status: 409, code: "invalid-source" }; }
    const reserved = await deps.reserveAssessment(input);
    if (!reserved) return { status: 409, code: "invalid-source" };
    try { deps.schedule(() => deps.runJob(reserved.id)); }
    catch {
      await deps.failAssessment(reserved.id, "internal");
      return { status: 500, code: "internal" };
    }
    return { status: 202, id: reserved.id };
  } catch { return { status: 500, code: "internal" }; }
}

export type RunAssessmentDeps = SourceDeps & {
  getAssessment: (id: string) => Promise<AssessmentRecord | null>;
  getWorkspaceAzureSettings: (workspaceId: string) => Promise<WorkspaceAzureSettings | null>;
  prepareTransport: (connection: AzureConnection, signal: AbortSignal) => AssessmentInsightsDeps;
  collectInsights: (input: AssessmentInsightsInput, transport: AssessmentInsightsDeps | null) => Promise<AssessmentInsights>;
  completeAssessment: (id: string, result: AssessmentResult) => Promise<boolean>;
  failAssessment: Fail;
  now: () => Date;
};

/** I/O는 주입된 services만 사용한다. worker에는 cookie/최신 스캔/모델 의존성이 없다. */
export async function runAssessmentJob(id: string, deps: RunAssessmentDeps): Promise<void> {
  const controller = new AbortController();
  const timeout = Symbol("timeout");
  let stopped = false;
  const state: { local: AssessmentResult | null } = { local: null };
  let failureCode: CompletionReasonCode = "internal";
  const timer = setTimeout(() => controller.abort(), ASSESSMENT_TIMEOUT_MS - 1_000);
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<typeof timeout>(resolve => {
    watchdog = setTimeout(() => { stopped = true; controller.abort(); resolve(timeout); }, ASSESSMENT_TIMEOUT_MS);
  });
  try {
    const outcome = await Promise.race([deadline, (async (): Promise<AssessmentResult | null> => {
      const row = await deps.getAssessment(id);
      if (stopped || !row || row.status !== "pending") return null;
      failureCode = "validation-failed";
      const now = deps.now();
      if (row.id !== id || !Number.isFinite(now.getTime()) || !Number.isFinite(Date.parse(row.createdAt))
        || Date.parse(row.createdAt) > now.getTime()
        || row.workspaceId !== row.input.workspaceId || row.sourceScanId !== row.input.sourceScanId
        || row.previousScanId !== row.input.previousScanId) throw new Error();
      if (isAssessmentStale(row,now)) {
        failureCode = "interrupted"; throw new Error();
      }
      failureCode = "internal";
      const source = await deps.loadSnapshot(row.sourceScanId);
      if (stopped) return null;
      const previous = row.previousScanId === null ? null : await deps.loadSnapshot(row.previousScanId);
      if (stopped) return null;
      failureCode = "validation-failed";
      if (!source) throw new Error();
      const { sourceScan } = validateAssessmentSources(row.input, source, previous);
      const evaluatedAt = deps.now().toISOString();
      const binding = { id, input: row.input, createdAt: row.createdAt, source, previous };
      const failed = { state: "failed", reason: "internal" } as const;
      state.local = validateAssessmentResult({ schemaVersion: 1, id, workspaceId: row.workspaceId, sourceScanId: row.sourceScanId,
        sourceScan, createdAt: row.createdAt, local: evaluateAssessmentRules(source.inventory.resources, evaluatedAt),
        advisor: sourceScan.source === "import" ? { state: "unavailable", reason: "not-supported" } : failed,
        actualCost: { schemaVersion: 1, monthToDate: sourceScan.source === "import" ? { state: "unavailable", reason: "not-supported" } : failed,
          trailing30Days: sourceScan.source === "import" ? { state: "unavailable", reason: "not-supported" } : failed },
        diff: previous ? { state: "available", data: compareScans(previous, source, evaluatedAt) } : { state: "not-requested" },
        roadmap: { state: "not-requested" } }, binding);
      // 로컬 계산·검증은 연결 조회/인증서 준비보다 먼저 끝난다.
      try {
        let transport: AssessmentInsightsDeps | null = null;
        if (sourceScan.source === "live") {
          const settings = await deps.getWorkspaceAzureSettings(row.workspaceId);
          if (stopped) return null;
          if (settings?.connection && sourceScan.subscriptionIds.every(subscription => settings.subscriptionIds.includes(subscription))) {
            transport = deps.prepareTransport(settings.connection, controller.signal);
          }
        }
        const insights = await deps.collectInsights({ scan: source.scan, inventory: source.inventory,
          requested: { advisor: true, actualCost: true }, retrievedAt: deps.now().toISOString() }, transport);
        if (stopped) return null;
        // 각 영역을 별도로 검증한다. 잘못된 선택 응답 하나가 다른 성공이나 로컬을 지우지 않는다.
        let result = state.local;
        const invalid = { state: "failed", reason: "invalid-response" } as const;
        const advisor = insights?.advisor;
        try { result = validateAssessmentResult({ ...result, advisor }, binding); }
        catch { if (sourceScan.source !== "import") result = { ...result, advisor: invalid }; }
        for (const key of ["monthToDate", "trailing30Days"] as const) {
          try { result = validateAssessmentResult({ ...result, actualCost: { ...result.actualCost, [key]: insights?.actualCost?.[key] } }, binding); }
          catch { if (sourceScan.source !== "import") result = { ...result, actualCost: { ...result.actualCost, [key]: invalid } }; }
        }
        return validateAssessmentResult(result, binding);
      } catch { return state.local; }
    })()]);
    stopped = true;
    failureCode = "internal";
    if (outcome === timeout) {
      if (state.local) {
        const failed = { state: "failed", reason: "timeout" } as const;
        // import에는 I/O가 없고 저장 계약이 not-supported를 요구한다.
        const result = state.local.sourceScan.source === "import" ? state.local : { ...state.local, advisor: failed,
          actualCost: { schemaVersion: 1 as const, monthToDate: failed, trailing30Days: failed } };
        await deps.completeAssessment(id, result);
      } else await deps.failAssessment(id, "timeout");
    } else if (outcome) await deps.completeAssessment(id, outcome);
  } catch {
    stopped = true;
    await deps.failAssessment(id, failureCode).catch(() => undefined);
  } finally {
    stopped = true; controller.abort(); clearTimeout(timer); clearTimeout(watchdog);
  }
}
