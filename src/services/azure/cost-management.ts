import "server-only";
import { z } from "zod";
import { actualCostSchema, actualCostWindowsSchema } from "@/lib/completion/schema";
import type { ActualCost, ActualCostRow, ActualCostWindows } from "@/types/assessment";
import type { ComponentResult, CompletionReasonCode } from "@/types/completion";
import { azureRequest, ARM_BASE_URL, AzureRequestError, type AzureRequestDeps } from "./request";
import { parseCostPage, costPeriods, costTotals } from "@/lib/assessment/cost-management-parse";
export { costPeriods } from "@/lib/assessment/cost-management-parse";

// https://learn.microsoft.com/en-us/rest/api/cost-management/query/usage
export const COST_API_VERSION = "2026-06-01";
const endpoint = (id: string) => `/subscriptions/${id}/providers/Microsoft.CostManagement/query`;
type SubscriptionResult = { subscriptionId: string; state: "available" | "partial" | "unavailable" | "failed";
  reason?: CompletionReasonCode; paginationComplete: boolean };
export type CostCollectionScope = ActualCost["scope"] & { subscriptions: SubscriptionResult[] };
export type ActualCostCollection = { retrievedAt: string; actualCost: ActualCostWindows;
  scopes: { monthToDate: CostCollectionScope; trailing30Days: CostCollectionScope } };

