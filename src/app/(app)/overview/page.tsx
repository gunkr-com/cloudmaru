import { OverviewDashboard } from "@/components/overview/overview-dashboard";
import { getI18n } from "@/i18n/server";
import { withSiteName } from "@/lib/dashboard/page-titles";
import { getCurrentWorkspace } from "@/services/current-workspace";
import { loadWorkspaceOverview } from "@/services/workspace-overview";
import { isDemoMode } from "@/services/demo-mode";

export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: withSiteName(t("overview.title")) };
}

// 저장 기록만 읽는다. 외부 조회는 각 화면에서 사용자가 직접 실행한다.
export default async function OverviewPage() {
  const workspace = await getCurrentWorkspace();
  const overview = await loadWorkspaceOverview(workspace.id);
  return <OverviewDashboard workspaceName={workspace.name} workspaceId={workspace.id} overview={overview} demo={isDemoMode()} />;
}
