# Assess 선택 인사이트 수집 (phase14 → phase16)

## 서버 진입점

`src/services/azure/insights.ts`는 `server-only`다. 다음 export를 phase16 작업에서 사용한다.

```ts
collectAssessmentInsights(input: AssessmentInsightsInput,
  deps: AssessmentInsightsDeps | null): Promise<AssessmentInsights>
```

- `AssessmentInsightsInput`: `{scan: ScanRecord, inventory: ScanInventory, requested: {advisor: boolean, actualCost: boolean}, retrievedAt?: string}`.
- `AssessmentInsightsDeps`: `AzureRequestDeps & {maxPages?: number, maxRows?: number}`. 연결이 없으면 `null`이다. URL·인증서·비밀번호·클라이언트 제공 설정을 받는 API가 아니다.
- `AssessmentInsights`: `{advisor: ComponentResult<AdvisorResult>, actualCost: ActualCostWindows, collection: {retrievedAt, advisorScope, costScopes}}`.
- `collection.advisorScope`는 `AdvisorCollection["scope"] | null`, `collection.costScopes`는 `ActualCostCollection["scopes"] | null`이다. 각 구독의 상태·이유·페이지 완료 여부와 requested/available 구독을 보존한다. null은 수집 미실행 또는 예상 밖 수집기 거절이며, 빈/완전한 범위를 뜻하지 않는다.

호출자는 **같은 저장 성공 스캔의 행과 인벤토리**, 저장된 소유 워크스페이스를 조회하고 둘의 소속을 검증해야 한다. `getCurrentWorkspace()`나 요청 본문의 회사/구독으로 대체하지 않는다. 소유 회사의 서버 조회 연결 설정과 허용 구독을 검증한 뒤 인증 래퍼로 `getToken`을 준비한다. 현재 설정의 허용 구독이 저장 스캔 범위를 더 이상 포함하지 않으면 그 연결을 사용하지 않는다. 이 헬퍼는 소유권·RBAC 검증기를 대신하지 않는다. 요청 대상 구독은 저장 스캔의 `subscriptionIds`이며 인벤토리 ID는 저장 `inventory.resources`에서만 추출한다.

헬퍼는 공통 `toCompletionSourceScan`으로 성공·범위·형식을 확인한다. invalid-data 스캔, 잘못된 시각/상한은 토큰 요청 전에 정제된 `AzureRequestError("disallowed")`로 거절한다. 부분 수집/구형 존재 정보는 전체 성공을 주장하지 않으며 유효한 저장 범위의 선택 조회는 허용한다. 수집은 인벤토리 스냅샷 시점의 Advisor/청구 상태를 재현하는 작업이 아니다.

## phase16 저장 연결

```ts
const insights = await collectAssessmentInsights(
  {scan: savedScan, inventory: savedInventory,
    requested: {advisor: true, actualCost: true}},
  ownerConnectionTransportOrNull,
);
// 로컬 판정과 독립적으로 붙이고 assessmentResultSchema 및 소속 의미 검증 후 저장한다.
const result = {...localAssessment, advisor: insights.advisor, actualCost: insights.actualCost};
```

`collection`은 서버 진단/범위 메타데이터다. 공통 AssessmentResult에 임의 필드로 추가하지 않는다. 비용의 저장 가능한 성공 데이터에는 이미 scope/기간/조회 시각이 있고 Advisor에는 매핑 coverage/버전/조회 시각이 있다. API·화면·DB 저장 어댑터는 phase16 소유다. 이 헬퍼는 로컬 findings, diff, roadmap, Build를 받거나 변경하지 않는다. 선택 인사이트 실패로 로컬 성공을 failed로 바꾸지 않는다.

## 상태와 실패 격리

- requested=false인 영역은 `not-requested`이며 토큰도 얻지 않는다.
- 명시적으로 요청한 import 스캔 영역은 `unavailable / not-supported`다. 파일의 구독으로 직접 연결을 시도하지 않는다.
- live 스캔에 연결이 없으면 요청 영역은 `unavailable / not-configured`다.
- Advisor와 비용 수집은 독립 실행한다. 비용 수집기는 월 누계와 최근 30일을 각각 수집한다. 권한/파싱/페이지 실패는 각 수집기의 coded state로 남고 다른 성공을 지우지 않는다. 예상 밖 수집기 거절도 원문 없는 failed/internal로 격리한다.
- 403은 unavailable/forbidden, 빈 비용/204는 unavailable/no-data, 반환된 0원 행은 성공 데이터다. 일부 구독/페이지 성공은 이유가 있는 partial이며 원래 성공 행을 보존한다.
- 화면은 등록된 `assessment` EN/KO 사전으로 상태·이유를 표시한다. 이 모듈은 사용자 문장·원본 오류·토큰·연결 설정을 직렬화하거나 기록하지 않는다.

