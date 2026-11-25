import { TextWithLocalTime } from "@/components/ui/local-time";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { AzureConnectionForm } from "@/components/workspace/azure-connection-form";
import { AzureDiagnostics } from "@/components/workspace/azure-diagnostics";
import { getAzureLocalDiagnostic } from "@/services/workspace-azure-diagnostics";
import { testAzureAction } from "../../../setup/actions";
import { getI18n } from "@/i18n/server";
import { withSiteName } from "@/lib/dashboard/page-titles";
import { scanErrorMessageKey } from "@/lib/scans/error-messages";
import { checkConnectionCertificate } from "@/services/azure/credential";
import { getCurrentWorkspace } from "@/services/current-workspace";
import { getWorkspace } from "@/services/db/workspaces";
import { getWorkspaceAzureSettings } from "@/services/db/workspace-azure";
import { removeAzureConnectionAction, saveAzureConnectionAction } from "./actions";

const WORKSPACE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string; removed?: string; error?: string }> };

export async function generateMetadata({ params }: Pick<Props, "params">) {
  const [{ id }, { t }] = await Promise.all([params, getI18n()]);
  const found = WORKSPACE_ID.test(id) && await getWorkspace(id);
  return { title: withSiteName(t(found ? "inventory.titles.connection" : "shell.titles.notFound")) };
}

export default async function AzureConnectionPage({ params, searchParams }: Props) {
  const { id } = await params;
  if (!WORKSPACE_ID.test(id)) notFound();
  const workspace = await getWorkspace(id);
  if (!workspace) notFound();
  const [{ t }, current, settings, query] = await Promise.all([
    getI18n(), getCurrentWorkspace(), getWorkspaceAzureSettings(workspace.id), searchParams,
  ]);
  const certificate = settings?.connection ? await checkConnectionCertificate(settings.connection) : null;
  const linkClass = "inline-flex min-h-8 items-center rounded-md text-sm text-ink underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink";
  return (
    <div className="max-w-2xl space-y-8">
      <header className="space-y-3">
        <p className="break-words text-xs font-semibold uppercase tracking-[0.6px] text-subtle">{t("inventory.connection.form.eyebrow", { name: workspace.name })}</p>
        <h1 className="text-[32px] font-bold leading-[1.18] tracking-[-0.8px] text-ink">{t("inventory.connection.form.title")}</h1>
        <p className="text-sm leading-[1.7] text-muted">{t("inventory.connection.form.description")}</p>
      </header>
      <p className={`text-sm leading-[1.7] ${certificate && !certificate.ok ? "text-warning" : "text-muted"}`}>
        {certificate ? certificate.ok
          ? <TextWithLocalTime text={t("inventory.connection.certificateValid")} value={certificate.validTo} format="date" />
          : t(scanErrorMessageKey(certificate.code))
          : t("workspace.notConnected")}
      </p>
      {query.saved === "1" && <p role="status" className="text-sm text-body">{t("inventory.connection.form.saved")}</p>}
      {query.removed === "1" && <p role="status" className="text-sm text-body">{t("inventory.connection.form.removed")}</p>}
      {query.error === "save" && <p role="alert" className="text-sm text-warning">{t("inventory.connection.form.errors.save")}</p>}
      {/* 저장·삭제 뒤 같은 경로로 돌아오면 폼이 다시 마운트되지 않으므로, 저장된 설정이 바뀔 때 새로 만든다. */}
      <AzureConnectionForm key={JSON.stringify(settings)} workspaceId={workspace.id} settings={settings} action={saveAzureConnectionAction} />
      <AzureDiagnostics key={`diagnostics-${JSON.stringify(settings)}`} workspaceId={workspace.id} initial={await getAzureLocalDiagnostic(workspace.id)} action={testAzureAction}/>
      {settings?.connection && <form action={removeAzureConnectionAction}>
        <input type="hidden" name="workspaceId" value={workspace.id} />
        <Button type="submit" variant="secondary">{t("inventory.connection.form.remove")}</Button>
      </form>}
      <nav className="flex flex-wrap gap-x-6 gap-y-3">
        <Link href="/workspaces" className={linkClass}>{t("inventory.connection.form.backToWorkspaces")}</Link>
        {workspace.id === current.id && <Link href="/inventory" className={linkClass}>{t("inventory.connection.form.goToInventory")}</Link>}
      </nav>
    </div>
  );
}
