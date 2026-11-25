import "server-only";
import { z } from "zod";
import { azureRequest, ARM_BASE_URL, AzureRequestError, type AzureRequestDeps } from "./request";
import { mapAdvisorRows, parseAdvisorPage } from "@/lib/assessment/advisor-parse";
import type { AdvisorResult } from "@/types/assessment";
import type { ComponentResult, CompletionReasonCode } from "@/types/completion";

export const ADVISOR_API_VERSION = "2026-10-01";
const endpoint = (id: string) => `/subscriptions/${id}/providers/Microsoft.Advisor/recommendations`;
type SubscriptionResult = { subscriptionId: string; state: "available" | "partial" | "unavailable" | "failed";
  reason?: CompletionReasonCode; paginationComplete: boolean };
export type AdvisorCollection = {
  retrievedAt: string; advisor: ComponentResult<AdvisorResult>;
  scope: { requestedSubscriptionIds: string[]; availableSubscriptionIds: string[]; paginationComplete: boolean; subscriptions: SubscriptionResult[] };
};

// 인증 전에 링크 전체를 검사하고 URL 정규화로 경로가 바뀌는 입력도 거절한다.
function continuation(raw: string, subscriptionId: string): { path: string; key: string } {
  const url = new URL(raw);
  const expected = endpoint(subscriptionId);
  if (!raw.startsWith(`${ARM_BASE_URL}${expected}?`) || url.origin !== ARM_BASE_URL || url.username || url.password || url.hash
    || url.pathname !== expected || /[\s\\#]/u.test(raw)) throw new Error("Invalid continuation.");
  const seen = new Set<string>();
  for (const [key, value] of url.searchParams) {
    const normalized = key.toLowerCase();
    if (seen.has(normalized) || !["api-version", "$skiptoken", "$top"].includes(normalized) || !value.trim()) throw new Error("Invalid continuation.");
    if (normalized === "$top" && (!/^\d+$/u.test(value) || Number(value) < 1 || Number(value) > 2147483647)) throw new Error("Invalid continuation.");
    seen.add(normalized);
  }
  if (url.searchParams.get("api-version") !== ADVISOR_API_VERSION) throw new Error("Invalid continuation.");
  const key = [...url.searchParams].map(([key, value]) => [key.toLowerCase(), value]).sort(([a], [b]) => a < b ? -1 : 1);
  return { path: raw.slice(ARM_BASE_URL.length), key: JSON.stringify(key) };
}
function errorReason(error: unknown): CompletionReasonCode {
  if (error instanceof AzureRequestError) {
    if (["forbidden", "timeout", "throttled", "invalid-response"].includes(error.kind)) return error.kind as CompletionReasonCode;
    if (error.kind === "not-found") return "not-supported";
  }
  if (error instanceof Error && error.name === "AzureCredentialError") return "auth-failed";
  return "internal";
}

/** 호출자가 저장된 성공 스캔의 소속과 범위를 확인한다. 캐시된 Advisor 권장 사항만 읽는다. */
export async function collectAdvisorRecommendations(
  args: { subscriptionIds: readonly string[]; resourceIds: readonly string[]; retrievedAt?: string },
  deps: AzureRequestDeps & { maxPages?: number; maxRows?: number },
): Promise<AdvisorCollection> {
  const maxPages = deps.maxPages ?? 100;
  const maxRows = deps.maxRows ?? 50_000;
  const parsed = z.array(z.guid().toLowerCase()).nonempty().safeParse(args.subscriptionIds);
  const retrievedAt = args.retrievedAt ?? new Date().toISOString();
  if (!parsed.success || new Set(parsed.data).size !== parsed.data.length || !z.iso.datetime({ offset: true }).safeParse(retrievedAt).success
    || !Number.isSafeInteger(maxPages) || maxPages <= 0 || !Number.isSafeInteger(maxRows) || maxRows <= 0) throw new AzureRequestError("disallowed");
  const requestedSubscriptionIds = [...parsed.data].sort();
  const rows: { subscriptionId: string; value: unknown }[] = [];
  const subscriptions: SubscriptionResult[] = [];
  for (const subscriptionId of requestedSubscriptionIds) {
    let link: string | null = `${ARM_BASE_URL}${endpoint(subscriptionId)}?api-version=${ADVISOR_API_VERSION}`;
    const visited = new Set<string>();
    let pages = 0;
    let received = false;
    let reason: CompletionReasonCode | undefined;
    while (link !== null) {
      // 상한과 순환은 다음 토큰을 얻기 전에 판정한다.
      if (pages >= maxPages || rows.length >= maxRows) { reason = "collection-partial"; break; }
      let path: string;
      try {
        const safe = continuation(link, subscriptionId);
        if (visited.has(safe.key)) throw new Error("Cycle.");
        visited.add(safe.key); path = safe.path;
      } catch { reason = "invalid-response"; break; }
      let raw: unknown;
      try { raw = await azureRequest({ method: "GET", path }, deps); }
      catch (error) { reason = errorReason(error); break; }
      let page: ReturnType<typeof parseAdvisorPage>;
      try { page = parseAdvisorPage(raw); }
      catch { reason = "invalid-response"; break; }
      pages++; received = true;
      const remaining = maxRows - rows.length;
      rows.push(...page.value.slice(0, remaining).map(value => ({ subscriptionId, value })));
      if (page.value.length > remaining) { reason = "collection-partial"; break; }
      link = page.nextLink;
    }
    const state = !reason ? "available" : received ? "partial" : ["forbidden", "auth-failed", "not-supported"].includes(reason) ? "unavailable" : "failed";
    subscriptions.push({ subscriptionId, state, ...(reason ? { reason } : {}), paginationComplete: !reason });
  }
  const data = mapAdvisorRows(rows, args.resourceIds, retrievedAt);
  const reasons = [...new Set([...subscriptions.flatMap(s => s.reason ? [s.reason] : []), ...data.coverage.reasons.map(r => r.code)])].sort();
  const anyData = subscriptions.some(s => s.state === "available" || s.state === "partial");
  const advisor: ComponentResult<AdvisorResult> = anyData
    ? reasons.length ? { state: "partial", data, reasons } : { state: "available", data }
    : { state: subscriptions.some(s => s.state === "failed") ? "failed" : "unavailable", reason: reasons[0] ?? "internal" };
  return { retrievedAt, advisor, scope: { requestedSubscriptionIds,
    availableSubscriptionIds: subscriptions.filter(s => s.state === "available" || s.state === "partial").map(s => s.subscriptionId),
    paginationComplete: subscriptions.every(s => s.paginationComplete), subscriptions } };
}
