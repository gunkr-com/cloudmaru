import { redirect } from "next/navigation";
import { getCurrentWorkspace } from "@/services/current-workspace";
import { getWorkspaceClaudeOverview } from "@/services/workspace-setup";

export default async function Home() {
  const workspace = await getCurrentWorkspace();
  const overview = await getWorkspaceClaudeOverview(workspace.id).catch(() => null);
  redirect(!overview || overview.needsSetup ? "/setup" : "/analyses/new");
}
