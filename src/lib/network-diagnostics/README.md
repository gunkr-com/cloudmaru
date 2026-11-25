# 저장 네트워크 진단

Phase 15는 저장된 성공 스캔의 로컬 구성 근거를 분석한다. Claude 키·모델 호출·Azure 호출은 필요 없다. 판정은 실시간 연결 시험이나 보안 준수 인증이 아니다.

## 공개 경계

- `src/lib/network/index.ts`: `diagnosePath(resources, query, sourceScan?)`는 W0 `NetworkEngineResult`를 반환한다. 서버는 같은 저장 스캔으로 검증한 SourceScan을 전달한다. complete live 소스이며 해당 리소스의 properties 수집 표시가 있을 때만 생략된 선택 NSG·라우트 테이블 참조를 연결 없음으로 해석한다. 가져오기·부분·구형 또는 소스 메타데이터 없는 호출은 생략을 unknown으로 유지한다. 원본에 없던 null 근거를 만들지 않는다. 기존 `analyzePath`와 CIDR export는 유지한다.
- `validation.ts`: `networkInputSchema`, `NetworkInput`, `NetworkInputError`, `networkResources`, `validateNetworkMembers`, `validateNetworkEngine`. 저장 스캔의 서브넷을 확장하고 양 끝·모든 홉·근거 리소스의 소속을 검사한다. 주소 입력은 받지 않고 저장 NIC/IP에서 해석한다.
- `presentation.ts`: `sanitizeNetworkDiagnostic`는 판정·질의를 유지하며 비밀값이 든 근거 관측을 `invalid-data`로 가린다. 페이지·컴포넌트·GET 응답 경계에서 사용하고 저장 자료는 변경하지 않는다.
- `src/services/db/network-diagnostics.ts`: 주입 가능한 `createNetworkDiagnosticsDb({db})`와 기본 `getNetworkSourceScan`, `reserveNetworkDiagnostic`, `completeNetworkDiagnostic`, `failNetworkDiagnostic`, `getNetworkDiagnostic`, `listNetworkDiagnostics`. 쓰기와 읽기에 W0 스키마·저장 회사/스캔·리소스 참조를 검증한다. 성공·실패는 pending만 종료하고 이미 끝난 결과를 덮지 않는다.

## 라우트

| 경로 | 계약 |
|---|---|
| `POST /api/network-diagnostics` | `{schemaVersion:1, workspaceId, sourceScanId, query}`. query에는 같은 sourceScanId, sourceResourceId, destinationResourceId, protocol, sourcePort, destinationPort를 둔다. 포트 생략은 null로 정규화한다. 현재 회사와 저장 성공 스캔·끝점 검증 후 로컬 동기 계산·저장, `201 {id}`. |
| `GET /api/network-diagnostics/[id]` | 저장 작업·결과를 반환한다. 현재 회사 쿠키·최신 스캔을 선택하거나 엔진을 다시 실행하지 않는다. 가리기 전 저장 결과는 서버에만 남는다. |
| `/network?scan=<id>` | 현재 회사의 성공 스캔 선택, 리소스 검색/네이티브 선택, 질의 폼과 최근 기록. |
| `/network/[id]` | 원 회사·기준 스캔·질의·판정·홉/근거를 재열기. 회사가 다르면 안내하고 실패 재시도는 원 회사에서 한다. |

API는 `Cache-Control: no-store`를 사용한다. 입력 오류는 400, 없는 스캔/결과는 404, 회사 변경·미완료 스캔은 409, 확장 인벤토리 계산 상한 초과는 별도 `413 inventory-too-large`와 영한 안내, 내부 실패는 원문 없는 500 코드다. POST 본문 상한은 16 KiB, 확장 인벤토리는 2,000개다. TCP/UDP 도착 포트는 필수 정수 0~65535, 출발 포트는 선택이다. ICMP/any는 두 포트가 null이다. 일반 요청은 동기 완료하지만 중단된 pending은 읽기/기록 조회 시 5분 경과 후 failed/interrupted로 종료한다. 성공 작업의 allowed/blocked/unknown은 작업 상태와 별개다.

## 수용 검증과 한계

`acceptance.test.ts`는 마이그레이션을 적용한 메모리 PGlite와 실제 스캔/진단 저장 어댑터·POST/GET·엔진을 연결한다. DB 연결과 현재 회사 선택만 테스트 의존성으로 주입한다. 허용·우선 차단·서브넷 누락·라우트 참조 누락·미지원 서비스 태그·가상 어플라이언스 사례를 저장하고 쿠키 변경/새 스캔 후 재열기를 확인한다. 모든 끝점/홉/근거 소속, DB 결과 일치, GET 재계산 없음, 잘못된 포트/프로토콜·다른 스캔 끝점 거부, stale 후 늦은 완료 차단도 검사한다. 기존 엔진·저장·화면 테스트가 추가 경계·EN/KO 근거·비밀 가리기를 확인한다.

근거 없는 ASG·주소·NSG·라우트·피어링은 unknown이다. 광범위 정적 서비스 태그 근사, NVA/gateway 전달, 다중 피어링 transit, PaaS/LB/AppGW 범용 transit을 연결 허용 근거로 쓰지 않는다. 지원되는 allowed도 스캔에 보인 정적 구성에 한정하며 effective routes·실시간 상태를 확인하지 않는다. 파일 가져오기·구형/부분 수집의 완전성 한계는 결과에 보존한다. 판정은 코드, 표시 문구는 등록된 EN/KO network 사전이며 Azure 원문 설명을 대체 문구로 사용하지 않는다.

브라우저 시나리오는 이번 step에서 실행하지 않는다. 통합 W4에서 승인된 UC11을 Aside 한 세션으로 검증한다. 메뉴 연결과 공유 i18n foundation namespace 검사 해제는 통합 담당 범위다.
