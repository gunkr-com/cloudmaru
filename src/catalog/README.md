# 지역·재사용 지원 카탈로그

Phase 18의 정적 데이터와 로더 계약이다. Phase 17은 주입받은 typed fixture를 사용하며, 실제 로더의 앱 연결은 phase 20/22가 맡는다. 기존 Build 카탈로그·계산·입력·프롬프트·Bicep 검증은 그대로 사용한다.

## 파일과 공개 export

| 경로 | 역할 |
|---|---|
| `src/catalog/extension-support.json` | 검토한 지역별 지원 근거와 재사용 조건 |
| `src/catalog/components.json` | 구성요소 ID·소매 SKU/미터 조회 키·과금 단위·Bicep 타입 |
| `src/catalog/prices.json` | 데모·테스트 전용 합성 CAD 가격표 |
| `src/lib/catalog/extension-support.ts` | `loadExtensionSupportCatalog()`, `getExtensionRegion(support, regionId)`, `getComponentRegionSupport(support, componentId, regionId)`, `getReusePolicies(support, resourceType, componentId)` |
| `src/lib/catalog/extension-support-schema.ts` | W0 소유 `parseExtensionSupportCatalog`, `extensionSupportCatalogSchema`, `reusePolicySchema`, `ExtensionSupportError` |
| `src/types/extension-support.ts` | `ExtensionSupportCatalog`, `ReusePolicy` |

로더는 정적 JSON import → `loadCatalog()` → W0 파서 순서로 검증한다. 사용량 기반 과금 구성요소를 참조하는 정책은 `additionalUsage: "metered"`여야 한다. Key Vault 작업·로그 수집의 증가분을 면제할 수 없고, 기존 정액 App Service 플랜 참조는 원래 컴퓨트 비용을 다시 계산하지 않는다. 공유 스키마는 변경하지 않았다.

조회는 전달받은 검증된 지원 카탈로그에서 정확한 ID·지역·소문자 ARM 타입만 찾는다. 지역/구성요소 누락은 `undefined`, 일치하는 정책이 없으면 `[]`다. `unknown` 항목은 출처와 함께 그대로 반환한다. 헬퍼는 단가를 반환하거나 다른 지역을 고르지 않으며 재사용 적격성·용량을 판정하지 않는다. 반환 객체는 해당 호출의 카탈로그 항목이고, 로더를 다시 부르면 독립적으로 검증된 객체를 얻는다.

## 버전과 형식

- 지원 형식: `schemaVersion: 1`, 데이터 `version: "2026-11-12-v1"`, `verifiedAt: "2026-11-12T07:08:27Z"`.
- 가격 기준일: `asOf: "2026-11-11"`, CAD. 29개 과금 구성요소 × 3지역 = 87개 가격 행이다.
- 지원 외피: `{schemaVersion, version, verifiedAt, regions, components, reusePolicies}`. 지역은 `{id, label:{en,ko}}`, 구성요소는 `{componentId, regions:[{regionId,status,priceRegion?,sources}]}`다.
- 32개 구성요소 × 3지역 = 96개 조합을 각각 한 번 담는다. 90개 `supported`, Static Web Apps 6개 `unknown`이다. 지원 과금 쌍은 정확한 선택 지역 가격 행·단위와 명시적인 `priceRegion`이 필요하다. 무료 항목은 `priceRegion`과 가격 행이 없다.
- 지원 지역은 `canadacentral` / Canada Central, `westus2` / West US 2, `centralus` / Central US다. 기본은 Canada Central이며 `global`은 배포 선택지가 아니다.
- 작은 CAD 단가는 기존 ADR-021의 USD 환산 규칙을 유지한다. 환율은 같은 공개 CAD/USD 쌍에서 계산하며 상수 추정을 사용하지 않는다. 실제 견적은 `npm run prices:sync`로 로컬에 만든 가격표를 쓴다. 이 파일은 내보내기에 포함하지 않는다.

## 구성요소·SKU 범위

아래 ID는 모두 위 세 지역을 가진다. SKU는 소매 조회 키이며 App Service 재사용의 ARM `sku.name`은 다음 절의 별도 매핑을 사용한다.

| 구성요소 ID | 소매 SKU / 상태 |
|---|---|
| `app-service-linux-b1`, `app-service-linux-b2` | B1, B2 / supported |
| `app-service-linux-p0v3`, `app-service-linux-p1v3`, `app-service-linux-p2v3` | P0v3, P1 v3, P2 v3 / supported |
| `container-apps-vcpu`, `container-apps-memory`, `container-apps-requests` | Standard / supported |
| `functions-consumption-executions`, `functions-consumption-duration`, `functions-dedicated-p1v3` | Standard, Standard, P1 v3 / supported |
| `static-web-apps-standard`, `static-web-apps-free` | Standard, 무료 / unknown |
| `postgres-flex-b1ms`, `postgres-flex-b2s`, `postgres-flex-gp-2vcore`, `postgres-flex-gp-4vcore`, `postgres-flex-storage` | B1MS, B2S, 2 vCore, 4 vCore, Storage / supported |
| `cosmos-db-serverless-ru` | RUs / supported |
| `blob-hot-lrs`, `blob-hot-zrs` | Hot LRS, Hot ZRS / supported |
| `managed-redis-b0`, `managed-redis-b1` | B0, B1 / supported |
| `front-door-standard-base` | Standard / supported, 명시적 `priceRegion: "Zone 1"` |
| `application-gateway-v2-fixed`, `application-gateway-v2-capacity` | Standard / supported |
| `internet-egress`, `public-ipv4-standard` | Standard / supported |
| `log-analytics-ingestion`, `key-vault-operations` | Analytics Logs, Standard / supported |
| `virtual-network`, `virtual-network-subnet` | 무료 참조 / supported |

