import { z } from "zod";
import { buildInventory } from "@/lib/inventory/build-inventory";
import { parseImportedInventory } from "@/lib/inventory/import";
import type { AzureConnection, ScanApiErrorCode, ScanData, ScanErrorCode, WorkspaceAzureSettings } from "@/types/scan";
import type { Inventory } from "@/types/inventory";
import { toScanErrorCode } from "./map-error";
import { getScanStaleBefore, SCAN_TIMEOUT_MS } from "./timing";

export type { ScanApiErrorCode } from "@/types/scan";
export type StartScanResult =
  | { status: 202; id: string; existing: boolean }
  | { status: 201; id: string }
  | { status: 400 | 409 | 413; code: ScanApiErrorCode }
  | { status: 500; code: "internal" };
type ScanJob = { id: string; workspaceId: string };
type SettingsDeps = { getWorkspaceAzureSettings: (workspaceId: string) => Promise<WorkspaceAzureSettings | null> };
export type StartScanDeps = SettingsDeps & {
  reserveLiveScan: (args: { workspaceId: string; subscriptionIds: string[]; staleBefore: Date }) => Promise<{ id: string; created: boolean }>;
  createImportScan: (args: ScanData & { workspaceId: string }) => Promise<string>;
  schedule: (task: () => Promise<void>) => void;
  runJob: (job: ScanJob) => Promise<void>;
  failScan: (id: string, code: ScanErrorCode) => Promise<void>;
};
export type RunLiveScanDeps = SettingsDeps & {
  createTokenProvider: (connection: AzureConnection) => () => Promise<string>;
  collectInventoryRows: (subscriptionIds: string[], deps: { getToken: () => Promise<string> }) => Promise<{ resourceRows: unknown[]; containerRows: unknown[] }>;
  completeScan: (id: string, data: ScanData) => Promise<void>;
  failScan: (id: string, code: ScanErrorCode) => Promise<void>;
  now: () => Date;
};
const bodySchema = z.discriminatedUnion("source", [
  z.object({ workspaceId: z.string().min(1).max(64), source: z.literal("live") }),
  z.object({ workspaceId: z.string().min(1).max(64), source: z.literal("import"), data: z.unknown().refine(value => value !== undefined) }),
]);
// inventory 컬럼에는 본문만 둔다. 요약·수집 시각은 각자의 컬럼에 저장한다.
// live 스캔은 요청한 구독을 남긴다. 행이 나오지 않은 구독(권한 없음 등)을 "읽지 못한 구독"으로 보여 주기 위해서다.
function scanData(inventory: Inventory, subscriptionIds = inventory.summary.subscriptionIds): ScanData {
  const { resources, containers, relations, skippedRows } = inventory;
  return {
    inventory: { resources, containers, relations, skippedRows },
    summary: inventory.summary, collectedAt: inventory.collectedAt, subscriptionIds,
  };
}

export async function startScan(request: { workspaceId: string; body: unknown; now: Date }, deps: StartScanDeps): Promise<StartScanResult> {
  const parsed = bodySchema.safeParse(request.body);
  if (!parsed.success) return { status: 400, code: "invalid-body" };
  const body = parsed.data;
  if (body.workspaceId !== request.workspaceId) return { status: 409, code: "workspace-changed" };
  try {
    if (body.source === "import") {
      const imported = parseImportedInventory(body.data);
      if (!imported.ok) return { status: 400, code: imported.code };
      const inventory = buildInventory({ source: "import", collectedAt: request.now, resourceRows: imported.rows.resources, containerRows: imported.rows.containers });
      if (!inventory.resources.length) return { status: 400, code: "import-empty" };
      const id = await deps.createImportScan({ workspaceId: request.workspaceId, ...scanData(inventory) });
      return { status: 201, id };
    }
    const settings = await deps.getWorkspaceAzureSettings(request.workspaceId);
    if (!settings?.connection || !settings.subscriptionIds.length) return { status: 409, code: "connection-missing" };
    const reserved = await deps.reserveLiveScan({ workspaceId: request.workspaceId, subscriptionIds: settings.subscriptionIds, staleBefore: getScanStaleBefore(request.now) });
    if (reserved.created) {
      try {
        deps.schedule(() => deps.runJob({ id: reserved.id, workspaceId: request.workspaceId }));
      } catch {
        // 예약한 행을 닫지 않으면 15분 동안 아무도 실행하지 않는 스캔을 진행 중으로 돌려준다.
        await deps.failScan(reserved.id, "internal").catch(() => undefined);
        return { status: 500, code: "internal" };
      }
    }
    return { status: 202, id: reserved.id, existing: !reserved.created };
  } catch {
    return { status: 500, code: "internal" };
  }
}

export async function runLiveScanJob(job: ScanJob, deps: RunLiveScanDeps): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  const timeout = Symbol("timeout");
  const missing = Symbol("connection-missing");
  try {
    await Promise.race([
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => { timedOut = true; reject(timeout); }, SCAN_TIMEOUT_MS);
      }),
      (async () => {
        const settings = await deps.getWorkspaceAzureSettings(job.workspaceId);
        if (timedOut) return;
        if (!settings?.connection || !settings.subscriptionIds.length) throw missing;
        const getToken = deps.createTokenProvider(settings.connection);
        const rows = await deps.collectInventoryRows(settings.subscriptionIds, { getToken });
        // 시간 초과 뒤 돌아온 수집은 저장하지 않는다. DB도 pending 조건으로 최종 상태를 보호한다.
        if (timedOut) return;
        const inventory = buildInventory({ source: "live", collectedAt: deps.now(), ...rows });
        await deps.completeScan(job.id, scanData(inventory, settings.subscriptionIds));
      })(),
    ]);
  } catch (error) {
    const code = error === timeout ? "timeout" : error === missing ? "connection-missing" : toScanErrorCode(error);
    console.warn({ id: job.id, code });
    try { await deps.failScan(job.id, code); } catch { /* stale 판정으로 중단된 작업을 표시한다. */ }
  } finally {
    clearTimeout(timer);
  }
}
