import Link from "next/link";
import { getI18n } from "@/i18n/server";
import { CONNECTION_ERROR_CODES, scanErrorMessageKey } from "@/lib/scans/error-messages";
import type { ScanErrorCode, ScanSource } from "@/types/scan";
import { ScanControls } from "./scan-controls";

export async function ScanFailed({ workspaceId, source, errorCode, isCurrentWorkspace }: {
  workspaceId: string; source: ScanSource; errorCode: ScanErrorCode | null; isCurrentWorkspace: boolean;
}) {
  const { t } = await getI18n();
  const code = errorCode ?? "internal";
  return <div className="space-y-4">
    <p role="alert" className="text-sm leading-[1.7] text-warning">{t(scanErrorMessageKey(code))}</p>
    {source === "live" && CONNECTION_ERROR_CODES.includes(code) && <Link href={`/workspaces/${workspaceId}/connection`} className="inline-flex min-h-8 items-center text-sm text-ink underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink">{t("inventory.actions.editConnection")}</Link>}
    {source === "live" ? isCurrentWorkspace
      ? <ScanControls workspaceId={workspaceId} canRunScan showImport={false} runLabel="common.retry" />
      : <p className="text-sm text-muted">{t("inventory.failed.otherWorkspace")}</p>
      : <Link href="/inventory" className="inline-flex min-h-8 items-center text-sm text-ink underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink">{t("inventory.connection.form.goToInventory")}</Link>}
  </div>;
}
