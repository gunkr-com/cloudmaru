import Link from "next/link";
import { getI18n } from "@/i18n/server";
import { withSiteName } from "@/lib/dashboard/page-titles";
import { getCurrentWorkspace } from "@/services/current-workspace";
import { getWorkspaceClaudeOverview } from "@/services/workspace-setup";
import { getAzureLocalDiagnostic } from "@/services/workspace-azure-diagnostics";
import { AzureDiagnostics } from "@/components/workspace/azure-diagnostics";
import { Button } from "@/components/ui/button";
import { continueLocalAction, testAzureAction } from "./actions";

export async function generateMetadata() { const {t} = await getI18n(); return {title:withSiteName(t("setup.title"))}; }
export default async function SetupPage({searchParams}: {searchParams: Promise<{error?: string}>}) {
 const query = await searchParams;
 const [{t},workspace] = await Promise.all([getI18n(),getCurrentWorkspace()]);
 const [overview, azure] = await Promise.all([getWorkspaceClaudeOverview(workspace.id).catch(()=>null),getAzureLocalDiagnostic(workspace.id)]);
 const linkClass = "inline-flex min-h-10 items-center rounded-md text-sm text-ink underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink";
 return <div className="max-w-3xl space-y-8">
  <header className="space-y-3"><p className="break-words text-sm text-subtle">{workspace.name}</p><h1 className="text-[32px] font-bold tracking-tight text-ink">{t("setup.title")}</h1><p className="text-sm leading-relaxed text-muted">{t("setup.description")}</p></header>
  {query.error === "storage" && <p role="alert" className="text-sm text-warning">{t("setup.storage")}</p>}
  <section className="space-y-3"><h2 className="text-lg font-semibold text-ink">{t("setup.workspaceStep")}</h2><p className="text-sm leading-relaxed text-muted">{t("setup.workspaceHelp")}</p><Link className={linkClass} href="/workspaces">{t("setup.manageWorkspaces")}</Link></section>
  <section className="space-y-3"><h2 className="text-lg font-semibold text-ink">{t("setup.aiStep")}</h2><p className="text-sm text-muted">{t(!overview ? "setup.storage" : overview.available ? "setup.available" : "setup.unavailable")}</p><Link className={linkClass} href={`/workspaces/${workspace.id}/claude`}>{t("setup.openClaude")}</Link>
   <form action={continueLocalAction}><input type="hidden" name="workspaceId" value={workspace.id}/><Button type="submit" variant="secondary">{t("setup.disabledSource")}</Button></form>
  </section>
  <section className="space-y-3"><h2 className="text-lg font-semibold text-ink">{t("setup.azureStep")}</h2><p className="text-sm leading-relaxed text-muted">{t("setup.azureHelp")}</p><Link className={linkClass} href={`/workspaces/${workspace.id}/connection`}>{t("setup.openAzure")}</Link><AzureDiagnostics workspaceId={workspace.id} initial={azure} action={testAzureAction}/></section>
  <p className="text-sm leading-relaxed text-muted">{t("setup.localHelp")}</p><Link className={linkClass} href="/inventory">{t("setup.continueLocal")}</Link>
 </div>;
}
