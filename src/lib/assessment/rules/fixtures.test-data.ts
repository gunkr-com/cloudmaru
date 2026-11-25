import type { AssessmentEvaluatorId } from "./catalog";
import type { FindingVerdict } from "@/types/assessment";
import type { CompletionReasonCode, JsonValue } from "@/types/completion";

type RuleFixture = {
  properties: Record<string, JsonValue>;
  verdict: FindingVerdict;
  reasonCode: CompletionReasonCode | null;
};
const cases = (pass: RuleFixture["properties"], violation: RuleFixture["properties"],
  malformed: RuleFixture["properties"]): RuleFixture[] => [
  { properties: pass, verdict: "pass", reasonCode: null },
  { properties: violation, verdict: "violation", reasonCode: null },
  { properties: {}, verdict: "unknown", reasonCode: "missing-data" },
  { properties: malformed, verdict: "unknown", reasonCode: "invalid-data" },
];
const managementAllow = {
  name: "synthetic-management",
  properties: {
    priority: 100, direction: "Inbound", access: "Allow", protocol: "Tcp",
    sourcePortRange: "*", destinationPortRange: "22", sourceAddressPrefix: "*", destinationAddressPrefix: "*",
  },
};

// 다음 엔진 step의 입력/기대값이다. 카탈로그 검증 통과를 실제 판정으로 간주하지 않는다.
export const ruleFixtures: Record<AssessmentEvaluatorId, RuleFixture[]> = {
  "web-https-only": cases({ httpsOnly: true }, { httpsOnly: false }, { httpsOnly: "true" }),
  "web-minimum-tls": cases({ siteConfig: { minTlsVersion: "1.2" } },
    { siteConfig: { minTlsVersion: "1.0" } }, { siteConfig: { minTlsVersion: 1.2 } }),
  "storage-https-only": cases({ supportsHttpsTrafficOnly: true }, { supportsHttpsTrafficOnly: false },
    { supportsHttpsTrafficOnly: null }),
  "storage-minimum-tls": cases({ minimumTlsVersion: "TLS1_2" }, { minimumTlsVersion: "TLS1_1" },
    { minimumTlsVersion: "TLS1_9" }),
  "storage-disallow-blob-public-access": cases({ allowBlobPublicAccess: false }, { allowBlobPublicAccess: true },
    { allowBlobPublicAccess: "false" }),
  "sql-minimum-tls": cases({ minimalTlsVersion: "1.3" }, { minimalTlsVersion: "None" },
    { minimalTlsVersion: "latest" }),
  "keyvault-soft-delete": cases({ enableSoftDelete: true }, { enableSoftDelete: false }, { enableSoftDelete: 1 }),
  "keyvault-purge-protection": cases({ enableSoftDelete: true, enablePurgeProtection: true },
    { enableSoftDelete: true, enablePurgeProtection: false }, { enableSoftDelete: "true", enablePurgeProtection: true }),
  "nsg-management-ports": cases({ securityRules: [] }, { securityRules: [managementAllow] },
    { securityRules: [{ ...managementAllow, properties: { ...managementAllow.properties, priority: "100" } }] }),
};
