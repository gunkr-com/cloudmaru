import "server-only";
import { isJobStale } from "@/lib/jobs/timing";
import type { createExtensionsDb, ExtensionRecord } from "@/services/db/extensions";

type ReadDeps = Pick<ReturnType<typeof createExtensionsDb>, "getExtension" | "failExtension"> & { now: () => Date };

/** pending-only 종료 후 저장값을 다시 읽어 동시 성공과 늦은 사용량 기록을 보존한다. */
export async function settleExtension(record: ExtensionRecord, deps: ReadDeps): Promise<ExtensionRecord | null> {
  if (record.status !== "pending" || !isJobStale(record.createdAt, deps.now())) return record;
  await deps.failExtension(record.id, "interrupted");
  return deps.getExtension(record.id);
}
