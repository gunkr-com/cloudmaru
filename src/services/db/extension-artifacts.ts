import "server-only";
import { z } from "zod";
import type { PGlite, Transaction } from "@electric-sql/pglite";
import { extensionArtifactRequestSchema, reasonCodeSchema } from "@/lib/completion/schema";
import { sealAttemptEvidence, verifyAttemptEvidence } from "@/lib/completion/attempt-evidence";
import { ExtensionArtifactStorageError, validateArtifactMembers } from "@/lib/extend-artifacts/storage-validation";
import type { ArtifactBinding, ArtifactStorageContext } from "@/lib/extend-artifacts/storage-validation";
import type { AttemptValidationEvidence } from "@/types/completion-evidence";
import type { CompletionReasonCode } from "@/types/completion";
import type { ExtensionArtifact, ExtensionArtifactRequest } from "@/types/extension";
import type { LlmUsage } from "@/types/llm";
import { createExtensionsDb } from "./extensions";
import { getDb } from "./client";
import { recordLlmCall } from "./llm-calls";
import { logStoreError } from "./store-log";
import { validateExtensionArtifact, isCompilerEnvironmentError } from "../extension-artifact-compiler";

export { ExtensionArtifactStorageError } from "@/lib/extend-artifacts/storage-validation";
/** Trusted server integration point. Explicit factory injection without a validator remains closed.
 * Returns policy metadata only AFTER full semantic checks and, for Bicep, actual local compilation.
 */
export type ArtifactSemanticValidator = (artifact: ExtensionArtifact, context: ArtifactStorageContext) => Promise<AttemptValidationEvidence>;
const uuid = z.uuid();
const usageSchema = z.strictObject({ promptTokens: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  completionTokens: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), costUsd: z.number().finite().nonnegative().nullable() });
const timestamp = z.union([z.iso.datetime({ offset: true }), z.date()]).transform(value => new Date(value).toISOString());
const rowSchema = z.strictObject({ id: uuid, attempt_id: uuid, extension_id: uuid, workspace_id: uuid, source_scan_id: uuid,
  tier: z.enum(["low", "balanced", "ha"]), kind: z.enum(["guide", "evaluation", "bicep"]),
  status: z.enum(["pending", "succeeded", "failed"]), input: extensionArtifactRequestSchema, content: z.unknown(),
  error: z.strictObject({ schemaVersion: z.literal(1), code: reasonCodeSchema }).nullable(), usage: usageSchema.nullable(),
  created_at: timestamp, completed_at: timestamp.nullable() });
const reservationSchema = z.strictObject({ id: uuid, attempt_id: uuid, status: z.enum(["pending", "succeeded"]), created: z.boolean() });
function validate<T>(schema: z.ZodType<T>, raw: unknown): T {
  const value = schema.safeParse(raw);
  if (!value.success) throw new ExtensionArtifactStorageError();
  return value.data;
}
const sameUsage = (a: LlmUsage, b: LlmUsage) => a.promptTokens === b.promptTokens && a.completionTokens === b.completionTokens && a.costUsd === b.costUsd;
type Row = z.infer<typeof rowSchema>;
type Connection = PGlite | Transaction;
function binding(row: Row): ArtifactBinding {
  return { id: row.id, extensionId: row.extension_id, workspaceId: row.workspace_id, sourceScanId: row.source_scan_id,
    tier: row.tier, kind: row.kind, createdAt: row.created_at };
}
const proofBinding = (row: Row) => ({ source: "extension-artifact" as const, rowId: row.id, attemptId: row.attempt_id, kind: row.kind });
const immutableBasis = (context: ArtifactStorageContext) => ({ extension: context.extension, catalogData: context.catalogData });

