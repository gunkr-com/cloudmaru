import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { operationalProseLanguage, extensionAnalysisProseLanguage, validateOperationalProse, validateExtensionOperationalProse } from "./operational-prose";
import { artifactProseLanguage, validateArtifactDomainProse } from "../extend-artifacts/prose-language";

const ids = ["postgres-flex-b1ms", "virtual-network"];
describe("shared reviewed operational language", () => {
  it("preserves the artifact vocabulary and public-reference semantics exactly", () => {
    expect(operationalProseLanguage).toEqual(artifactProseLanguage);
    expect(createHash("sha256").update(JSON.stringify(operationalProseLanguage)).digest("hex")).toBe("2359584a488fc43b8fb0a03f1617b36bd8322765b438c9e2088f444f281cab95");
    const references = { componentIds: ids, publicTerms: ["canadacentral"] };
    for (const text of ["Review recovery in canadacentral.", "postgres-flex-b1ms를 확인합니다.", "Use snowflake.", "Use Canadacentral."]) {
      expect(validateOperationalProse(text, references)).toBe(validateArtifactDomainProse(text, references));
    }
  });
  it.each([
    "Extend the saved workload", "Add a self-service portal", "Expand the web-app workload",
    "Reuse the network-related configuration", "Host an ASP.NET workload", "Host a .NET workload",
    "Review authentication and access permissions before integration. Record the results and investigate failures.",
    "Use retries with bounded delays to reduce transient errors. Test recovery in an isolated environment.",
    "Compare the saved estimate with observed usage; capacity and connectivity remain unverified.",
    "Rotate credentials through secure parameters, separate access roles, and review audit logs.",
    "Use (postgres-flex-b1ms), with virtual-network; review recovery.",
    "연결 전에 인증과 접근 권한을 확인합니다. 실패 원인을 기록하고 복구 절차를 검토합니다.",
    "격리된 환경에서 재시도와 복구를 테스트하고 관측 결과를 기록합니다.",
    "저장된 견적과 관측 사용량을 비교합니다. 용량과 연결 가능 여부는 확인되지 않았습니다.",
    "postgres-flex-b1ms를 선택한 워크로드에 연결하기 전에 설정을 검토합니다.",
  ])("permits existing ordinary fixtures and varied composed advice: %s", text => {
    expect(validateExtensionOperationalProse(text, ids)).toBe(true);
  });
  it.each([
    "Use snowflake for monitoring.", "Use DaTaDoG for monitoring.", "Use ＳＮＯＷＦＬＡＫＥ for monitoring.",
    "Use snоwflake for monitoring.", "Use zyrquolix for monitoring.",
    "스노우플레이크를 사용합니다.", "데이터독으로 모니터링합니다.", "데이터도그를 연결합니다.",
    "snowflake를 사용합니다.", "데이터독API를 사용합니다.", "임의외부도구를 사용합니다.",
    "Use Canadacentral for recovery.", "Use canadacentral for recovery.",
    "Use private-customer-backend.", "Use app-service-linux-b1.",
    "악성확인합니다.", "확인브랜드합니다.", "데이터독검토합니다.", "설정스노우플레이크",
  ])("rejects unknown words without learning from context: %s", text => {
    expect(validateExtensionOperationalProse(text, ids)).toBe(false);
  });
  it("keeps fixture-only ordinary word additions out of the frozen artifact vocabulary", () => {
    expect(extensionAnalysisProseLanguage.enWords).toContain("extend");
    expect(operationalProseLanguage.enWords).not.toContain("extend");
    expect(validateOperationalProse("Extend the workload", {componentIds: ids, publicTerms: []})).toBe(false);
    expect(extensionAnalysisProseLanguage.koRoots).toEqual(operationalProseLanguage.koRoots);
  });
});
