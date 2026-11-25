import type { Messages } from "../types";
export const inventory: Messages["inventory"] = {
  "eyebrow": "점검",
  "title": "인벤토리",
  "description": "이 워크스페이스의 Azure 리소스를 스캔하거나 파일로 가져옵니다. 스캔은 덮어쓰지 않고 쌓입니다.",
  "actions": {
    analyzeScan: "이 스캔 분석",
    "runScan": "스캔 실행",
    "importFile": "파일 가져오기",
    "setUpConnection": "연결 설정",
    "editConnection": "연결 수정",
    "viewInventory": "인벤토리 보기",
    "viewProgress": "진행 보기",
    "starting": "스캔을 시작하는 중입니다.",
    "importing": "파일을 가져오는 중입니다."
  },
  "importHelp": "az graph query로 resources, resourcecontainers 테이블을 조회한 JSON을 사용하세요. 64MB, 50,000행까지 가져옵니다.",
  "connection": {
    "notConnected": "이 워크스페이스에는 Azure 연결이 없습니다. 파일은 가져올 수 있습니다.",
    "summary": "테넌트 {tenant} · 대상 구독 {count}개",
    "summaryOne": "테넌트 {tenant} · 대상 구독 {count}개",
    "certificateValid": "인증서 만료일 {date}",
    "form": {
      "title": "Azure 연결",
      "eyebrow": "워크스페이스 · {name}",
      "description": "앱 등록 인증서로 이 워크스페이스의 Azure 리소스를 읽습니다. 읽기만 하고 리소스를 바꾸지 않습니다.",
      "tenantId": "테넌트 ID",
      "clientId": "애플리케이션(클라이언트) ID",
      "certificatePath": "인증서 파일 경로",
      "certificatePathHelp": "인증서와 개인 키가 함께 든 PEM 파일의 절대 경로입니다. PFX 파일은 먼저 PEM으로 바꾸세요.",
      "passwordEnv": "비밀번호 환경 변수 (선택)",
      "passwordEnvHelp": "개인 키가 암호화돼 있으면 비밀번호를 담은 .env.local 변수의 이름을 적으세요. 비밀번호 자체는 적지 마세요.",
      "subscriptionIds": "대상 구독",
      "subscriptionIdsHelp": "한 줄에 구독 ID 하나씩, 50개까지 적습니다.",
      "save": "연결 저장",
      "saving": "저장 중입니다.",
      "saved": "연결을 저장했습니다.",
      "remove": "연결 삭제",
      "removed": "연결을 삭제했습니다.",
      "backToWorkspaces": "워크스페이스로 돌아가기",
      "goToInventory": "인벤토리로 가기",
      "errors": {
        "tenant-id-invalid": "테넌트 ID를 GUID 형식으로 입력하세요.",
        "client-id-invalid": "애플리케이션 ID를 GUID 형식으로 입력하세요.",
        "certificate-path-invalid": "/로 시작하는 절대 경로를 입력하세요.",
        "password-env-invalid": "영문 대문자로 시작하고 대문자·숫자·밑줄만 쓴 3~64자 이름을 입력하세요.",
        "subscriptions-invalid": "구독 ID를 GUID 형식으로 한 줄에 하나씩, 1~50개 입력하세요.",
        "save": "저장하지 못했습니다. 다시 시도해 주세요."
      }
    }
  },
  "scanRunning": "스캔이 진행 중입니다.",
  "latest": {
    "title": "마지막 스캔",
    "collected": "수집 {date} · {source}"
  },
  "source": {
    "live": "직접 연결",
    "import": "파일"
  },
  "summary": {
    "resources": "리소스",
    "subscriptions": "구독",
    "resourceGroups": "리소스 그룹",
    "regions": "지역",
    "untagged": "태그 없음",
    "unread": "리소스가 하나도 나오지 않은 구독이 {count}개 있습니다. 앱에 그 구독의 Reader 역할이 없을 수 있습니다.",
    "unreadOne": "리소스가 하나도 나오지 않은 구독이 {count}개 있습니다. 앱에 그 구독의 Reader 역할이 없을 수 있습니다.",
    "unreadTitle": "읽지 못한 구독",
    "skipped": "형식을 읽지 못해 건너뛴 행이 {count}개 있습니다.",
    "skippedOne": "형식을 읽지 못해 건너뛴 행이 {count}개 있습니다."
  },
  "history": {
    "title": "스캔 기록",
    "empty": "아직 스캔이 없습니다.",
    "date": "날짜",
    "source": "출처",
    "status": "상태",
    "resources": "리소스"
  },
  "status": {
    "pending": "스캔 중",
    "succeeded": "완료",
    "failed": "실패"
  },
  "pending": {
    "message": "스캔 중입니다. 보통 몇 분 걸립니다.",
    "longRunning": "평소보다 오래 걸리고 있습니다.",
    "explanation": "Azure Resource Graph로 대상 구독을 읽습니다. 읽기만 하고 리소스를 바꾸지 않습니다.",
    "leave": "페이지를 떠나도 스캔은 계속됩니다. 결과는 스캔 기록에 남습니다.",
    "progress": "스캔 진행 중",
    "elapsed": "경과 시간",
    "stalled": "스캔 상태를 확인하지 못했습니다. 다시 시도해 주세요."
  },
  "failed": {
    "otherWorkspace": "다시 실행하려면 이 스캔의 워크스페이스로 바꾸세요."
  },
  "detail": {
    "eyebrow": "스캔 · {date}",
    "otherWorkspace": "이 스캔은 현재 워크스페이스가 아닌 {name}의 스캔입니다.",
    "families": "계열별",
    "familyCount": "리소스 {count}개",
    "familyCountOne": "리소스 {count}개"
  },
  "stages": {
    "source": "소스",
    "ingest": "수집",
    "process": "처리",
    "store": "저장",
    "serve": "제공",
    "infra": "인프라",
    "unclassified": "미분류"
  },
  "families": {
    "static-web": "정적 웹앱",
    "cdn": "CDN·Front Door",
    "web-app": "웹앱",
    "app-plan": "App Service 계획",
    "sql-managed-instance": "SQL Managed Instance",
    "sql-server": "SQL 서버",
    "sql-database": "SQL 데이터베이스",
    "synapse-workspace": "Synapse 작업 영역",
    "synapse-pool": "Synapse 풀",
    "storage": "스토리지 계정",
    "cosmos": "Cosmos DB",
    "data-factory": "Data Factory",
    "databricks": "Databricks",
    "messaging": "메시징",
    "compute": "가상 머신",
    "container-compute": "컨테이너",
    "analysis-services": "Analysis Services",
    "machine-learning": "머신 러닝",
    "key-vault": "Key Vault",
    "monitoring": "모니터링",
    "network": "네트워크",
    "certificate": "인증서",
    "other": "기타"
  },
  "table": {
    "title": "리소스",
    "search": "이름이나 리소스 ID로 검색",
    "type": "리소스 종류",
    "allTypes": "모든 종류",
    "apply": "적용",
    "name": "이름",
    "resourceGroup": "리소스 그룹",
    "region": "지역",
    "subscription": "구독",
    "tags": "태그",
    "noTags": "태그 없음",
    "tagCount": "태그 {count}개",
    "tagCountOne": "태그 {count}개",
    "noRegion": "—",
    "matched": "리소스 {matched}개 중 {from}–{to}",
    "matchedOne": "리소스 {matched}개 중 {from}–{to}",
    "noMatch": "조건에 맞는 리소스가 없습니다. 검색어나 종류를 바꾸세요.",
    "previous": "이전 쪽",
    "next": "다음 쪽",
    "page": "{pages}쪽 중 {page}쪽"
  },
  "titles": {
    "inventory": "인벤토리",
    "scan": "스캔 인벤토리",
    "scanPending": "스캔 중",
    "scanFailed": "스캔 실패",
    "scanNotFound": "스캔을 찾지 못함",
    "connection": "Azure 연결"
  },
  "notFound": {
    "title": "스캔을 찾지 못했습니다",
    "description": "스캔이 없거나 링크가 잘못됐을 수 있습니다."
  },
  "errors": {
    "scan": {
      "connection-missing": "이 워크스페이스에 Azure 연결이나 대상 구독이 없습니다. 먼저 연결을 설정하세요.",
      "certificate-not-found": "인증서 파일을 읽지 못했습니다. 파일 경로와 읽기 권한을 확인하세요.",
      "certificate-invalid": "인증서와 개인 키가 함께 든 PEM 파일이 아닙니다. PFX 파일이면 PEM으로 바꾸세요.",
      "certificate-expired": "인증서가 만료됐습니다. 앱 등록에 새 인증서를 추가하고 파일 경로를 바꾸세요.",
      "certificate-password-missing": "개인 키에 비밀번호가 필요한데 환경 변수 값이 없습니다. .env.local에 설정하세요.",
      "auth-failed": "Azure가 토큰을 발급하지 않았습니다. 테넌트 ID, 애플리케이션 ID, 앱에 등록한 인증서를 확인하세요.",
      "forbidden": "앱에 이 구독을 읽을 권한이 없습니다. Reader 역할을 할당한 뒤 다시 시도하세요.",
      "subscription-not-found": "대상 구독을 찾지 못했습니다. 구독 ID를 확인하세요.",
      "throttled": "Azure가 요청 수를 제한했습니다. 몇 분 뒤 다시 시도하세요.",
      "timeout": "스캔이 10분 안에 끝나지 않았습니다. 다시 시도하거나 대상 구독을 줄이세요.",
      "too-many-rows": "스캔 결과가 50,000행을 넘었습니다. 대상 구독을 줄이세요.",
      "invalid-response": "Azure 응답을 읽지 못했습니다. 다시 시도하세요.",
      "interrupted": "서버 재시작 등으로 스캔이 끝나기 전에 멈췄습니다. 스캔을 다시 실행하세요.",
      "internal": "스캔을 마치지 못했습니다. 다시 시도하세요."
    },
    "api": {
      "invalid-body": "요청을 읽지 못했습니다. 화면을 새로 고친 뒤 다시 시도하세요.",
      "workspace-changed": "다른 탭에서 워크스페이스가 바뀌었습니다. 화면을 새로 고친 뒤 다시 시도하세요.",
      "connection-missing": "이 워크스페이스에 Azure 연결이나 대상 구독이 없습니다. 먼저 연결을 설정하세요.",
      "import-invalid": "지원하는 인벤토리 형식이 아닙니다. Resource Graph 조회 결과를 JSON으로 내보낸 뒤 다시 시도하세요.",
      "import-too-many-rows": "파일이 50,000행을 넘습니다. 구독별로 나눠 가져오세요.",
      "import-empty": "파일에 리소스가 없습니다. resources 테이블이 들어 있는지 확인하세요.",
      "import-too-large": "파일이 64MB를 넘습니다. 구독별로 나눠 가져오세요.",
      "not-found": "스캔을 찾지 못했습니다.",
      "internal": "처리하지 못했습니다. 다시 시도하세요."
    }
  }
};
