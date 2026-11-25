import {describe,expect,it} from 'vitest';
import {artifactProseLanguage,validateArtifactDomainProse} from './prose-language';
const references={componentIds:['postgres-flex-b1ms','virtual-network'],publicTerms:['canadacentral']};
const valid=(value:string)=>validateArtifactDomainProse(value,references);
describe('positive compositional artifact language',()=>{
 it.each([
  'Review authentication and access permissions before integration. Record the results and investigate failures.',
  'Use retries with bounded delays to reduce transient errors. Test recovery in an isolated environment.',
  'Compare the saved estimate with observed usage; capacity and connectivity remain unverified.',
  'Rotate credentials through secure parameters, separate access roles, and review audit logs.',
  'Integrate postgres-flex-b1ms with the selected workload in canadacentral.',
  '연결 전에 인증과 접근 권한을 확인합니다. 실패 원인을 기록하고 복구 절차를 검토합니다.',
  '격리된 환경에서 재시도와 복구를 테스트하고 관측 결과를 기록합니다.',
  '저장된 견적과 관측 사용량을 비교합니다. 용량과 연결 가능 여부는 확인되지 않았습니다.',
  'postgres-flex-b1ms를 선택한 워크로드에 연결하기 전에 설정을 검토합니다.',
 ])('allows composed operational explanations: %s',value=>expect(valid(value)).toBe(true));
 it.each([
  'Use snowflake for monitoring.','Use DaTaDoG for monitoring.','Use prometheus for monitoring.',
  'Use ＳＮＯＷＦＬＡＫＥ for monitoring.','Use snоwflake for monitoring.',
  '스노우플레이크를 사용합니다.','데이터독으로 모니터링합니다.','데이터도그를 연결합니다.',
  'snowflake를 사용합니다.','데이터독API를 사용합니다.','임의외부도구를 사용합니다.',
  'Use private-customer-backend for integration.','Use app-service-linux-b1 for integration.',
  'Use canadacentralforeign for integration.','Use Canadacentral for integration.',
 ])('rejects unknown product/identity tokens without a brand blacklist: %s',value=>expect(valid(value)).toBe(false));
 it('publishes only operational vocabulary and bounded Korean grammar, with no product names or private context',()=>{
  expect(artifactProseLanguage.policyVersion).toBe('extend-operational-prose-v1');
  expect(artifactProseLanguage.enWords).toContain('recovery');
  expect(artifactProseLanguage.koRoots).toContain('복구');
  expect(JSON.stringify(artifactProseLanguage)).not.toMatch(/snowflake|datadog|sample-rg|postgres-flex/);
 });
 it('does not accept arbitrary Korean prefixes/suffixes around permitted roots',()=>{
  for(const value of ['악성확인합니다.','확인브랜드합니다.','데이터독검토합니다.','설정스노우플레이크'])expect(valid(value)).toBe(false);
 });
});