Static Web Apps Standard의 `priceRegion: "eastus2"`는 가격 조회 매핑이다. 대상 세 지역의 배포 지원 근거로 쓰지 않으므로 가격이 있어도 지원 상태는 unknown이다. 무료 VNet/서브넷의 타입은 각각 `Microsoft.Network/virtualNetworks`, `Microsoft.Network/virtualNetworks/subnets`이며 연결 서비스·피어링·전송·송신 과금은 면제하지 않는다.

## 재사용 조건과 남은 미확인 사항

| 정책 ID | 타입 / 필수 조건 / 증가 사용량 |
|---|---|
| `reuse-vnet` | `microsoft.network/virtualnetworks` / 동일 지역·저장 주소 대역·신규 서브넷 포함/중첩 검사 / 기본 참조 무료 |
| `reuse-subnet` | `microsoft.network/virtualnetworks/subnets` / 동일 지역·부모 VNet 존재·호환 위임·주소 대역 근거 / 기본 참조 무료 |
| `reuse-linux-app-service-plan` | `microsoft.web/serverfarms` / 동일 지역·`reserved: true`·ARM SKU 정확히 일치 / 기존 플랜 비용 제외 |
| `reuse-key-vault` | `microsoft.keyvault/vaults` / 보수적 동일 지역·기존 참조만 / 증가 Standard 작업 과금 |
| `reuse-log-analytics` | `microsoft.operationalinsights/workspaces` / 동일 지원 지역·호환 Analytics Logs / 증가 수집 GB 과금 |

Linux 플랜의 component → ARM SKU는 b1 → `B1`, b2 → `B2`, p0v3 → `P0v3`, p1v3 → `P1v3`, p2v3 → `P2v3`다. Functions 전용 플랜은 이 정책에 포함되지 않는다. 모든 정책의 `capacity`는 `unverified`이며, 정책 부재는 자동 재사용 허용이 아니다.

정적 지원/소매 가격은 구독 할당량·배포 용량·연결 가능성·잔여 컴퓨트/주소/수집 용량·권한의 증거가 아니다. 스캔 membership, SKU/부모/위임/지역/CIDR/경로는 phase 17이 저장 스캔으로 확인한다. 누락 근거는 unknown이며 기존 리소스를 변경하거나 Azure에 배포하지 않는다.

## 검증

Extend 가이드·평가 문장 카탈로그는 `extension-artifact-prose.json`(`extend-artifact-prose-v1`, ADR-030)이다. 모델이 고르는 제목/문장 ID를 검토된 영·한 쌍으로 조립하며, 임의 자유문장·미등록 ID를 받지 않는다. 모든 문장은 실제 가이드·평가의 언어/길이/금액/개인정보 검증을 통과해야 한다. 가격·판정·출처·capacity 보장을 문장 카탈로그로 만들지 않는다. 과거 저장 내용은 카탈로그 변경 때 다시 렌더링하지 않는다.

- TDD: 로더 파일 생성 전 신규 테스트가 모듈 부재로 실패함을 확인했다. 로더/데이터/W0 파서 테스트는 누락·중복·미등록 ID·단위/지역 불일치·미승인/빈 출처·불완전 SKU 매핑·용량 보장·증가 사용량 면제를 거절한다. 가격 없는 unknown 조합에 다른 지역 가격이나 0원을 사용하지 않는다.
- 공개 출처: 2026-11-12 기존 `scripts/check-links.ts`의 `checkLinks`로 지원 JSON의 구성요소별·정책별 URL만 중복 제거해 검사했다. 21개 모두 HTTP 200이며 최종 URL은 원래의 `https://learn.microsoft.com/…`와 같았다. 리다이렉트 해석이 필요한 항목은 없었다. 링크 도달 가능성은 구독별 배포 보장이 아니다.
- 회귀: 전체 Build 입력·카탈로그·비용·프롬프트·Bicep fixture 테스트를 포함하는 `npm run test`와 `npm run lint`, `npm run build`, `python3 -m pytest scripts/ -q`, `git diff --check`를 phase 종료 관문으로 사용한다.
- Step 2 최종 로컬 결과: lint/build, Vitest 204파일·2,675개, Python 363개 통과. 기존 `llm-calls` 저장 순서 테스트가 전체 실행에서 한 번 실패했으나, 단독 7개 및 전체 재실행은 통과했다. 동시각 행을 UUID로 정렬하는 기존 테스트의 불안정성은 이 phase에서 수정하지 않았다.
