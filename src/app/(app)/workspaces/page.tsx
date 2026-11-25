import { LocalTime } from "@/components/ui/local-time";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { WorkspaceForm } from "@/components/workspace/workspace-form";
import { SUPPORTED_REGIONS } from "@/lib/workspace/regions";
import { getCurrentWorkspace } from "@/services/current-workspace";
import { listWorkspaces } from "@/services/db/workspaces";
import { getWorkspaceAzureSettings } from "@/services/db/workspace-azure";
import { listLatestScanTimes } from "@/services/db/scans";
import { selectWorkspace } from "../workspace-actions";
import { createWorkspaceAction, updateWorkspaceAction } from "./actions";
import { pluralKey } from "@/i18n/translate";
import { getI18n } from "@/i18n/server";
import { withSiteName } from "@/lib/dashboard/page-titles";

export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: withSiteName(t("workspace.title")) };
}

export default async function WorkspacesPage() {
  const { t } = await getI18n();
  const current = await getCurrentWorkspace();
  const workspaces = await listWorkspaces();
  const [settings, scanTimes] = await Promise.all([
    Promise.all(workspaces.map(workspace => getWorkspaceAzureSettings(workspace.id))), listLatestScanTimes(),
  ]);
  return (
    <div className="space-y-10">
      <header className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-[0.6px] text-subtle">{t("workspace.eyebrow")}</p>
        <h1 className="text-[32px] font-bold leading-[1.18] tracking-[-0.8px] text-ink">{t("workspace.title")}</h1>
        <p className="text-sm leading-[1.7] text-muted">{t("workspace.description")}</p>
        <Link href="/setup" className="inline-flex min-h-10 items-center rounded-md text-sm text-ink underline underline-offset-4">{t("setup.title")}</Link>
      </header>
      <section aria-labelledby="workspace-list-title" className="space-y-4">
        <h2 id="workspace-list-title" className="text-xs font-semibold tracking-[0.6px] text-subtle">{t("workspace.list")}</h2>
        <div tabIndex={0} role="region" aria-label={t("workspace.title")} className="relative overflow-x-auto rounded-xl border border-hairline bg-surface-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink">
          <table className="w-full min-w-[1100px] text-left text-sm text-body">
            <thead className="border-b border-border-strong text-xs text-subtle">
              <tr>{[t("workspace.name"), t("workspace.companyName"), t("workspace.defaultRegion"), t("workspace.createdAt"), t("workspace.connection"), t("workspace.lastScan"), t("workspace.manage")].map(label => <th key={label} scope="col" className="bg-surface-2 px-3 py-3 font-semibold first:sticky first:left-0 first:z-10">{label}</th>)}</tr>
            </thead>
            <tbody>
              {workspaces.map((workspace, index) => <tr key={workspace.id} className="border-b border-hairline align-top">
                <th scope="row" className="sticky left-0 z-10 w-48 max-w-48 break-words border-r border-hairline bg-surface-1 px-3 py-3 font-semibold text-ink">{workspace.name}{workspace.id === current.id && <span className="ml-2 inline-block rounded-full bg-surface-2 px-2 py-1 text-xs">{t("workspace.current")}</span>}</th>
                <td className="max-w-48 break-words px-3 py-3">{workspace.companyName ?? "—"}</td>
                <td className="px-3 py-3">{SUPPORTED_REGIONS.find(region => region.id === workspace.defaultRegion)?.label ?? workspace.defaultRegion}</td>
                <td className="whitespace-nowrap px-3 py-3 tabular-nums"><LocalTime value={workspace.createdAt} format="date" /></td>
                <td className="min-w-48 px-3 py-3">
                  <p>{settings[index]?.connection ? t(pluralKey(settings[index]!.subscriptionIds.length, "workspace.connectedOne", "workspace.connected"), { count: settings[index]!.subscriptionIds.length }) : t("workspace.notConnected")}</p>
                  <Link href={`/workspaces/${workspace.id}/connection`} className="mt-1 inline-flex min-h-8 items-center rounded-md text-ink underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink">
                    {settings[index]?.connection ? t("inventory.actions.editConnection") : t("inventory.actions.setUpConnection")}<span className="sr-only">: {workspace.name}</span>
                  </Link>
                </td>
                <td className="whitespace-nowrap px-3 py-3 tabular-nums">{scanTimes[workspace.id] ? <LocalTime value={scanTimes[workspace.id]} format="datetime" /> : "—"}</td>
                <td className="min-w-52 px-3 py-3">
                  <div className="space-y-3">
                    <Link href={`/workspaces/${workspace.id}/claude`} className="inline-flex min-h-8 items-center rounded-md text-ink underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink">
                      {t("workspace.claude.title")}<span className="sr-only">: {workspace.name}</span>
                    </Link>
                    {workspace.id !== current.id && <form action={selectWorkspace}>
                      <input type="hidden" name="workspaceId" value={workspace.id} />
                      <Button variant="secondary" size="sm" type="submit">{t("workspace.select")}</Button>
                    </form>}
                    <details>
                      <summary className="min-h-8 cursor-pointer rounded-md py-1 text-ink underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink">{t("workspace.edit")}<span className="sr-only">: {workspace.name}</span></summary>
                      <div className="mt-3"><WorkspaceForm action={updateWorkspaceAction} workspace={workspace} /></div>
                    </details>
                  </div>
                </td>
              </tr>)}
            </tbody>
          </table>
        </div>
      </section>
      <section aria-labelledby="workspace-create-title" className="max-w-xl space-y-4">
        <h2 id="workspace-create-title" className="text-xs font-semibold tracking-[0.6px] text-subtle">{t("workspace.createTitle")}</h2>
        <WorkspaceForm action={createWorkspaceAction} />
      </section>
    </div>
  );
}