## 범위·페이지·조회 시각

기존 export `collectAdvisorRecommendations`/`AdvisorCollection` (`advisor.ts`), `collectActualCosts`/`ActualCostCollection`/`CostCollectionScope`/`costPeriods` (`cost-management.ts`)도 유지한다.

- Advisor는 API `2026-10-01` cached list GET만 사용한다. generateRecommendations는 호출하지 않는다.
- 비용은 API `2026-06-01` subscription query POST (`ActualCost`, `Custom`, `PreTaxCost` 합계, ResourceId grouping)만 사용한다.
- 모든 HTTP는 기존 `azureRequest`로 보낸다. 기본 요청 제한은 토큰·본문 읽기를 포함해 30초이며 자동 재시도는 없다. phase16이 전체 작업 수명을 제한해야 한다.
- 기본 페이지 상한은 **구독마다 100페이지**, 행 상한은 **Advisor 전체 구독 합계 50,000행, 비용은 기간마다 전체 구독 합계 50,000행**이다. 양의 안전 정수 maxPages/maxRows로 낮출 수 있다. 상한 도달 시 보존 행과 collection-partial을 반환한다.
- nextLink는 인증 전에 ARM origin·정확한 API endpoint·동일 구독·고정 API version·허용 쿼리 키를 검사한다. URL 경로 변조/외부 호스트/구독 이동/순환은 거절한다. HTTP redirect도 허용하지 않는다.
- `retrievedAt`은 수집 시작의 ISO timestamp(기본 서버 현재 시각)다. 세 영역에 같은 기준을 전달하며 비용의 UTC 월 시작→조회 시각, 조회 시각−30일→조회 시각을 계산한다. 원래 from/to/preset을 그대로 보존한다. 스캔 collectedAt이나 페이지별 완료 시각이 아니다. 정확한 UTC 월 시작의 길이 0인 월 기간은 no-data로 처리한다.

## 카탈로그·coverage·원래 청구 통화

`src/catalog/advisor-recommendations.json`의 검토된 공식 GUID 7개만 `src/lib/assessment/advisor-catalog.ts`의 `advisorCatalog`를 통해 매핑한다. `parseAdvisorCatalog`는 구조·유일성·출처를 검사한다. 전용 `advisor-*` ruleId와 `advisor-action-*` actionId, EN/KO 제목·설명, 검토된 Microsoft Learn 출처만 화면에 사용한다. 로컬 규칙 판정이나 검증된 절감액으로 해석하지 않는다.

`mapAdvisorRows`의 coverage 분모는 **실제 받은 추천 행 수**다. 포함 수는 정확한 GUID·타입·저장 인벤토리 ID 검증을 통과한 추천 수다. 미매핑 유형, 잘못된/중복 ID, 누락 자원, 스캔 밖 자원, 타입 불일치는 이유별 제외 수로 남긴다. 미수집 페이지/구독은 이 분모를 부풀리지 않고 별도 scope 및 partial 이유에 남긴다. API 자유 문장·URL을 fallback으로 표시하지 않는다.

비용은 응답 열 이름/타입으로 파싱한다. 원래 대문자 3자리 청구 통화별로만 합산하며 CAD 환산이나 혼합통화 총액을 만들지 않는다. 음수 조정·명시적 0·동일 자원의 여러 행을 보존한다. 인벤토리 밖 유효 ID는 outside-inventory, ID 누락/잘못된 ID는 unattributed로 금액을 유지한다. 잘못된 식별자 원문은 버린다. 빈 자료를 0원으로 만들지 않는다. 소매 스냅샷/절감액 추정은 이 헬퍼의 출력이 아니다. 지연 청구·열린 월의 잠정성 안내는 phase16 화면 책임이다.

## 모의 검증

`insights.test.ts`는 실제 두 수집기와 파서를 모의 HTTP transport로 연결한다. 7종 전체 카탈로그, 미매핑 coverage, Advisor/월누계/최근30일의 개별 실패, 구독별 부분 권한, 페이지 제한, 미요청/import/연결 없음, 204와 0, 원 통화·음수·미귀속, 비밀/자유 문장 미노출, 입력 불변성과 요청 전 검증을 확인한다. 전용 수집기/파서 테스트는 링크 변조·순환·행 상한·잘못된 응답을 추가로 검증한다. 실제 Azure/Claude·회사 DB·유료 eval은 사용하지 않는다.
