import type { Messages } from "../types";
export const assessmentRoadmap: Messages["assessmentRoadmap"] = {
  "report": {
    "title": "점검 보고서",
    "print": "인쇄 / PDF 저장",
    "back": "저장된 점검 열기",
    "notice": "저장된 결과만 사용합니다. 내려받기나 인쇄는 점검을 다시 실행하거나 AI 또는 Azure를 호출하지 않습니다.",
    "identity": "저장된 점검과 소유 회사",
    "finding": "점검 결과",
    "ruleId": "규칙 ID / 버전",
    "findingId": "점검 결과 ID",
    "resource": "리소스 ID",
    "mappingVersion": "Advisor 매핑 버전",
    "rulePack": "규칙 묶음 버전",
    "periodFrom": "요청 기간 시작",
    "periodTo": "요청 기간 끝",
    "amount": "원금액",
    "total": "통화별 합계",
    "subscription": "구독",
    "attribution": "비용 귀속",
    "ruleAction": "카탈로그 규칙 / 조치",
    "reportUnavailable": "저장된 보고서를 이용할 수 없습니다. 점검을 열고 과거 근거를 확인해 주세요.",
    "safeNotice": "민감한 값은 생략합니다. 관측값과 AI 설명은 동작하지 않는 글로 표시하며, 링크는 저장된 카탈로그에서만 가져옵니다.",
    "roadmapCoverage": "로드맵 범위: 점검 결과 {included} / {total}개, 통과 결과 {excluded}개 제외. 리소스 수집 범위와 별개입니다.",
    "counts": "추가 {added} · 더 이상 관측되지 않음 {removed} · 변경 {changed} · 알 수 없음 {unknown}",
    "credits": "부호 있는 원금액에는 크레딧과 조정이 포함됩니다. 통화별 합계는 각각 표시하고 환산하지 않습니다.",
    "assessmentCreated": "점검 생성 시각",
    "assessmentCompleted": "점검 완료 시각"
},
  "title": "개선 로드맵",
  "generate": "로드맵 생성",
  "retry": "로드맵 다시 시도",
  "notice": "검증된 점검 결과를 바탕으로 AI가 정리한 우선순위입니다. 로컬 판정은 코드가 정합니다.",
  "localPreserved": "로드맵 생성이 실패해도 로컬 점검 결과는 계속 볼 수 있습니다.",
  "download": "점검 보고서 내려받기",
  "status": {
    "not-requested": "요청하지 않음",
    "pending": "로드맵 생성 중",
    "succeeded": "준비됨",
    "failed": "실패"
  },
  "ui": {
    "keySettings": "Claude 키 설정",
    "reload": "상태 다시 읽기",
    "pollError": "로드맵 상태를 읽지 못했습니다. 상태를 다시 읽어 주세요.",
    "coverage": "포함한 점검 결과 {included} / {total}개, 통과 결과 {excluded}개 제외.",
    "elapsed": "경과 시간: {seconds}초",
    "generatedAt": "생성 시각",
    "findings": "저장된 점검 결과 {count}개"
},
  "errors": {
    "no-data": "조치나 확인이 필요한 코드 점검 결과가 없습니다. 로컬 점검 결과는 계속 볼 수 있습니다.",
    "workspace-changed": "워크스페이스가 바뀌었습니다. 이 점검의 워크스페이스를 선택한 뒤 로드맵을 생성해 주세요.",
    "invalid-body": "요청을 읽지 못했습니다. 화면을 다시 열고 시도해 주세요.",
    "unavailable": "과거 로드맵 근거를 이용할 수 없습니다. 로컬 결과는 계속 볼 수 있습니다.",
    "assessment-missing": "저장된 점검을 찾지 못했습니다. 기준 스캔에서 다시 열어 주세요.",
    "assessment-not-succeeded": "로컬 점검이 성공적으로 끝나지 않았습니다. 점검을 마친 뒤 로드맵을 요청해 주세요.",
    "key-unavailable": "워크스페이스의 Claude 키를 이용할 수 없습니다. 이 점검이 속한 회사의 키 설정을 확인해 주세요.",
    "validation-failed": "로드맵이 검증을 통과하지 못했습니다. 다시 시도해 주세요.",
    "timeout": "제한 시간 안에 로드맵을 만들지 못했습니다. 다시 시도해 주세요.",
    "interrupted": "로드맵 생성이 중단되었습니다. 다시 시도해 주세요.",
    "internal": "로드맵을 생성하지 못했습니다. 로컬 결과는 계속 볼 수 있습니다. 다시 시도해 주세요."
  }
};
