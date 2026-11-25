import "server-only";
import { z } from "zod";
import { extensionInputSchema } from "@/lib/completion/schema";
import { createExtensionRequestContext } from "@/lib/extend/validate-proposal";
import { buildExtensionPrompt } from "@/lib/extend/prompt";
import { EXTENSION_MODEL_OUTPUT_JSON_SCHEMA, EXTENSION_MODEL_OUTPUT_SCHEMA_NAME } from "@/lib/extend/model-output-schema";
import { processExtensionOutput } from "@/lib/extend/process";
import { ExtensionStorageError } from "@/lib/extend/storage-validation";
import { JOB_MAX_DURATION_SECONDS, isJobStale } from "@/lib/jobs/timing";
import { requestWithValidationRetry } from "@/lib/llm/validation-retry";
import type { ExtensionCoreData } from "@/lib/extend/process";
import type { OperatorPrices } from "@/services/operator-prices";
import type { createExtensionsDb } from "@/services/db/extensions";
import type { CompletionReasonCode } from "@/types/completion";
import type { ExtensionResult } from "@/types/extension";
import type { StructuredLlmRequest, StructuredLlm } from "@/types/analysis";
import type { LlmUsage } from "@/types/llm";

type Store = ReturnType<typeof createExtensionsDb>;
type JobStore = Pick<Store, "getExtension" | "getExtensionSourceScan" | "failExtension">;
export type StartExtensionDeps = JobStore & Pick<Store, "reserveExtension"> & {
  acquireOperatorPrices: () => Promise<OperatorPrices>;
  hasWorkspaceClaudeKey: (workspaceId: string) => Promise<boolean>;
  schedule: (task: () => Promise<void>) => void;
  runJob: (id: string, coreData: ExtensionCoreData) => Promise<void>;
};
export type StartExtensionRequest = { workspaceId: string; body: unknown; sourceExtensionId?: string | null };
export type StartExtensionResult = { status: 202; id: string }
  | { status: 400 | 409 | 500; code: "invalid-body" | "workspace-changed" | "invalid-source" | "claude-unavailable" | "pricing_unavailable" | "internal"; workspaceId?: string };

/** 원문/cause 없이 서비스 오류의 고정 코드와 검증된 사용량만 운반한다. */
export class ExtensionJobError extends Error {
  constructor(readonly code: CompletionReasonCode, readonly usage: LlmUsage | null = null) {
    super(code);
    this.name = "ExtensionJobError";
  }
}
function reason(error: unknown): CompletionReasonCode {
  return error instanceof ExtensionJobError || error instanceof ExtensionStorageError ? error.code : "internal";
}

export async function startExtension(request: StartExtensionRequest, deps: StartExtensionDeps): Promise<StartExtensionResult> {
  const parsed = extensionInputSchema.safeParse(request.body);
  const parentId = z.uuid().nullable().safeParse(request.sourceExtensionId ?? null);
  if (!parsed.success || !parentId.success) return { status: 400, code: "invalid-body" };
  const input = parsed.data;
  try {
    if (parentId.data !== null) {
      const parent = await deps.getExtension(parentId.data);
      if (!parent || parent.workspaceId !== input.workspaceId || parent.sourceScanId !== input.sourceScanId)
        return { status: 409, code: "invalid-source" };
    } else if (input.workspaceId !== request.workspaceId) return { status: 409, code: "workspace-changed" };
    const saved = await deps.getExtensionSourceScan(input.sourceScanId);
    if (!saved || saved.scan.status !== "succeeded" || saved.scan.id !== input.sourceScanId
      || saved.scan.workspaceId !== input.workspaceId) return { status: 409, code: "invalid-source" };
    const pricing = await deps.acquireOperatorPrices();
    if (!pricing.ok) {
      console.warn("Extend pricing unavailable", { reason: pricing.reason });
      return { status: 409, code: "pricing_unavailable" };
    }
    const { catalog, support } = pricing;
    if (!await deps.hasWorkspaceClaudeKey(input.workspaceId)) {
      return { status: 409, code: "claude-unavailable", workspaceId: input.workspaceId };
    }
    const reserved = await deps.reserveExtension(input, { sourceExtensionId: parentId.data });
    if (!reserved) return { status: 409, code: "invalid-source" };
    try { deps.schedule(() => deps.runJob(reserved.id, { catalog, support })); }
    catch {
      await deps.failExtension(reserved.id, "internal").catch(() => undefined);
      return { status: 500, code: "internal" };
    }
    return { status: 202, id: reserved.id };
  } catch { return { status: 500, code: "internal" }; }
}

export type RunExtensionDeps = JobStore & Pick<Store, "completeExtension"> & {
  loadCoreData: () => ExtensionCoreData;
  // 서비스가 매 호출마다 requestCompletionStructuredOutput의 저장 소유자를 다시 읽는다.
  request: (id: string, request: StructuredLlmRequest) => ReturnType<StructuredLlm>;
  now: () => Date;
  onValidation?: (event: ExtensionValidationEvent) => void;
};
export type ExtensionValidationEvent = {attempt: 1 | 2; errors: string[]};
type Outcome = { usage: LlmUsage | null } &
  ({ value: ExtensionResult; coreData: ExtensionCoreData } | { code: CompletionReasonCode });

