import { createHash } from "node:crypto";
import { assessmentResultSchema, codeFindingSchema, coverageSchema } from "@/lib/completion/schema";
import { canonicalId, isCanonicalArmResourceId } from "@/lib/inventory/normalize";
import type { InventoryResource } from "@/types/inventory";
import type { CodeFinding, FindingVerdict } from "@/types/assessment";
import type { CompletionReasonCode, Evidence, Observation } from "@/types/completion";
import { listAssessmentRules, loadAssessmentRules, type AssessmentRule } from "./catalog";
import { evaluateManagementPorts } from "./nsg";

const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
function observe(row: InventoryResource, path: string): Observation {
  let value: unknown = row;
  for (const key of path.slice(1).split("/")) {
    if (!object(value)) return {state: "invalid", reason: "invalid-data"};
    if (!Object.hasOwn(value, key)) return {state: "missing"};
    value = value[key];
  }
  // 판정에 쓰는 boolean/enum 외의 임의 객체·문자열은 근거로 복사하지 않는다.
  return typeof value === "boolean" || typeof value === "string" ? {state: "present", value}
    : {state: "invalid", reason: "invalid-data"};
}
function validIdentity(resource: InventoryResource): boolean {
  const id = canonicalId(resource.id);
  if (!isCanonicalArmResourceId(id)) return false;
  const parts = id.split("/");
  if (parts[2] !== resource.subscriptionId.trim().toLowerCase() || parts[4] !== resource.resourceGroup.trim().toLowerCase()) return false;
  let provider = 5;
  for (let i = 9; i < parts.length; i += 2) if (parts[i] === "providers") provider = i;
  return [parts[provider + 1], ...parts.slice(provider + 2).filter((_, i) => i % 2 === 0)].join("/") === resource.type.trim().toLowerCase();
}
function stableId(rule: AssessmentRule, resourceId: string): string {
  const hash = createHash("sha256").update(JSON.stringify([rule.id, rule.version, resourceId])).digest("hex").slice(0,32);
  return `${hash.slice(0,8)}-${hash.slice(8,12)}-5${hash.slice(13,16)}-a${hash.slice(17,20)}-${hash.slice(20)}`;
}
function expected(rule: AssessmentRule, value: unknown): FindingVerdict {
  switch (rule.evaluatorId) {
    case "web-https-only": case "storage-https-only": case "keyvault-soft-delete":
    case "keyvault-purge-protection":
      return typeof value === "boolean" ? value ? "pass" : "violation" : "unknown";
    case "storage-disallow-blob-public-access":
      return typeof value === "boolean" ? value ? "violation" : "pass" : "unknown";
    case "web-minimum-tls": case "sql-minimum-tls":
      return value === "1.2" || value === "1.3" ? "pass"
        : value === "1.0" || value === "1.1" || (rule.id === "sql-minimum-tls" && value === "None") ? "violation" : "unknown";
    case "storage-minimum-tls": return value === "TLS1_2" ? "pass" : value === "TLS1_0" || value === "TLS1_1" ? "violation" : "unknown";
    default: return "unknown";
  }
}
/** 반환 ruleId로 카탈로그 remediation/sources를 조회한다. 자유 추천 문장은 만들지 않는다. */
export function evaluateRule(rule: AssessmentRule, resource: InventoryResource, inventory: readonly InventoryResource[] = []): CodeFinding {
  const resourceId = canonicalId(resource.id);
  if (!validIdentity(resource) || !rule.resourceTypes.includes(resource.type.trim().toLowerCase())) throw new Error("assessment-input-invalid");
  let evidence: Evidence[] = rule.requiredPaths.map(propertyPath => ({resourceId, propertyPath, observation: observe(resource, propertyPath)}));
  let verdict: FindingVerdict = "unknown";
  let reasonCode: CompletionReasonCode | null = null;
  if (rule.id === "nsg-management-ports") {
    const result = object(resource.properties) ? evaluateManagementPorts(resource.properties) : {verdict: "unknown" as const, reasonCode: "invalid-data" as const};
    verdict = result.verdict; reasonCode = result.reasonCode;
    // 원본 규칙 blob은 가리고, 검증한 판정 필드만 개별 Pointer로 보존한다.
    evidence = rule.requiredPaths.map(propertyPath => ({resourceId, propertyPath, observation:
      !object(resource.properties) ? {state: "invalid", reason: "invalid-data"}
      : !Object.hasOwn(resource.properties, "securityRules") ? {state: "missing"}
      : Array.isArray(resource.properties.securityRules) ? {state: "present", value: resource.properties.securityRules.length === 0 ? [] : "[redacted]"} : {state: "invalid", reason: "invalid-data"}}));
    if (reasonCode === null && object(resource.properties)) {
      for (const collection of ["securityRules", "defaultSecurityRules"]) {
        const rows = resource.properties[collection];
        if (!Array.isArray(rows)) continue;
        rows.forEach((row, index) => {
          if (!object(row) || !object(row.properties)) return;
          for (const field of ["priority", "direction", "access", "protocol", "sourcePortRange", "sourcePortRanges", "destinationPortRange", "destinationPortRanges", "sourceAddressPrefix", "sourceAddressPrefixes", "destinationAddressPrefix", "destinationAddressPrefixes"]) {
            const value = row.properties[field];
            if (value === undefined) continue;
            evidence.push({resourceId, propertyPath: `/properties/${collection}/${index}/properties/${field}`,
              observation: {state: "present", value: value as string | number | string[]}});
          }
        });
      }
    }
    for (const row of [...inventory].sort((a,b) => canonicalId(a.id) < canonicalId(b.id) ? -1 : 1)) {
      if (!isCanonicalArmResourceId(canonicalId(row.id)) || !["microsoft.network/networkinterfaces", "microsoft.network/virtualnetworks/subnets"].includes(row.type)) continue;
      const nsg = row.properties.networkSecurityGroup;
      if (object(nsg) && typeof nsg.id === "string" && canonicalId(nsg.id) === resourceId) {
        evidence.push({resourceId: canonicalId(row.id), propertyPath: "/properties/networkSecurityGroup/id", observation: {state: "present", value: resourceId}});
      }
    }
    for (const field of ["networkInterfaces", "subnets"]) {
      const properties = resource.properties;
      const value = object(properties) ? properties[field] : undefined;
      evidence.push({resourceId, propertyPath: `/properties/${field}`, observation:
        !object(properties) ? {state: "invalid", reason: "invalid-data"}
        : !Object.hasOwn(properties, field) ? {state: "missing"}
        : !Array.isArray(value) ? {state: "invalid", reason: "invalid-data"}
        : {state: "present", value: value.length ? "[redacted]" : []}});
      if (Array.isArray(value)) value.forEach((reference, index) => {
        if (!object(reference) || typeof reference.id !== "string") return;
        const id = canonicalId(reference.id);
        if (isCanonicalArmResourceId(id) && inventory.some(row => canonicalId(row.id) === id)) {
          evidence.push({resourceId, propertyPath: `/properties/${field}/${index}/id`, observation: {state: "present", value: id}});
        }
      });
    }
  } else {
    evidence = evidence.map(e => e.observation.state === "present" && expected(rule, e.observation.value) === "unknown"
      ? {...e, observation: {state: "invalid", reason: "invalid-data"}} : e);
    const observations = evidence.map(e => e.observation);
    if (observations.some(o => o.state === "invalid")) reasonCode = "invalid-data";
    else if (observations.some(o => o.state === "missing")) reasonCode = "missing-data";
    else {
      const values = observations.map(o => o.state === "present" ? o.value : undefined);
      verdict = expected(rule, values[0]);
      if (rule.id === "keyvault-purge-protection" && (typeof values[1] !== "boolean" || (values[0] === true && values[1] === false))) verdict = "unknown";
      if (verdict === "unknown") reasonCode = "invalid-data";
      // 잘못된 enum/타입 원문은 근거/보고서에 흘리지 않는다.
      evidence = evidence.map((e, index) => {
        const valid = rule.id === "keyvault-purge-protection" ? typeof values[index] === "boolean" : expected(rule, values[index]) !== "unknown";
        return valid ? e : {...e, observation: {state: "invalid", reason: "invalid-data"}};
      });
    }
  }
  return codeFindingSchema.parse({id: stableId(rule, resourceId), ruleId: rule.id, ruleVersion: rule.version, resourceId,
    pillar: rule.pillar, severity: rule.severity, verdict, reasonCode, evidence});
}

