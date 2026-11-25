/** A positive operational language, not a product blacklist or sentence template.
 * Writers compose explanations freely from these public words and selected IDs.
 * Vocabulary is reviewed code; never expand it from model output or inventory.
 */
const english=`
a an the and or but because if when while before after during until unless although
as at by for from in into of on onto out over per through to under with within without
about across against along among around between beyond both each either every few
first following further last least less many more most next no not only other same
second several some such than that their them then there these they this those thus
too very which whose why will can cannot could may might must should would do does
did done be been being is are was were has have had it its itself we you your our
also already always any another appropriate available based certain current earlier
enough especially even existing expected explicit finally generally however important
including instead later local new now observed original otherwise previous prior
provided rather relevant remaining required respectively safe saved selected separate
similar specific still therefore together typically unchanged unverified verified
unknown whether yet actual additional aggregate all alone automated basic bounded
careful conservative dedicated different disabled enabled exact external fresh full
general independent internal isolated known limited manual necessary optional partial
physical possible potential private public recent repeated shared single small stable
strict successful temporary total transient typical unique valid visible workload
workloads application applications app apps api apis resource resources service services
plan plans component components configuration configurations setting settings option
options integration integrations environment environments dependency dependencies host
hosts instance instances server servers client clients endpoint endpoints request
requests response responses connection connections connectivity network networks path
paths subnet subnets address addresses routing route routes rule rules ingress egress
traffic transport protocol protocols port ports firewall security reliability cost
costs operations operation performance capacity availability recovery resilience
redundancy zone zones region regions failure failures error errors exception exceptions
timeout timeouts retry retries delay delays interval intervals limit limits threshold
thresholds health readiness status state states condition conditions event events
log logs logging monitoring telemetry diagnostic diagnostics observation observations
metric metrics measurement measurements evidence result results finding findings check
checks test tests validation verification assumption assumptions prerequisite
prerequisites caution cautions restriction restrictions constraint constraints
limitation limitations coverage scope collection inventory snapshot source sources
provenance estimate estimates price prices pricing budget budgets billing charge
charges usage quantity quantities count counts storage data database databases file
files object objects document documents record records table tables query queries
index indexes cache caches memory cpu compute worker workers replica replicas
replication primary standby backup backups restore restoration retention durability
consistency transaction transactions concurrency processing throughput latency load
scaling scale autoscaling utilization headroom demand access permission permissions
identity identities authentication authorization credential credentials secret secrets
password passwords parameter parameters encryption encrypted tls certificate
certificates token tokens role roles audit auditing policy policies tenant tenants
subscription subscriptions group groups ownership owner owners isolation least
privilege privileges deployment deployments release releases version versions build
builds artifact artifacts draft drafts code input inputs output outputs reference
references binding bindings mapping mappings connectionstring boundary boundaries
procedure procedures process processes step steps action actions instruction
instructions guide evaluation advice rationale improvement improvements goal goals
objective objectives requirement requirements design architecture topology lifecycle
maintenance management operator operators team teams user users impact impacts risk
risks behavior behaviour change changes difference differences balance tradeoff
tradeoffs benefit benefits overhead overheads protection control controls review
reviews assessment assessments analysis details detail summary sequence sequences
order frequency duration time times window windows hour hours day days month months
testable measurable reversible consistent incompatible compatible compatibility
unavailable inaccessible incomplete invalid sufficient insufficient outstanding
unresolved unsupported applicable effective deterministic uncertain incremental
minimal minimum maximum medium high low balanced secure securely safely carefully
individually independently jointly gradually periodically explicitly separately
automatically manually directly indirectly successfully continuously temporarily
inspect inspecting inspected inspectable review reviewing reviewed verify verifying
verifies verified validate validating validated check checking checked compare comparing
compared confirm confirming confirmed investigate investigating investigated record
recording recorded collect collecting collected monitor monitored observe observing
measure measuring measured estimate estimating estimated calculate calculating calculated
test testing tested integrate integrating integrated connect connecting connected
disconnect disconnecting disconnected configure configuring configured enable enabling
disable disabling deploy deploying deployed prepare preparing prepared create creating
created generate generating generated select selecting apply applying applied use using
used reuse reusing reused include includes including included exclude excluding excluded
preserve preserving preserved retain retaining retained maintain maintaining maintained
avoid avoiding prevent preventing prevented reduce reducing reduced increase increasing
increased decrease decreasing decreased restrict restricting restricted protect
protecting protected encrypt encrypting decrypt rotate rotating rotated store storing
stored supply supplying supplied provide providing support supporting supported
require requires requiring ensure ensuring allow allowing allowed reject rejecting
rejected validate enforce enforcing enforced identify identifying identified document
documenting documented explain explaining explained resolve resolving resolved detect
detecting detected evaluate evaluating evaluated consider considering considered handle
handling handled recover recovering recovered restore restoring restored retrying wait
waiting waited stop stopping stopped start starting started proceed proceeding
proceeded remain remains remaining change changing changed affect affecting affected
improve improving improved address addressing addressed attach attaching attached
link linking linked match matching matched replace replacing replaced isolate isolating
isolated separate separating separated combine combining combined group grouping
grouped distribute distributing distributed reserve reserving reserved synchronize
synchronizing synchronized fail failing failed succeed succeeding pass passing passed
complete completing completed need needs depend depends fit fits meet meets account
accounts understand understanding understood note notes explainable inspectable
`;
// Nouns and lexical stems. Grammar suffixes are finite and may appear only after
// a complete approved stem/compound (never an arbitrary short prefix).
const korean=`
앱 애플리케이션 워크로드 리소스 서비스 구성 구성요소 설정 선택 안 옵션 환경 연결 통합
호스트 인스턴스 서버 클라이언트 엔드포인트 요청 응답 네트워크 서브넷 주소 경로 라우팅
규칙 수신 송신 트래픽 전송 프로토콜 포트 방화벽 보안 안정성 신뢰성 비용 운영 성능 용량
가용성 복구 복원 중복 영역 지역 장애 실패 오류 예외 시간초과 재시도 지연 간격 제한
임계값 상태 조건 이벤트 로그 기록 모니터링 원격분석 진단 관측 측정 지표 증거 결과
판정 검사 테스트 검증 확인 가정 준비사항 주의사항 제약 범위 수집 인벤토리 사본 스냅샷
원본 출처 근거 견적 가격 예산 청구 사용량 수량 개수 저장소 데이터 데이터베이스 파일
객체 문서 테이블 쿼리 인덱스 캐시 메모리 컴퓨트 작업자 복제 주 대기 백업 보존 내구성
일관성 트랜잭션 동시성 처리 처리량 부하 확장 자동확장 활용 여유 수요 접근 권한 인증
인가 식별자 자격증명 비밀 비밀번호 매개변수 파라미터 암호화 인증서 토큰 역할 감사
정책 테넌트 구독 그룹 소유자 소속 격리 최소 권한 배포 릴리스 버전 빌드 결과물 초안
코드 입력 출력 참조 바인딩 매핑 경계 절차 과정 단계 작업 지침 가이드 평가 조언 설명
이유 원인 개선 목표 요구사항 설계 아키텍처 토폴로지 수명주기 유지보수 관리 담당자 팀 사용자
영향 위험 동작 변경 차이 균형 이점 부담 보호 제어 검토 분석 상세 요약 순서 빈도 기간
시간 일 월 전 후 중 다음 각각 모두 전체 일부 하나 여러 동일 별도 신규 기존 해당
필수 선택적 일반 공개 비공개 저장 부분 정확 명시 보수적 독립 실제 추가 총 합계
가능 여부 필요 충분 부족 미확인 불확실 지원 미지원 호환 호환성 유효 무효 정상 비정상
안전 안전성 사용 재사용 유지 보장 확보 제공 포함 제외 생성 시작 진행 완료 적용 활성
비활성 준비 수행 비교 조사 수집 측정 계산 관찰 점검 분리 결합 연결 교체 회전 삭제
수정 방지 감소 증가 축소 확대 제한 보호 검토 기록 확인 해결 탐지 고려 처리 테스트
전달 저장 보존 유지 관리 사용 설정 선택 검증 통과 실패 성공 연결 복구 복원 재시도
위해 위한 따라 따른 통해 통한 대한 대해 관련 다른 새로운 남은 정기적 지속적 일시적
자동 수동 직접 간접 점진적 개별 독립적 공통 공유 전용 단일 다중 분산 결정적 국소적
되 하 않 없 있 적 같 다르 낮 높 크 작 많 적절 중요 필요하 검토하 확인하 사용하
`;
const endings=`
을 를 은 는 이 가 에 에서 으로 로 과 와 의 도 만 까지 부터 보다 에게 처럼 마다
하고 하여 하며 하지만 하면서 하면 하므로 하도록 하기 하기를 하기전에 합니다 하십시오
하세요 해요 해야 해야합니다 해야하며 해야하고 해야하는 하겠습니다 하였습니다 하였으며
했습니다 했으며 했습니다만 했는지 했던 할 할수 한 하는 하던 한다 하다 하기위해
하여야 해 해도 해서는 안 않 않도록 되 되기 되도록 된 되는 되며 되어 되었 된다는
됩니다 되었습니다 되지 되지는 되지않도록 되지않았 습니다 었습니다 았습니다 였습니다
입니다 이며 인 이므로 이지만 입니다만 인지 라는 이라는 라고 이라고 은지 는지 을지
기 기를 도록 려면 면 고 며 여 아 어 서 지 는데 은데 을 를 에서는 으로는 로는
`;
const split=(value:string)=>[...new Set(value.trim().split(/\s+/))].sort();
export const operationalProseLanguage=Object.freeze({
 policyVersion:'extend-operational-prose-v1',
 enWords:Object.freeze(split(english)),koRoots:Object.freeze(split(korean)),koEndings:Object.freeze(split(endings)),
});

