import type { Messages } from "../types";
export const common: Messages["common"] = {
  tiers: {"low": "최저 비용", "balanced": "균형", "ha": "고가용성"},
  languages: { en: "EN", ko: "한국어" },
  language: "언어",
  siteName: "CloudMaru",
  siteDescription: "요구사항에 맞는 Azure 웹 서비스 구성안과 예상 월 비용을 안내합니다.",
  loadError: "화면을 불러오지 못했습니다.",
  loadErrorHelp: "입력한 내용은 이 브라우저에 남아 있습니다. 잠시 후 다시 시도해 주세요.",
  retry: "다시 시도",
  newAnalysis: "새 분석",
  analysisHistory: "분석 기록",
  pageNotFound: "페이지를 찾을 수 없습니다.",
  pageNotFoundHelp: "주소가 바뀌었거나 없는 페이지입니다. 주소를 확인하거나 아래에서 이동해 주세요.",
  analysisNotFound: "분석을 찾을 수 없습니다.",
  analysisNotFoundHelp: "주소를 확인하거나 분석 기록에서 다시 열어 주세요.",
};
