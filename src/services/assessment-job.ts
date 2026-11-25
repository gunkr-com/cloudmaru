import "server-only";
import type { PGlite } from "@electric-sql/pglite";
import { runAssessmentJob, startAssessment } from "@/lib/assessment/app/job";
import type { AzureConnection, WorkspaceAzureSettings } from "@/types/scan";
import { getDb } from "./db/client";
import { createAssessmentsDb } from "./db/assessments";
import { getWorkspaceAzureSettings } from "./db/workspace-azure";
import { createCertificateTokenProvider } from "./azure/credential";
import { collectAssessmentInsights } from "./azure/insights";
import { AzureRequestError } from "./azure/request";

// 인증서·fetch·본문 읽기가 AbortSignal을 무시해도 호출자는 기한에 복귀한다.
// 늦게 끝난 Promise에는 race 핸들러가 남아 처리되지 않은 reject를 만들지 않는다.
async function untilAbort<T>(signal: AbortSignal, operation: () => Promise<T>): Promise<T> {
  if (signal.aborted) throw new AzureRequestError("timeout");
  let abort!: () => void;
  const deadline = new Promise<never>((_resolve, reject) => {
    abort = () => reject(new AzureRequestError("timeout"));
    signal.addEventListener("abort", abort, { once: true });
  });
  try { return await Promise.race([deadline, operation()]); }
  finally { signal.removeEventListener("abort", abort); }
}

export function createAssessmentJobServices(deps: {
  db: () => Promise<PGlite>;
  getWorkspaceAzureSettings: (workspaceId: string) => Promise<WorkspaceAzureSettings | null>;
  createTokenProvider?: (connection: AzureConnection) => () => Promise<string>;
  fetch?: typeof globalThis.fetch;
  now?: () => Date;
}) {
  const store = createAssessmentsDb({ db: deps.db });
  const loadSnapshot = store.loadSnapshot;
  async function runJob(id: string) {
    await runAssessmentJob(id, {
      ...store, loadSnapshot, getWorkspaceAzureSettings: deps.getWorkspaceAzureSettings,
      now: deps.now ?? (() => new Date()), collectInsights: collectAssessmentInsights,
      prepareTransport(connection, signal) {
        const token = (deps.createTokenProvider ?? createCertificateTokenProvider)(connection);
        return {
          getToken: () => untilAbort(signal, token),
          fetch: async (url, init) => {
            const response = await untilAbort(signal, () => (deps.fetch ?? globalThis.fetch)(url, {
              ...init, signal: init?.signal ? AbortSignal.any([signal, init.signal]) : signal,
            }));
            // azureRequest만 이 응답을 읽는다. 본문 대기도 전체 기한에 포함한다.
            return new Proxy(response, { get(target, key) {
              if (key === "json") return () => untilAbort(signal, () => target.json());
              const value = Reflect.get(target, key, target);
              return typeof value === "function" ? value.bind(target) : value;
            } });
          },
        };
      },
    });
  }
  return {
    runJob,
    start(request: { workspaceId: string; body: unknown }, schedule: (task: () => Promise<void>) => void) {
      return startAssessment(request, { ...store, loadSnapshot, schedule, runJob });
    },
  };
}

// DB는 작업 실행 때까지 열지 않는다. Next after() 연결은 API가 맡는다.
export const assessmentJobs = createAssessmentJobServices({ db: getDb, getWorkspaceAzureSettings });
