import "server-only";
import { buildWorkspaceOverview } from "@/lib/overview/summary";
import { listAnalyses } from "@/services/db/analyses";
import { listAssessments } from "@/services/db/assessments";
import { listExtensions } from "@/services/db/extensions";
import { peekNetworkDiagnostics } from "@/services/db/network-diagnostics";
import { getLatestSucceededScan, listScans } from "@/services/db/scans";
import { getWorkspaceAzureSettings } from "@/services/db/workspace-azure";
import { getWorkspaceClaudeOverview } from "@/services/workspace-setup";
import type { WorkspaceOverview } from "@/types/overview";

/**
 * 현재 워크스페이스의 저장 기록만 읽는다. 모델·가격·Azure 호출이나 다른 워크스페이스 조회는 하지 않는다.
 * 저장 기록도 바꾸지 않는다. 오래된 pending(확장·점검·경로 진단)은 화면 값에서만 실패로 보인다.
 */
export async function loadWorkspaceOverview(workspaceId: string, now: Date = new Date()): Promise<WorkspaceOverview> {
  const [claude, azure, scans, latestScan, assessments, analyses, extensions, network] = await Promise.all([
    getWorkspaceClaudeOverview(workspaceId).catch(() => null),
    getWorkspaceAzureSettings(workspaceId),
    listScans(workspaceId, { limit: 20 }),
    getLatestSucceededScan(workspaceId),
    listAssessments(workspaceId, { limit: 20 }),
    listAnalyses(workspaceId, { limit: 1 }),
    listExtensions(workspaceId, { limit: 1 }),
    peekNetworkDiagnostics(workspaceId, { limit: 1 }),
  ]);
  return buildWorkspaceOverview({
    workspaceId,
    claude: claude ? { needsSetup: claude.needsSetup, available: claude.available } : null,
    azureConnected: Boolean(azure?.connection),
    scans,
    latestScan,
    assessments,
    analyses: analyses.map(({ id, status, createdAt, requestTitle }) => ({ id, status, createdAt, title: requestTitle })),
    extensions: extensions.map(({ id, status, createdAt, result }) => ({ id, status, createdAt, title: result?.requestTitle ?? null })),
    networkDiagnostics: network.map(({ id, status, createdAt, result }) => ({ id, status, createdAt, verdict: result?.engine.verdict ?? null })),
  }, now);
}