// API 버전·쿼리 경로·구독을 바꾸는 링크는 bearer token을 얻기 전에 거절한다.
function continuation(raw: string, subscriptionId: string): { path: string; key: string } {
  const url = new URL(raw);
  const expected = endpoint(subscriptionId);
  decodeURIComponent(raw); // URL은 잘못된 percent encoding을 자동 거절하지 않는다.
  const rawPath = raw.slice(ARM_BASE_URL.length).split("?")[0];
  if (!raw.startsWith(`${ARM_BASE_URL}/`) || url.origin !== ARM_BASE_URL || url.username || url.password || url.hash
    || url.pathname !== rawPath || rawPath.toLowerCase() !== expected.toLowerCase() || /[\s\\#]/u.test(raw)) throw new Error("Invalid continuation.");
  const seen = new Set<string>();
  for (const [key, value] of url.searchParams) {
    const name = key.toLowerCase();
    if (seen.has(name) || !["api-version", "$skiptoken"].includes(name) || !value.trim()) throw new Error("Invalid continuation.");
    seen.add(name);
  }
  if (url.searchParams.get("api-version") !== COST_API_VERSION) throw new Error("Invalid continuation.");
  return { path: raw.slice(ARM_BASE_URL.length), key: JSON.stringify([...url.searchParams]
    .map(([key, value]) => [key.toLowerCase(), value]).sort(([a], [b]) => a < b ? -1 : 1)) };
}
function errorReason(error: unknown): CompletionReasonCode {
  if (error instanceof AzureRequestError) {
    if (["forbidden", "timeout", "throttled", "invalid-response"].includes(error.kind)) return error.kind as CompletionReasonCode;
    if (error.kind === "not-found" || (error.kind === "http" && error.status === 400)) return "not-supported";
  }
  if (error instanceof Error && error.name === "AzureCredentialError") return "auth-failed";
  return "internal";
}

/** 호출자는 저장 성공 스캔의 소속/범위를 확인한다. 두 기간은 독립적으로 수집하며 실제 금액만 보존한다. */
export async function collectActualCosts(
  args: { subscriptionIds: readonly string[]; resourceIds: readonly string[]; retrievedAt?: string },
  deps: AzureRequestDeps & { maxPages?: number; maxRows?: number },
): Promise<ActualCostCollection> {
  const parsed = z.array(z.guid().toLowerCase()).nonempty().safeParse(args.subscriptionIds);
  const maxPages = deps.maxPages ?? 100;
  const maxRows = deps.maxRows ?? 50_000;
  if (!parsed.success || new Set(parsed.data).size !== parsed.data.length
    || !Number.isSafeInteger(maxPages) || maxPages <= 0 || !Number.isSafeInteger(maxRows) || maxRows <= 0) throw new AzureRequestError("disallowed");
  const requestedSubscriptionIds = [...parsed.data].sort();
  const retrievedAt = args.retrievedAt ?? new Date().toISOString();
  const periods = costPeriods(retrievedAt);

  async function collect(period: ActualCost["period"]): Promise<{ value: ComponentResult<ActualCost>; scope: CostCollectionScope }> {
    const rows: ActualCostRow[] = [];
    const subscriptions: SubscriptionResult[] = [];
    const body = { type: "ActualCost", timeframe: "Custom", timePeriod: { from: period.from, to: period.to },
      dataset: { granularity: "None", aggregation: { totalCost: { name: "PreTaxCost", function: "Sum" } },
        grouping: [{ type: "Dimension", name: "ResourceId" }] } };
    for (const subscriptionId of requestedSubscriptionIds) {
      if (period.from === period.to) {
        subscriptions.push({ subscriptionId, state: "unavailable", reason: "no-data", paginationComplete: false });
        continue;
      }
      let link: string | null = `${ARM_BASE_URL}${endpoint(subscriptionId)}?api-version=${COST_API_VERSION}`;
      let pages = 0;
      let received = false;
      let reason: CompletionReasonCode | undefined;
      const start = rows.length;
      const visited = new Set<string>();
      while (link !== null) {
        if (pages >= maxPages || rows.length >= maxRows) { reason = "collection-partial"; break; }
        let path: string;
        try {
          const safe = continuation(link, subscriptionId);
          if (visited.has(safe.key)) throw new Error("Cycle.");
          visited.add(safe.key); path = safe.path;
        } catch { reason = "invalid-response"; break; }
        let raw: unknown;
        try { raw = await azureRequest({ method: "POST", path, body }, deps); }
        catch (error) { reason = errorReason(error); break; }
        let page: ReturnType<typeof parseCostPage>;
        try { page = parseCostPage(raw, subscriptionId, args.resourceIds); }
        catch { reason = "invalid-response"; break; }
        pages++; received = true;
        const remaining = maxRows - rows.length;
        rows.push(...page.rows.slice(0, remaining));
        if (page.rows.length > remaining) { reason = "collection-partial"; break; }
        link = page.nextLink;
      }
      // 빈 성공도 조회 범위에는 남긴다. 저장할 금액 행은 만들지 않는다.
      const state = !reason ? "available" : rows.length > start ? "partial"
        : ["forbidden", "auth-failed", "not-supported"].includes(reason) ? "unavailable" : "failed";
      subscriptions.push({ subscriptionId, state, ...(reason ? { reason } : {}), paginationComplete: !reason && received });
    }
    const scope: CostCollectionScope = { kind: "subscriptions", requestedSubscriptionIds,
      availableSubscriptionIds: subscriptions.filter(s => s.state === "available" || s.state === "partial").map(s => s.subscriptionId),
      paginationComplete: subscriptions.every(s => s.paginationComplete), subscriptions };
    const reasons = [...new Set(subscriptions.flatMap(s => s.reason ? [s.reason] : []))].sort();
    if (!rows.length) return { scope, value: reasons.length
      ? { state: subscriptions.some(s => s.state === "failed") ? "failed" : "unavailable", reason: reasons[0] }
      : { state: "unavailable", reason: "no-data" } };
    const totals = costTotals(rows);
    const data = actualCostSchema.safeParse({ schemaVersion: 1, retrievedAt, period,
      scope: { kind: scope.kind, requestedSubscriptionIds, availableSubscriptionIds: scope.availableSubscriptionIds, paginationComplete: scope.paginationComplete }, rows, totals });
    // 유한 행들의 합계도 overflow할 수 있다. 정제된 실패만 반환한다.
    if (!data.success) return { scope, value: { state: "failed", reason: "invalid-response" } };
    return { scope, value: reasons.length ? { state: "partial", data: data.data, reasons } : { state: "available", data: data.data } };
  }
  const monthToDate = await collect(periods.monthToDate);
  const trailing30Days = await collect(periods.trailing30Days);
  return { retrievedAt, actualCost: actualCostWindowsSchema.parse({ schemaVersion: 1, monthToDate: monthToDate.value, trailing30Days: trailing30Days.value }),
    scopes: { monthToDate: monthToDate.scope, trailing30Days: trailing30Days.scope } };
}
