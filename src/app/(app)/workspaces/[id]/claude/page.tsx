import Link from "next/link";
import { notFound } from "next/navigation";
import { SetupClaudeForm } from "@/components/workspace/setup-claude-form";
import { getI18n } from "@/i18n/server";
import { withSiteName } from "@/lib/dashboard/page-titles";
import { getWorkspace } from "@/services/db/workspaces";
import { getWorkspaceClaudeSettings } from "@/services/db/workspace-claude";
import { getWorkspaceClaudeOverview } from "@/services/workspace-setup";
import { saveSetupAction, testClaudeAction } from "../../../setup/actions";

type Props = { params: Promise<{ id: string }> };
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: withSiteName(t("setup.claudeTitle")) };
}
export default async function ClaudeKeyPage({ params }: Props) {
  const { id } = await params;
  if (!uuidPattern.test(id)) notFound();
  const workspace = await getWorkspace(id);
  if (!workspace) notFound();
  const settings = await getWorkspaceClaudeSettings(id);
  if (!settings) notFound();
  const { t } = await getI18n();
  const overview = await getWorkspaceClaudeOverview(id).catch(() => null);
  return (
    <div className="max-w-2xl space-y-8">
      <header className="space-y-3">
        <p className="break-words text-xs font-semibold text-subtle">{workspace.name}</p>
        <h1 className="text-[32px] font-bold tracking-[-0.8px] text-ink">{t("setup.claudeTitle")}</h1>
        <p className="text-sm leading-relaxed text-muted">{t("setup.secretHelp")}</p>
      </header>
      {overview ? <SetupClaudeForm key={`${id}-${overview.source}-${overview.model}`} workspaceId={id} overview={overview} action={saveSetupAction} testAction={testClaudeAction} /> : <p role="alert" className="text-sm text-warning">{t("setup.storage")}</p>}
      <Link href="/setup" className="inline-flex min-h-8 items-center rounded-md text-sm text-ink underline underline-offset-4">{t("setup.back")}</Link>
      <Link href="/workspaces" className="inline-flex min-h-8 items-center rounded-md text-sm text-ink underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink">{t("workspace.claude.back")}</Link>
    </div>
  );
}
