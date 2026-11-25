import "server-only";
import { assessmentResultSchema } from "@/lib/completion/schema";
import { parseAssessmentRules } from "@/lib/assessment/rules/catalog";
import type { LocalizedText } from "@/types/i18n";
import type { AssessmentCatalogData, AssessmentResult, CodeFinding } from "@/types/assessment";

export class RoadmapContextError extends Error {
  constructor() { super("assessment-roadmap-context-invalid"); this.name = "RoadmapContextError"; }
}
export type RoadmapFinding = {
  alias: string; type: string; verdict: "violation" | "unknown";
  severity: CodeFinding["severity"]; ruleId: string; actionAlias: string;
};
export type RoadmapPayload = {
  schemaVersion: 1;
  coverage: { unit: "findings"; total: number; included: number; excluded: number;
    reasons: { code: "pass-finding"; count: number }[] };
  findings: RoadmapFinding[];
  actions: { alias: string; ruleId: string; findingAliases: string[]; meaning: { title: LocalizedText; remediation: LocalizedText } }[];
};
export type RoadmapContext = { state: "ready"; payload: RoadmapPayload }
  | { state: "no-data"; reason: "no-data"; payload: RoadmapPayload };
type PrivateBinding = { assessment: AssessmentResult; catalogData: AssessmentCatalogData;
  findingIds: Record<string, string>; actionRuleIds: Record<string, string> };
// JSON/props/spread에 private ID·카탈로그 문구가 섞이지 않도록 핸들과 별도 보관한다.
const bindings = new WeakMap<RoadmapContext, PrivateBinding>();
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const alias = (prefix: string, index: number) => `${prefix}${String(index + 1).padStart(6, "0")}`;
function resourceType(id: string): string {
  const parts = id.split("/");
  let provider = 5;
  for (let i = 9; i < parts.length; i += 2) if (parts[i] === "providers") provider = i;
  return [parts[provider + 1], ...parts.slice(provider + 2).filter((_, i) => i % 2 === 0)].join("/");
}
function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
/** 이미 서버에서 원본 소속·저장 증거를 검증한 parent와 당시 카탈로그만 받는다.
 * 별도 inventory, 사용자 요구사항, Advisor/비용/diff를 모델에 투영하지 않는다.
 */
export function buildRoadmapContext(raw: AssessmentResult, catalogData: AssessmentCatalogData): RoadmapContext {
  try {
    const assessment = assessmentResultSchema.parse(raw);
    const rules = parseAssessmentRules(catalogData.rules);
    if (assessment.local.rulesVersion !== rules.version) throw new Error();
    const byId = new Map(rules.rules.map(r => [r.id as string, r]));
    const sorted = [...assessment.local.findings].sort((a, b) => compare(a.id, b.id));
    for (const finding of sorted) {
      const rule = byId.get(finding.ruleId);
      if (!rule || rule.version !== finding.ruleVersion || rule.severity !== finding.severity || rule.pillar !== finding.pillar
        || !rule.resourceTypes.includes(resourceType(finding.resourceId))
        || !assessment.sourceScan.subscriptionIds.includes(finding.resourceId.split("/")[2])) throw new Error();
    }
    const eligible = sorted.filter(f => f.verdict !== "pass");
    const ruleIds = [...new Set(eligible.map(f => f.ruleId))].sort(compare);
    // 전체 finding 순위에서 별칭을 정해 pass 제외나 입력 순서에 따라 별칭이 흔들리지 않는다.
    const findingAliases = new Map(sorted.map((f, i) => [f.id, alias("f", i)]));
    const actionAliases = new Map([...byId.keys()].sort(compare).map((id, i) => [id, alias("a", i)]));
    const findings: RoadmapFinding[] = eligible.map(f => ({ alias: findingAliases.get(f.id)!, type: resourceType(f.resourceId),
      verdict: f.verdict as "violation" | "unknown", severity: f.severity, ruleId: f.ruleId, actionAlias: actionAliases.get(f.ruleId)! }));
    const excluded = sorted.length - findings.length;
    const payload: RoadmapPayload = { schemaVersion: 1,
      coverage: { unit: "findings", total: sorted.length, included: findings.length, excluded,
        reasons: excluded ? [{ code: "pass-finding", count: excluded }] : [] }, findings,
      actions: ruleIds.map(id => ({ alias: actionAliases.get(id)!, ruleId: id,
        findingAliases: findings.filter(f => f.ruleId === id).map(f => f.alias),
        meaning: { title: byId.get(id)!.title, remediation: byId.get(id)!.remediation } })) };
    const context: RoadmapContext = findings.length ? { state: "ready", payload } : { state: "no-data", reason: "no-data", payload };
    bindings.set(context, { assessment, catalogData: structuredClone({ ...catalogData, rules }),
      findingIds: Object.fromEntries(eligible.map(f => [findingAliases.get(f.id)!, f.id])),
      actionRuleIds: Object.fromEntries(ruleIds.map(id => [actionAliases.get(id)!, id])) });
    return freeze(context);
  } catch { throw new RoadmapContextError(); }
}
/** 서버 내부 검증 전용. 호출자 변경이 원래 요청의 매핑/근거를 바꾸지 못한다. */
export function readRoadmapBinding(context: RoadmapContext): PrivateBinding {
  const binding = bindings.get(context);
  if (!binding) throw new RoadmapContextError();
  return structuredClone(binding);
}