/** 입력 행마다 coverage에 한 번만 계상한다. unknown도 포함한 판정 수에 들어간다. */
export function evaluateAssessmentRules(resources: readonly InventoryResource[], evaluatedAt: string) {
  const catalog = loadAssessmentRules();
  const ids = resources.map(r => canonicalId(r.id));
  const counts = new Map<string, number>();
  for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
  const findings: CodeFinding[] = [];
  let included = 0, invalid = 0, unsupported = 0;
  for (const resource of [...resources].sort((a,b) => canonicalId(a.id) < canonicalId(b.id) ? -1 : 1)) {
    const id = canonicalId(resource.id);
    if (!validIdentity(resource) || counts.get(id) !== 1) { invalid++; continue; }
    const rules = listAssessmentRules(catalog, resource.type.trim().toLowerCase());
    if (!rules.length) { unsupported++; continue; }
    included++;
    findings.push(...rules.map(rule => evaluateRule(rule, resource, resources)));
  }
  const result = {rulesVersion: catalog.version, evaluatedAt, coverage: coverageSchema.parse({total: resources.length, included,
    excluded: invalid + unsupported, reasons: [...(invalid ? [{code: "invalid-data", count: invalid}] : []),
      ...(unsupported ? [{code: "no-applicable-rule", count: unsupported}] : [])]}), findings};
  const parsed = assessmentResultSchema.shape.local.safeParse(result);
  if (!parsed.success) throw new Error("assessment-input-invalid");
  return parsed.data;
}
