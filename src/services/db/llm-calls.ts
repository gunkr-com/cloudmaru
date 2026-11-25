import "server-only";
import type { PGlite, Transaction } from "@electric-sql/pglite";
import type { LlmCallSource, LlmUsage } from "@/types/llm";
import { getDb } from "./client";
import { logStoreError } from "./store-log";
import { WorkspaceStoreError } from "./workspaces";

export async function recordLlmCall(db: PGlite | Transaction, args: { source: LlmCallSource; sourceId: string; usage: LlmUsage | null }): Promise<void> {
  if (args.usage === null) return;
  const { promptTokens, completionTokens, costUsd } = args.usage;
  try {
    await db.query("insert into llm_calls(source, source_id, prompt_tokens, completion_tokens, cost_usd) values ($1,$2,$3,$4,$5)", [args.source, args.sourceId, promptTokens, completionTokens, costUsd]);
  } catch (error) { logStoreError("llm-calls", error); throw new WorkspaceStoreError(); }
}

export function createLlmCallsDb(deps: { db: () => Promise<PGlite> }) {
  return {
    async listLlmUsageSince(since: Date): Promise<LlmUsage[]> {
      try {
        const rows = (await (await deps.db()).query<{ prompt_tokens: number; completion_tokens: number; cost_usd: number | null }>(
          "select prompt_tokens, completion_tokens, cost_usd from llm_calls where created_at >= $1 order by created_at, id", [since],
        )).rows;
        return rows.map(row => ({ promptTokens: row.prompt_tokens, completionTokens: row.completion_tokens, costUsd: row.cost_usd }));
      } catch (error) { logStoreError("llm-calls", error); throw new WorkspaceStoreError(); }
    },
  };
}
export const { listLlmUsageSince } = createLlmCallsDb({ db: getDb });