export function createExtensionArtifactsDb(deps: { db: () => Promise<PGlite>; validateArtifact?: ArtifactSemanticValidator }) {
  async function run<T>(operation: (db: PGlite) => Promise<T>): Promise<T> {
    try { return await operation(await deps.db()); }
    catch (error) {
      if (error instanceof ExtensionArtifactStorageError) throw error;
      logStoreError("extension-artifacts", new Error("operation failed"));
      throw new ExtensionArtifactStorageError("internal");
    }
  }
  async function context(db: Connection, extensionId: string): Promise<ArtifactStorageContext | null> {
    // Legacy phase17 rows deliberately rerun current engines. Artifacts require pinned evidence
    // so reopening can never fall through to current pricing/check generation.
    const headers = (await db.query<{ status: string; pinned: boolean }>(
      "select status,saved_evidence is not null as pinned from extensions where id=$1", [extensionId])).rows;
    if (!headers.length || headers[0].status !== "succeeded") return null;
    if (!headers[0].pinned) throw new ExtensionArtifactStorageError();
    // Only read methods: Transaction has their query API, and no nested transaction is started.
    const parents = createExtensionsDb({ db: async () => db as PGlite });
    try {
      const parent = await parents.getExtension(extensionId);
      if (!parent || parent.status !== "succeeded" || !parent.result) return null;
      const catalogData = await parents.getExtensionCoreData(parent.id);
      const saved = await parents.getExtensionSourceScan(parent.sourceScanId);
      if (!catalogData || !saved) throw new ExtensionArtifactStorageError();
      return { extension: parent.result, catalogData, inventory: saved.inventory };
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "internal") throw new ExtensionArtifactStorageError("internal");
      throw new ExtensionArtifactStorageError();
    }
  }
  async function parse(db: Connection, raw: unknown) {
    const row = validate(rowSchema, raw);
    if (row.input.extensionId !== row.extension_id || row.input.tier !== row.tier || row.input.kind !== row.kind
      || row.completed_at !== null && Date.parse(row.completed_at) < Date.parse(row.created_at)
      || (row.status === "pending" ? row.content !== null || row.error !== null || row.completed_at !== null
        : row.completed_at === null || (row.status === "succeeded" ? row.error !== null : row.content !== null || row.error === null))) throw new ExtensionArtifactStorageError();
    const saved = await context(db, row.extension_id);
    if (!saved || saved.extension.workspaceId !== row.workspace_id || saved.extension.sourceScanId !== row.source_scan_id) throw new ExtensionArtifactStorageError();
    const attempts = await db.query<{ usage: unknown }>("select usage from extension_artifact_attempts where artifact_id=$1 and attempt_id=$2", [row.id, row.attempt_id]);
    if (attempts.rows.length !== 1) throw new ExtensionArtifactStorageError();
    let content: ExtensionArtifact | null = null;
    if (row.status === "succeeded") {
      content = validateArtifactMembers(row.content, binding(row), saved);
      const proofs = await db.query<{ evidence: unknown }>("select evidence from extension_artifact_evidence where artifact_id=$1 and attempt_id=$2", [row.id, row.attempt_id]);
      if (proofs.rows.length !== 1) throw new ExtensionArtifactStorageError();
      try { verifyAttemptEvidence(proofs.rows[0].evidence, proofBinding(row), content, immutableBasis(saved)); }
      catch { throw new ExtensionArtifactStorageError(); }
    }
    return { row, context: saved, record: { id: row.id, attemptId: row.attempt_id, extensionId: row.extension_id,
      workspaceId: row.workspace_id, sourceScanId: row.source_scan_id, tier: row.tier, kind: row.kind,
      status: row.status, input: row.input, content, error: row.error, usage: row.usage,
      createdAt: row.created_at, completedAt: row.completed_at } };
  }
  async function read(db: Connection, id: string) {
    const { rows } = await db.query("select * from extension_artifacts where id=$1", [id]);
    return rows.length ? parse(db, rows[0]) : null;
  }
  /** One FINAL aggregate per recorded attempt, independent of terminal validation/SQL and current attempt pointer. */
  async function bill(db: PGlite, id: string, attemptId: string, usage: LlmUsage | null): Promise<boolean> {
    return db.transaction(async tx => {
      const rows = (await tx.query<{ usage: unknown }>("select usage from extension_artifacts where id=$1 for update", [id])).rows;
      if (!rows.length) return false;
      const attempts = await tx.query<{ usage: unknown }>("select usage from extension_artifact_attempts where artifact_id=$1 and attempt_id=$2 for update", [id, attemptId]);
      if (attempts.rows.length !== 1) return false;
      const previous = validate(usageSchema.nullable(), attempts.rows[0].usage);
      if (usage === null) return true;
      const calls = (await tx.query<{ prompt_tokens: number; completion_tokens: number; cost_usd: number | null }>(
        "select prompt_tokens,completion_tokens,cost_usd from llm_calls where source='extension-artifact' and source_id=$1", [attemptId])).rows;
      if (calls.length > 1 || previous !== null && !sameUsage(previous, usage)) throw new ExtensionArtifactStorageError();
      if (calls.length) {
        const call = calls[0];
        if (!previous || !sameUsage(usage, { promptTokens: call.prompt_tokens, completionTokens: call.completion_tokens, costUsd: call.cost_usd })) throw new ExtensionArtifactStorageError();
      } else if (previous !== null) throw new ExtensionArtifactStorageError();
      if (previous === null) {
        const cumulative = validate(usageSchema.nullable(), rows[0].usage);
        const total = validate(usageSchema, cumulative === null ? usage : {
          promptTokens: cumulative.promptTokens + usage.promptTokens, completionTokens: cumulative.completionTokens + usage.completionTokens,
          costUsd: cumulative.costUsd === null || usage.costUsd === null ? null : cumulative.costUsd + usage.costUsd,
        });
        await recordLlmCall(tx, { source: "extension-artifact", sourceId: attemptId, usage });
        await tx.query("update extension_artifact_attempts set usage=$3 where artifact_id=$1 and attempt_id=$2", [id, attemptId, usage]);
        await tx.query("update extension_artifacts set usage=$2 where id=$1", [id, total]);
      }
      return true;
    });
  }
  return {
    async reserveExtensionArtifact(raw: ExtensionArtifactRequest, options: { staleBefore: Date }) {
      const request = validate(extensionArtifactRequestSchema, raw);
      const staleBefore = validate(z.date(), options.staleBefore);
      return run(db => db.transaction(async tx => {
        const saved = await context(tx, request.extensionId);
        if (!saved) return null;
        if (!saved.extension.plans.some(plan => plan.tier === request.tier)) throw new ExtensionArtifactStorageError();
        // Verify a reused success before returning it; do not repair corrupt rows via reservation.
        const existing = (await tx.query("select * from extension_artifacts where extension_id=$1 and tier=$2 and kind=$3", [request.extensionId, request.tier, request.kind])).rows;
        if (existing.length) await parse(tx, existing[0]);
        const { rows } = await tx.query("select * from reserve_extension_artifact($1,$2,$3,$4)", [request.extensionId, request.tier, request.kind, staleBefore]);
        if (!rows.length) return null;
        const row = validate(reservationSchema, rows[0]);
        return { id: row.id, attemptId: row.attempt_id, status: row.status, created: row.created };
      }));
    },
    async getExtensionArtifact(id: string) {
      if (!uuid.safeParse(id).success) return null;
      return run(db => db.transaction(async tx => (await read(tx, id))?.record ?? null));
    },
    async listExtensionArtifacts(extensionId: string, options: { tier?: ExtensionArtifactRequest["tier"] } = {}) {
      if (!uuid.safeParse(extensionId).success) return [];
      const tier = validate(z.enum(["low", "balanced", "ha"]).nullable(), options.tier ?? null);
      return run(db => db.transaction(async tx => {
        const rows = (await tx.query("select * from extension_artifacts where extension_id=$1 and ($2::text is null or tier=$2) order by created_at,id", [extensionId, tier])).rows;
        const records = [];
        for (const row of rows) records.push((await parse(tx, row)).record);
        return records;
      }));
    },
    async completeExtensionArtifact(id: string, attemptId: string, raw: unknown, rawUsage: LlmUsage | null = null): Promise<boolean> {
      if (!uuid.safeParse(id).success || !uuid.safeParse(attemptId).success) return false;
      const usage = validate(usageSchema.nullable(), rawUsage);
      return run(async db => {
        if (!await bill(db, id, attemptId, usage)) return false;
        const saved = await db.transaction(tx => read(tx, id));
        if (!saved || saved.row.attempt_id !== attemptId || saved.row.status !== "pending") return false;
        const value = validateArtifactMembers(raw, binding(saved.row), saved.context);
        if (!deps.validateArtifact) throw new ExtensionArtifactStorageError();
        let proof;
        try {
          const validation = await deps.validateArtifact(structuredClone(value), structuredClone(saved.context));
          proof = sealAttemptEvidence(proofBinding(saved.row), value, immutableBasis(saved.context), validation);
        } catch (error) {
          throw new ExtensionArtifactStorageError(isCompilerEnvironmentError(error) ? "compiler-unavailable" : "validation-failed");
        }
        return db.transaction(async tx => {
          const locked = (await tx.query("select * from extension_artifacts where id=$1 for update", [id])).rows;
          if (!locked.length) return false;
          const row = validate(rowSchema, locked[0]);
          if (row.attempt_id !== attemptId || row.status !== "pending") return false;
          const current = await parse(tx, row);
          try { verifyAttemptEvidence(proof, proofBinding(row), value, immutableBasis(current.context)); }
          catch { throw new ExtensionArtifactStorageError(); }
          const updated = await tx.query("update extension_artifacts set status='succeeded',content=$3,completed_at=now() where id=$1 and attempt_id=$2 and status='pending' returning id", [id, attemptId, value]);
          if (!updated.rows.length) return false;
          await tx.query("insert into extension_artifact_evidence(artifact_id,attempt_id,evidence) values($1,$2,$3)", [id, attemptId, proof]);
          return true;
        });
      });
    },
    async failExtensionArtifact(id: string, attemptId: string, code: CompletionReasonCode, rawUsage: LlmUsage | null = null): Promise<boolean> {
      if (!uuid.safeParse(id).success || !uuid.safeParse(attemptId).success) return false;
      const error = { schemaVersion: 1, code: validate(reasonCodeSchema, code) };
      const usage = validate(usageSchema.nullable(), rawUsage);
      return run(async db => {
        if (!await bill(db, id, attemptId, usage)) return false;
        return db.transaction(async tx => {
          const saved = await read(tx, id);
          if (!saved || saved.row.attempt_id !== attemptId || saved.row.status !== "pending") return false;
          const updated = await tx.query("update extension_artifacts set status='failed',error=$3,completed_at=now() where id=$1 and attempt_id=$2 and status='pending' returning id", [id, attemptId, error]);
          return updated.rows.length === 1;
        });
      });
    },
  };
}
export type ExtensionArtifactRecord = NonNullable<Awaited<ReturnType<ReturnType<typeof createExtensionArtifactsDb>["getExtensionArtifact"]>>>;
export const { reserveExtensionArtifact, getExtensionArtifact, listExtensionArtifacts, completeExtensionArtifact, failExtensionArtifact } = createExtensionArtifactsDb({ db: getDb, validateArtifact: validateExtensionArtifact });