/** 쿠키/최신 스캔 없이 저장 행을 기준으로 실행한다. 외부 I/O는 주입한 서비스만 사용한다. */
export async function runExtensionJob(id: string, deps: RunExtensionDeps): Promise<void> {
  let stopped = false;
  let timedOut = false;
  let usage: LlmUsage | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const started = deps.now().getTime();
  let budgetMs = JOB_MAX_DURATION_SECONDS * 1000;
  // timeout은 usage=null로 먼저 종료한다. 실제 호출이 끝난 뒤 최종 합산 사용량만 보낸다.
  // DB의 pending-only UPDATE와 id별 청구 멱등성이 늦은 응답/동시 stale 처리를 보호한다.
  const fail = (code: CompletionReasonCode, finalUsage: LlmUsage | null) =>
    deps.failExtension(id, code, finalUsage).catch(() => false);
  let resolveDeadline!: () => void;
  const deadline = new Promise<void>(resolve => { resolveDeadline = resolve; });
  const armDeadline = (milliseconds: number) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      stopped = true; timedOut = true;
      void fail("timeout", null);
      resolveDeadline();
    }, milliseconds);
  };
  armDeadline(budgetMs);
  const work = (async (): Promise<Outcome | null> => {
    try {
      const row = await deps.getExtension(id);
      if (!row || row.status !== "pending") return null;
      if (stopped) return null;
      const now = deps.now();
      if (row.id !== id || row.input.workspaceId !== row.workspaceId || row.input.sourceScanId !== row.sourceScanId
        || !Number.isFinite(now.getTime()) || !Number.isFinite(Date.parse(row.createdAt))
        || Date.parse(row.createdAt) > now.getTime()) throw new ExtensionJobError("validation-failed");
      if (isJobStale(row.createdAt, now)) return { code: "interrupted", usage: null };
      // 워커 예약 지연도 전체 300초에서 차감한다.
      const expires = Math.min(started, Date.parse(row.createdAt)) + JOB_MAX_DURATION_SECONDS * 1000;
      budgetMs = expires - now.getTime();
      if (budgetMs <= 0) return { code: "timeout", usage: null };
      armDeadline(budgetMs);
      const saved = await deps.getExtensionSourceScan(row.sourceScanId);
      if (stopped) return null;
      if (!saved) throw new ExtensionJobError("validation-failed");
      const coreData = deps.loadCoreData();
      const context = createExtensionRequestContext(row.input, saved.scan, saved.inventory, coreData.catalog, { support: coreData.support });
      const prompt = buildExtensionPrompt(context);
      let failureCode: CompletionReasonCode | null = null;
      const remaining = () => Math.max(0, expires - deps.now().getTime());
      const requestStarted = deps.now().getTime();
      let validationAttempt: 1 | 2 = 1;
      const response = await requestWithValidationRetry(async request => {
        if (stopped || remaining() <= 0) throw new ExtensionJobError("timeout");
        try { return await deps.request(row.id, { ...request, timeoutMs: Math.min(request.timeoutMs ?? remaining(), remaining()) }); }
        catch (error) { failureCode = reason(error); throw error; }
      }, { ...prompt, schemaName: EXTENSION_MODEL_OUTPUT_SCHEMA_NAME, jsonSchema: EXTENSION_MODEL_OUTPUT_JSON_SCHEMA,
        timeoutMs: remaining() }, raw => {
        const result = processExtensionOutput(raw, context, { id: row.id, createdAt: row.createdAt });
        // Diagnostic failures cannot alter output validation, retry limits or billing.
        try { deps.onValidation?.({attempt: validationAttempt, errors: result.ok ? [] : [...result.errors]}); } catch {}
        validationAttempt = 2;
        return result;
      },
      { now: () => deps.now().getTime(), budgetMs: expires - requestStarted, minRetryMs: 90_000 });
      usage = response.usage ?? null;
      return response.kind === "ok" ? { value: response.value, coreData, usage }
        : { code: failureCode ?? (response.kind === "llm-error" ? "invalid-response" : "validation-failed"), usage };
    } catch (error) { return { code: reason(error), usage }; }
  })().then(async outcome => {
    if (!outcome) return;
    if (timedOut) { await fail("timeout", outcome.usage); return; }
    try {
      if ("value" in outcome) await deps.completeExtension(id, outcome.value, outcome.usage, outcome.coreData);
      else await deps.failExtension(id, outcome.code, outcome.usage);
    } catch (error) { await fail(reason(error), outcome.usage); }
  }).catch(() => undefined);
  try { await Promise.race([work, deadline]); }
  finally { stopped = true; clearTimeout(timer); }
}
