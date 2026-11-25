import { z } from "zod";
import raw from "@/catalog/assessment-rules.json";
import { pillarSchema, severitySchema } from "@/lib/completion/schema";

// evaluatorId는 판정 코드의 닫힌 계약이다. 미지원 evaluator로 대체하지 않는다.
const evaluatorContracts = {
  "web-https-only": {
    "resourceTypes": [
      "microsoft.web/sites",
      "microsoft.web/sites/slots"
    ],
    "requiredPaths": [
      "/properties/httpsOnly"
    ]
  },
  "web-minimum-tls": {
    "resourceTypes": [
      "microsoft.web/sites",
      "microsoft.web/sites/slots"
    ],
    "requiredPaths": [
      "/properties/siteConfig/minTlsVersion"
    ]
  },
  "storage-https-only": {
    "resourceTypes": [
      "microsoft.storage/storageaccounts"
    ],
    "requiredPaths": [
      "/properties/supportsHttpsTrafficOnly"
    ]
  },
  "storage-minimum-tls": {
    "resourceTypes": [
      "microsoft.storage/storageaccounts"
    ],
    "requiredPaths": [
      "/properties/minimumTlsVersion"
    ]
  },
  "storage-disallow-blob-public-access": {
    "resourceTypes": [
      "microsoft.storage/storageaccounts"
    ],
    "requiredPaths": [
      "/properties/allowBlobPublicAccess"
    ]
  },
  "sql-minimum-tls": {
    "resourceTypes": [
      "microsoft.sql/servers"
    ],
    "requiredPaths": [
      "/properties/minimalTlsVersion"
    ]
  },
  "keyvault-soft-delete": {
    "resourceTypes": [
      "microsoft.keyvault/vaults"
    ],
    "requiredPaths": [
      "/properties/enableSoftDelete"
    ]
  },
  "keyvault-purge-protection": {
    "resourceTypes": [
      "microsoft.keyvault/vaults"
    ],
    "requiredPaths": [
      "/properties/enablePurgeProtection",
      "/properties/enableSoftDelete"
    ]
  },
  "nsg-management-ports": {
    "resourceTypes": [
      "microsoft.network/networksecuritygroups"
    ],
    "requiredPaths": [
      "/properties/securityRules"
    ]
  }
} as const;

export type AssessmentEvaluatorId = keyof typeof evaluatorContracts;
const evaluatorIds = Object.keys(evaluatorContracts) as [AssessmentEvaluatorId, ...AssessmentEvaluatorId[]];
const evaluatorId = z.enum(evaluatorIds);
const text = z.string().min(1).max(2000).refine(value => value.trim().length > 0);
const localized = z.strictObject({
  en: text.refine(value => !/\p{Script=Hangul}/u.test(value)),
  ko: text.refine(value => /\p{Script=Hangul}/u.test(value)),
}).refine(value => !/https?:\/\/|www\./i.test(value.en + value.ko));
const version = z.string().regex(/^\d+\.\d+\.\d+$/);
const propertyPath = z.string().regex(/^\/properties(?:\/(?:[A-Za-z0-9_-]|~[01])+)+$/);
const approvedSources = new Set([
  "https://learn.microsoft.com/en-us/azure/templates/microsoft.web/sites",
  "https://learn.microsoft.com/en-us/azure/templates/microsoft.web/sites/config",
  "https://learn.microsoft.com/en-us/azure/templates/microsoft.storage/storageaccounts",
  "https://learn.microsoft.com/en-us/azure/templates/microsoft.sql/servers",
  "https://learn.microsoft.com/en-us/azure/templates/microsoft.keyvault/vaults",
  "https://learn.microsoft.com/en-us/azure/templates/microsoft.network/networksecuritygroups/securityrules",
  "https://learn.microsoft.com/en-us/azure/virtual-network/network-security-groups-overview",
  "https://learn.microsoft.com/en-us/azure/defender-for-cloud/just-in-time-access-usage",
]);
const source = z.url().refine(value => approvedSources.has(value));
const unique = (values: readonly string[]) => new Set(values).size === values.length;
const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every(v => b.includes(v));

export const assessmentRuleSchema = z.strictObject({
  id: evaluatorId,
  evaluatorId,
  version,
  pillar: pillarSchema,
  severity: severitySchema,
  resourceTypes: z.array(z.string().regex(/^microsoft\.[a-z0-9.]+(?:\/[a-z0-9]+)+$/)).min(1).refine(unique),
  requiredPaths: z.array(propertyPath).min(1).refine(unique),
  title: localized,
  description: localized,
  remediation: localized,
  sources: z.array(source).min(1).refine(unique),
}).superRefine((rule, context) => {
  const contract = evaluatorContracts[rule.id];
  if (rule.id !== rule.evaluatorId || !sameSet(rule.resourceTypes, contract.resourceTypes)
    || !sameSet(rule.requiredPaths, contract.requiredPaths)) {
    context.addIssue({ code: "custom", message: "규칙과 evaluator의 대상·필수 경로가 일치해야 합니다." });
  }
});

export const assessmentRuleCatalogSchema = z.strictObject({
  schemaVersion: z.literal(1),
  version,
  rules: z.array(assessmentRuleSchema).length(evaluatorIds.length),
}).refine(value => unique(value.rules.map(rule => rule.id)), "규칙 ID는 중복할 수 없습니다.");

export type AssessmentRule = z.infer<typeof assessmentRuleSchema>;
export type AssessmentRuleCatalog = z.infer<typeof assessmentRuleCatalogSchema>;

export class AssessmentCatalogError extends Error {
  constructor() { super("assessment-catalog-invalid"); this.name = "AssessmentCatalogError"; }
}

/** 정적 JSON만 검증한다. 파일/네트워크/DB I/O와 모델 호출은 없다. */
export function parseAssessmentRules(value: unknown): AssessmentRuleCatalog {
  const result = assessmentRuleCatalogSchema.safeParse(value);
  if (!result.success) throw new AssessmentCatalogError();
  return result.data;
}

export function loadAssessmentRules(): AssessmentRuleCatalog {
  return parseAssessmentRules(raw);
}

/** 호출 순서와 무관한 사전순. 미지원 타입은 판정 없이 빈 목록이다. */
export function listAssessmentRules(catalog: AssessmentRuleCatalog, resourceType?: string): AssessmentRule[] {
  return catalog.rules.filter(rule => resourceType === undefined || rule.resourceTypes.includes(resourceType))
    .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}
