import { z } from "zod";
import { advisorResultSchema } from "@/lib/completion/schema";
import { isCanonicalArmResourceId } from "@/lib/inventory/normalize";
import type { CompletionReasonCode } from "@/types/completion";
import { advisorCatalog } from "./advisor-catalog";

export function parseAdvisorPage(raw: unknown): { value: unknown[]; nextLink: string | null } {
  const parsed = z.object({ value: z.array(z.unknown()), nextLink: z.string().min(1).nullish() }).safeParse(raw);
  if (!parsed.success) throw new Error("Invalid Advisor page.");
  return { value: parsed.data.value, nextLink: parsed.data.nextLink ?? null };
}
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value)
  ? value as Record<string, unknown> : {};
const canonical = (value: unknown) => typeof value === "string" ? value.trim().toLowerCase() : "";

// 받은 행만 센다. 미수집 페이지와 권한 상태는 호출자의 scope가 별도로 보존한다.
export function mapAdvisorRows(rows: readonly { subscriptionId: string; value: unknown }[], resourceIds: readonly string[], retrievedAt: string) {
  const inventory = new Set(resourceIds.map(canonical).filter(isCanonicalArmResourceId));
  const seen = new Set<string>();
  const recommendations = [];
  const counts = new Map<CompletionReasonCode, number>();
  const exclude = (code: CompletionReasonCode) => counts.set(code, (counts.get(code) ?? 0) + 1);
  for (const row of rows) {
    const item = object(row.value);
    const id = canonical(item.id);
    const prefix = `/subscriptions/${row.subscriptionId}/`;
    if (!id.startsWith(prefix) || /[\\?#%\p{Cc}\p{Zl}\p{Zp}]/u.test(id)
      || id.split("/").some(segment => segment === "." || segment === "..") || !/^\/subscriptions\/[^/]+\/(?:resourcegroups\/[^/]+\/(?:providers\/[^/]+\/(?:[^/]+\/[^/]+\/)*?)?)?providers\/microsoft\.advisor\/recommendations\/[^/\s?#%\\]+$/u.test(id)) {
      exclude("invalid-data"); continue;
    }
    if (seen.has(id)) { exclude("invalid-data"); continue; }
    seen.add(id);
    const properties = object(item.properties);
    const type = properties.recommendationTypeId;
    if (type === undefined || type === null || type === "") { exclude("unmapped-advisor-type"); continue; }
    const parsedType = z.guid().safeParse(type);
    if (!parsedType.success) { exclude("invalid-data"); continue; }
    const entry = advisorCatalog.entries.find(entry => entry.recommendationTypeId === parsedType.data.toLowerCase());
    if (!entry) { exclude("unmapped-advisor-type"); continue; }
    const resourceId = canonical(object(properties.resourceMetadata).resourceId);
    if (!resourceId) { exclude("missing-data"); continue; }
    if (!isCanonicalArmResourceId(resourceId) || !resourceId.startsWith(prefix)) { exclude("invalid-data"); continue; }
    if (!inventory.has(resourceId)) { exclude("scope-not-collected"); continue; }
    // GUID 일치만으로 리소스 타입까지 맞다고 추정하지 않는다.
    const segments = resourceId.split("/");
    // v1 매핑은 리소스 그룹의 일반 리소스 타입만 지원한다. 이름을 경로 키워드로 해석하지 않는다.
    const resourceType = [segments[6], ...segments.slice(7).filter((_, i) => i % 2 === 0)].join("/");
    if (!entry.resourceTypes.includes(resourceType)) { exclude("unsupported-type"); continue; }
    recommendations.push({ recommendationId: id, recommendationTypeId: entry.recommendationTypeId,
      resourceId, ruleId: entry.ruleId, actionId: entry.actionId });
  }
  recommendations.sort((a, b) => a.recommendationId < b.recommendationId ? -1 : a.recommendationId > b.recommendationId ? 1 : 0);
  return advisorResultSchema.parse({ schemaVersion: 1, retrievedAt, mappingVersion: advisorCatalog.version,
    recommendations, coverage: { total: rows.length, included: recommendations.length, excluded: rows.length - recommendations.length,
      reasons: [...counts].sort(([a], [b]) => a < b ? -1 : 1).map(([code, count]) => ({ code, count })) } });
}