// These ordinary words occur in existing valid analysis fixtures. They are not
// product references. Keep them separate so artifact language/fingerprints stay V1.
export const extensionAnalysisProseLanguage = Object.freeze({
 ...operationalProseLanguage, policyVersion: "extend-analysis-operational-prose-v1",
 enWords: Object.freeze([...new Set([...operationalProseLanguage.enWords,
  "add", "asp", "expand", "extend", "net", "portal", "related", "self", "web",
 ])].sort()),
});
type Language = Pick<typeof operationalProseLanguage, "enWords" | "koRoots" | "koEndings">;
type References = {componentIds: readonly string[]; publicTerms: readonly string[]};
// Only reviewed code constructs a language. References come from each caller's
// trusted selected context, never requirements, inventory strings, or model text.
function createValidator(language: Language) {
 const englishWords=new Set(language.enWords);
 const roots=[...language.koRoots].sort((a,b)=>b.length-a.length);
 const suffixes=new Set(language.koEndings);
 function koreanWord(word:string):boolean {
  // A bounded word can contain compound lexical roots followed by one grammar
  // ending. Endings never grant permission for an unrecognized lexical segment.
  if(word.length>60)return false;
  if(suffixes.has(word))return true; // particles left after an exact component ID
  const positions=new Set([0]);
  for(let start=0;start<word.length;start++)if(positions.has(start)){
   for(const root of roots)if(word.startsWith(root,start)){
    const end=start+root.length;
    if(end===word.length||suffixes.has(word.slice(end)))return true;
    positions.add(end);
   }
  }
  return false;
 }
 return (raw:string,references:References):boolean => {
  let value=raw.normalize('NFKC').normalize('NFC');
  // These exact public references come from the selected saved context only.
  // Product display names, unselected catalog entries and inventory are excluded.
  for(const term of [...references.componentIds,...references.publicTerms]){
   if(!term||!/^[a-z][a-z0-9-]*$/.test(term))return false;
   value=value.replace(new RegExp(`(?<![a-zA-Z0-9_-])${term}(?![a-zA-Z0-9_-])`,'g'),' ');
  }
  const words=value.match(/[\p{L}\p{M}]+(?:['’][\p{L}\p{M}]+)*/gu)??[];
  return words.every(word=>/^[a-z]+$/i.test(word)?englishWords.has(word.toLowerCase())
   :/^[\p{Script=Hangul}]+$/u.test(word)&&koreanWord(word));
 };
}

export const validateOperationalProse = createValidator(operationalProseLanguage);
const validateAnalysis = createValidator(extensionAnalysisProseLanguage);
/** Analysis exposes only selected component IDs, without artifact public terms. */
export function validateExtensionOperationalProse(raw: string, componentIds: readonly string[]): boolean {
 return validateAnalysis(raw, {componentIds, publicTerms: []});
}
