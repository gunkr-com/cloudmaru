import type { WorkspaceOverview } from "@/types/overview";

export type StartPathKey = "browse" | "health" | "design";
export type StartLinkKey =
  | "connect" | "openTopology" | "openAssessedScan" | "openLatestScan" | "openInventory" | "openAssessment" | "assessScan"
  | "openBuild" | "startBuild" | "openExtend" | "startExtend";
export type StartPath = {
  key: StartPathKey;
  /** 기존 기능 진입점 이름. 화면에서 Build · Extend처럼 함께 보인다. */
  feature: "assess" | "build";
  needsData: boolean;
  links: { key: StartLinkKey; href: string }[];
};

const encode = encodeURIComponent;

/** 저장 기록만 보고 세 가지 시작 경로를 고른다. 새 작업을 실행하지 않고 기존 화면으로만 보낸다. */
export function overviewStartPaths(overview: WorkspaceOverview, workspaceId: string): StartPath[] {
  const scan = overview.inventory.latest;
  const assessment = overview.assessment.latest;
  const browse: StartPath["links"] = [];
  if (assessment) {
    // 저장된 점검과 그 스캔을 먼저 연다. 더 새 스캔은 같은 스캔처럼 보이지 않게 따로 표시한다.
    browse.push({ key: "openTopology", href: `/assessments/${encode(assessment.id)}#topology` });
    browse.push({ key: "openAssessedScan", href: `/inventory/scans/${encode(assessment.sourceScanId)}` });
    if (scan && scan.id !== assessment.sourceScanId) browse.push({ key: "openLatestScan", href: `/inventory/scans/${encode(scan.id)}` });
  } else if (scan) browse.push({ key: "openInventory", href: `/inventory/scans/${encode(scan.id)}` });
  const hasData = Boolean(scan || assessment);
  if (!hasData) browse.push({ key: "connect", href: `/workspaces/${encode(workspaceId)}/connection` });
  const health: StartPath["links"] = assessment
    ? [{ key: "openAssessment", href: `/assessments/${encode(assessment.id)}` }]
    : scan ? [{ key: "assessScan", href: `/assessments/new?sourceScanId=${encode(scan.id)}` }] : [];
  const design: StartPath["links"] = [
    overview.build ? { key: "openBuild", href: `/analyses/${encode(overview.build.id)}` } : { key: "startBuild", href: "/analyses/new" },
  ];
  if (overview.extend) design.push({ key: "openExtend", href: `/extensions/${encode(overview.extend.id)}` });
  else if (scan) design.push({ key: "startExtend", href: "/extensions/new" });
  return [
    { key: "browse", feature: "assess", needsData: !hasData, links: browse },
    { key: "health", feature: "assess", needsData: !hasData, links: health },
    { key: "design", feature: "build", needsData: false, links: design },
  ];
}
