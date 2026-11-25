import type { Messages } from "../types";
export const shell: Messages["shell"] = {
  skipToContent: "본문으로 건너뛰기",
  menu: "메뉴",
  expandSidebar: "사이드바 펼치기",
  collapseSidebar: "사이드바 접기",
  navigation: "대시보드",
  workspace: "워크스페이스",
  manageWorkspaces: "워크스페이스 관리",
  nav: { overview: "개요", assessments: "점검 기록", network: "경로 진단", extensions: "확장 기록", inventory: "인벤토리", newAnalysis: "새 분석", history: "분석 기록", workspaces: "워크스페이스" },
  groups: { extend: "확장", build: "구축", assess: "점검" },
  cost: { title: "이번 달 · Claude API", estimate: "USD · 토큰 단가 기준 추정", uncounted: "단가를 알 수 없는 호출 {count}건 제외" },
  titles: { history: "분석 기록", notFound: "페이지를 찾을 수 없습니다", analysisNotFound: "분석을 찾을 수 없습니다", newAnalysis: "새 분석", rerun: "조건 바꿔 다시 분석", pending: "분석 중", failed: "분석 실패", result: "분석 결과" },
};
