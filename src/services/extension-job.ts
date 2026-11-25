import "server-only";
import type { PGlite } from "@electric-sql/pglite";
import { ExtensionJobError, runExtensionJob, startExtension } from "@/lib/extend-app/job";
import type { StartExtensionRequest } from "@/lib/extend-app/job";
import { settleExtension } from "@/lib/extend-app/read";
import { acquireOperatorPrices } from "./operator-prices";
import type { ExtensionCoreData } from "@/lib/extend/process";
import { readLlmErrorUsage } from "@/lib/llm/usage";
import { ClaudeError } from "./claude";
import { hasWorkspaceClaudeKey, requestCompletionStructuredOutput } from "./workspace-claude";
import { getDb } from "./db/client";
import { createExtensionsDb, readExtensionOperatorCore } from "./db/extensions";
import { logExtensionValidation } from "./extension-validation-log";

export function createExtensionJobServices(deps: { db: () => Promise<PGlite>; now?: () => Date }) {
  const store = createExtensionsDb({ db: deps.db, readOperatorPrices: readExtensionOperatorCore });
  const readDeps = { ...store, now: deps.now ?? (() => new Date()) };
  const runJob = (id: string, coreData: ExtensionCoreData) => runExtensionJob(id, {
    ...store, now: deps.now ?? (() => new Date()),
    onValidation: event => logExtensionValidation(id, event),
    loadCoreData: () => coreData,
    async request(sourceId, request) {
      try { return await requestCompletionStructuredOutput({ source: "extension", sourceId }, request); }
      catch (error) {
        // SDK/설정/DB 원문은 반환하지 않는다. usage는 기존 숫자 검증만 사용한다.
        const code = !(error instanceof ClaudeError) ? "internal" : error.kind === "config" ? "not-configured"
          : error.kind === "timeout" ? "timeout" : error.kind === "invalid-response" ? "invalid-response"
          : error.status === 429 ? "throttled" : error.status === 401 ? "auth-failed"
          : error.status === 403 ? "forbidden" : "internal";
        throw new ExtensionJobError(code, readLlmErrorUsage(error));
      }
    },
  });
  return {
    runJob,
    async get(id: string) {
      const record = await store.getExtension(id);
      return record ? settleExtension(record, readDeps) : null;
    },
    async list(workspaceId: string, options?: Parameters<typeof store.listExtensions>[1]) {
      const records = await store.listExtensions(workspaceId, options);
      const settled = await Promise.all(records.map(record => settleExtension(record, readDeps)));
      return settled.filter(record => record !== null);
    },
    start(request: StartExtensionRequest, schedule: (task: () => Promise<void>) => void) {
      return startExtension(request, { ...store, acquireOperatorPrices, hasWorkspaceClaudeKey, schedule, runJob });
    },
  };
}

// DB는 실행 시점에만 연다. API step이 Next after() 스케줄러를 전달한다.
export const extensionJobs = createExtensionJobServices({ db: getDb });
