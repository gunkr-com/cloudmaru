import type { JSX, ReactNode } from "react";
import { DashboardShell } from "@/components/shell/dashboard-shell";
import { getLocalMonthStart, summarizeMonthlyCost } from "@/lib/llm/monthly-cost";
import { getCurrentWorkspace } from "@/services/current-workspace";
import { listWorkspaces } from "@/services/db/workspaces";
import { listLlmUsageSince } from "@/services/db/analyses";
import type { ShellData } from "@/types/shell";

export default async function AppLayout({ children }: { children: ReactNode }): Promise<JSX.Element> {
  // 기본 워크스페이스가 없으면 먼저 생성된 뒤 목록을 읽는다.
  const workspace = await getCurrentWorkspace();
  const [workspaces, usages] = await Promise.all([
    listWorkspaces(),
    listLlmUsageSince(getLocalMonthStart(new Date())),
  ]);
  // 클라이언트 셸에는 표시용 필드만 넘긴다.
  const toSummary = ({ id, name, companyName }: ShellData["workspace"]): ShellData["workspace"] => ({ id, name, companyName });
  const data: ShellData = {
    workspace: toSummary(workspace),
    workspaces: workspaces.map(toSummary),
    monthlyCost: summarizeMonthlyCost(usages),
  };
  return <DashboardShell {...data}>{children}</DashboardShell>;
}
