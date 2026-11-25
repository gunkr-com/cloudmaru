import "server-only";
import { z } from "zod";
import type { PGlite } from "@electric-sql/pglite";
import { extensionInputSchema, extensionResultSchema, reasonCodeSchema } from "@/lib/completion/schema";
import { toCompletionSourceScan } from "@/lib/completion/source-scan";
import { loadExtensionSupportCatalog } from "@/lib/catalog/extension-support";
import { sealExtensionEvidence, readExtensionEvidence } from "@/lib/extend/saved-evidence";
import { loadCatalog } from "@/lib/catalog/load";
import { validateStoredExtensionResult, validateHistoricalStoredExtensionResult } from "@/lib/extend/process";
import type { ExtensionCoreData } from "@/lib/extend/process";
import { ExtensionStorageError, validateExtensionStorageMembers } from "@/lib/extend/storage-validation";
import type { ExtensionResultValidator, ExtensionValidationContext } from "@/lib/extend/storage-validation";
import type { CompletionReasonCode } from "@/types/completion";
import type { ExtensionInput, ExtensionResult } from "@/types/extension";
import type { LlmUsage } from "@/types/llm";
import { acquireOperatorPrices } from "../operator-prices";
import { getDb } from "./client";
import { createScansDb } from "./scans";
import { recordLlmCall } from "./llm-calls";
import { logStoreError } from "./store-log";

const uuid = z.uuid();
const usageSchema = z.strictObject({
  promptTokens: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  completionTokens: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  costUsd: z.number().finite().nonnegative().nullable(),
});
const timestamp = z.union([z.iso.datetime({ offset: true }), z.date()]).transform(value => new Date(value).toISOString());
const rowSchema = z.strictObject({
  id: uuid, workspace_id: uuid, source_scan_id: uuid, source_extension_id: uuid.nullable(),
  status: z.enum(["pending", "succeeded", "failed"]), input: extensionInputSchema,
  result: z.unknown(), error: z.strictObject({ schemaVersion: z.literal(1), code: reasonCodeSchema }).nullable(),
  saved_evidence: z.unknown().optional().default(null),
  usage: usageSchema.nullable(), created_at: timestamp, completed_at: timestamp.nullable(),
});
const reservationSchema = z.strictObject({ id: uuid, status: z.literal("pending"), created: z.literal(true) });
function validate<T>(schema: z.ZodType<T>, raw: unknown): T {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new ExtensionStorageError();
  return parsed.data;
}
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

type ReadCore = () => Promise<ExtensionCoreData | null>;
type Binding = { id: string; createdAt: string } & ExtensionValidationContext;

export async function readExtensionOperatorCore(): Promise<ExtensionCoreData | null> {
  const pricing = await acquireOperatorPrices();
  return pricing.ok ? pricing : null;
}

export function createExtensionsDb(deps: {
  db: () => Promise<PGlite>;
  validateResult?: ExtensionResultValidator;
  coreData?: ExtensionCoreData;
  readOperatorPrices?: ReadCore;
}) {
  async function run<T>(operation: (db: PGlite) => Promise<T>): Promise<T> {
    try { return await operation(await deps.db()); }
    catch (error) {
      if (error instanceof ExtensionStorageError) throw error;
      // DB/검증 원문에는 리소스·키·경로가 있을 수 있다.
      logStoreError("extensions", new Error("operation failed"));
      throw new ExtensionStorageError("internal");
    }
  }
  async function source(db: PGlite, id: string) {
    const scans = createScansDb({ db: async () => db });
    const scan = await scans.getScan(id);
    if (!scan || scan.status !== "succeeded") return null;
    const inventory = await scans.getScanInventory(id);
    if (!inventory) throw new ExtensionStorageError();
    try { return { scan, inventory, sourceScan: toCompletionSourceScan(scan, inventory) }; }
    catch { throw new ExtensionStorageError(); }
  }
  const currentCore = (): ExtensionCoreData => deps.coreData ?? { catalog: loadCatalog(), support: loadExtensionSupportCatalog() };
  function boundResult(raw: unknown, binding: Binding): ExtensionResult {
    const value = validate(extensionResultSchema, raw);
    if (value.id !== binding.id || value.createdAt !== binding.createdAt
      || !same(value.input, binding.input) || !same(value.sourceScan, binding.sourceScan)) throw new ExtensionStorageError();
    return value;
  }
  function checkAdditionalResultConstraints(value: ExtensionResult, binding: Binding): void {
    try { deps.validateResult?.(structuredClone(value), structuredClone(binding)); }
    catch { throw new ExtensionStorageError(); }
  }
  async function readResult(raw: unknown, binding: Binding, evidence: unknown, readOperatorPrices?: ReadCore): Promise<ExtensionResult | null> {
    const value = boundResult(raw, binding);
    if (evidence !== null) {
      const core = readExtensionEvidence(evidence, value, { scan: binding.scan, inventory: binding.inventory });
      validateExtensionStorageMembers(value, binding.inventory, core.catalog);
    } else {
      const core = readOperatorPrices ? await readOperatorPrices() : currentCore();
      validateExtensionStorageMembers(value, binding.inventory, core?.catalog ?? loadCatalog());
      if (!core || !validateHistoricalStoredExtensionResult(value, binding, core, { allowVersionMismatch: !!readOperatorPrices })) return null;
    }
    checkAdditionalResultConstraints(value, binding);
    return value;
  }
  async function parse(db: PGlite, raw: unknown, readOperatorPrices = deps.readOperatorPrices) {
    const row = validate(rowSchema, raw);
    const saved = await source(db, row.source_scan_id);
    if (!saved || saved.scan.workspaceId !== row.workspace_id || row.input.workspaceId !== row.workspace_id
      || row.input.sourceScanId !== row.source_scan_id) throw new ExtensionStorageError();
    if (row.source_extension_id !== null) {
      const parent = await db.query<{ workspace_id: string }>("select workspace_id from extensions where id=$1", [row.source_extension_id]);
      if (row.source_extension_id === row.id || parent.rows[0]?.workspace_id !== row.workspace_id) throw new ExtensionStorageError();
    }
    if (row.completed_at !== null && Date.parse(row.completed_at) < Date.parse(row.created_at)) throw new ExtensionStorageError();
    if (row.status === "pending" ? row.result !== null || row.error !== null || row.completed_at !== null
      : row.completed_at === null || (row.status === "succeeded" ? row.error !== null : row.result !== null || row.error === null)) throw new ExtensionStorageError();
    if (row.status !== "succeeded" && row.saved_evidence !== null) throw new ExtensionStorageError();
    const binding = { id: row.id, createdAt: row.created_at, input: row.input, scan: saved.scan, inventory: saved.inventory, sourceScan: saved.sourceScan };
    return {
      id: row.id, workspaceId: row.workspace_id, sourceScanId: row.source_scan_id, sourceExtensionId: row.source_extension_id,
      status: row.status, input: row.input, sourceScan: saved.sourceScan,
      result: row.status === "succeeded" ? await readResult(row.result, binding, row.saved_evidence, readOperatorPrices) : null,
      error: row.error, usage: row.usage, createdAt: row.created_at, completedAt: row.completed_at,
    };
  }
  // extensions는 요청마다 새 UUID다. 이 ID 하나가 검증 재시도까지 합산한 청구 시도 하나다.
  // 결과 검증/terminal UPDATE와 별도 커밋하여 실패·중단·늦은 응답의 실제 청구도 보존한다.
  async function billing(db: PGlite, id: string, usage: LlmUsage | null): Promise<boolean> {
    return db.transaction(async tx => {
      const { rows } = await tx.query<{ usage: unknown }>("select usage from extensions where id=$1 for update", [id]);
      if (!rows.length) return false;
      const previous = validate(usageSchema.nullable(), rows[0].usage);
      if (usage === null) return true;
      const calls = await tx.query<{ prompt_tokens: number; completion_tokens: number; cost_usd: number | null }>(
        "select prompt_tokens,completion_tokens,cost_usd from llm_calls where source='extension' and source_id=$1", [id]);
      if (previous !== null && !same(previous, usage) || calls.rows.length > 1) throw new ExtensionStorageError();
      if (calls.rows.length) {
        const call = calls.rows[0];
        if (!same({ promptTokens: call.prompt_tokens, completionTokens: call.completion_tokens, costUsd: call.cost_usd }, usage)) throw new ExtensionStorageError();
      } else await recordLlmCall(tx, { source: "extension", sourceId: id, usage });
      if (previous === null) await tx.query("update extensions set usage=$2 where id=$1", [id, usage]);
      return true;
    });
  }
  async function savedRow(db: PGlite, id: string, requireSavedEvidence = false) {
    const { rows } = await db.query("select * from extensions where id=$1", [id]);
    if (requireSavedEvidence && rows.length) {
      const row = validate(rowSchema, rows[0]);
      // 화면은 저장 당시 증거가 필수다. 기존 API의 구형 결과 재생 정책은 유지한다.
      if (row.status === "succeeded" && row.saved_evidence === null) throw new ExtensionStorageError();
    }
    return rows.length ? parse(db, rows[0]) : null;
  }
  return {
    async getExtensionSourceScan(id: string) {
      if (!uuid.safeParse(id).success) return null;
      return run(db => source(db, id));
    },
    async getExtensionCoreData(id: string): Promise<ExtensionCoreData | null> {
      if (!uuid.safeParse(id).success) return null;
      return run(async db => {
        const { rows } = await db.query("select * from extensions where id=$1", [id]);
        if (!rows.length) return null;
        let operatorCore: Promise<ExtensionCoreData | null> | undefined;
        const readOperator = deps.readOperatorPrices;
        const readOnce = readOperator ? () => operatorCore ??= readOperator() : undefined;
        const record = await parse(db, rows[0], readOnce);
        if (record.status !== "succeeded" || !record.result) return null;
        const raw = validate(rowSchema, rows[0]);
        if (raw.saved_evidence === null) return readOnce ? readOnce() : currentCore();
        const saved = await source(db, record.sourceScanId);
        if (!saved) throw new ExtensionStorageError();
        return readExtensionEvidence(raw.saved_evidence, record.result, {scan: saved.scan, inventory: saved.inventory});
      });
    },
    async reserveExtension(raw: ExtensionInput, options: { sourceExtensionId?: string | null } = {}) {
      const input = validate(extensionInputSchema, raw);
      const sourceExtensionId = validate(uuid.nullable(), options.sourceExtensionId ?? null);
      return run(async db => {
        const saved = await source(db, input.sourceScanId);
        if (!saved || saved.scan.workspaceId !== input.workspaceId) return null;
        const { rows } = await db.query("select * from reserve_extension($1,$2,$3,$4)",
          [input.workspaceId, input.sourceScanId, input, sourceExtensionId]);
        return rows.length ? validate(reservationSchema, rows[0]) : null;
      });
    },
    async completeExtension(id: string, raw: unknown, rawUsage: LlmUsage | null = null, coreData?: ExtensionCoreData): Promise<boolean> {
      if (!uuid.safeParse(id).success) return false;
      const usage = validate(usageSchema.nullable(), rawUsage);
      return run(async db => {
        if (!await billing(db, id, usage)) return false;
        const row = await savedRow(db, id);
        if (!row || row.status !== "pending") return false;
        const saved = await source(db, row.sourceScanId);
        if (!saved) throw new ExtensionStorageError();
        const data = coreData ?? currentCore();
        const binding = { id, createdAt: row.createdAt, input: row.input, scan: saved.scan, sourceScan: saved.sourceScan, inventory: saved.inventory };
        const value = boundResult(raw, binding);
        validateExtensionStorageMembers(value, binding.inventory, data.catalog);
        validateStoredExtensionResult(value, binding, data);
        checkAdditionalResultConstraints(value, binding);
        const evidence = sealExtensionEvidence(value, data, {scan: saved.scan, inventory: saved.inventory});
        const updated = await db.query("update extensions set status='succeeded',result=$2,saved_evidence=$3,completed_at=now() where id=$1 and status='pending' returning id", [id, value, evidence]);
        return updated.rows.length === 1;
      });
    },
    async failExtension(id: string, code: CompletionReasonCode, rawUsage: LlmUsage | null = null): Promise<boolean> {
      if (!uuid.safeParse(id).success) return false;
      const error = { schemaVersion: 1, code: validate(reasonCodeSchema, code) };
      const usage = validate(usageSchema.nullable(), rawUsage);
      return run(async db => {
        if (!await billing(db, id, usage)) return false;
        const row = await savedRow(db, id);
        if (!row || row.status !== "pending") return false;
        const updated = await db.query("update extensions set status='failed',error=$2,completed_at=now() where id=$1 and status='pending' returning id", [id, error]);
        return updated.rows.length === 1;
      });
    },
    async getExtension(id: string, options: { requireSavedEvidence?: boolean } = {}) {
      if (!uuid.safeParse(id).success) return null;
      return run(db => savedRow(db, id, options.requireSavedEvidence));
    },
    async listExtensions(workspaceId: string, options: { sourceScanId?: string; limit?: number; beforeId?: string } = {}) {
      if (!uuid.safeParse(workspaceId).success || options.sourceScanId !== undefined && !uuid.safeParse(options.sourceScanId).success) return [];
      const limit = validate(z.number().int().min(0).max(100), options.limit ?? 20);
      const beforeId = validate(uuid.nullable(), options.beforeId ?? null);
      return run(async db => {
        if (beforeId !== null) {
          const anchor = await db.query("select id from extensions where workspace_id=$1 and id=$2 and ($3::uuid is null or source_scan_id=$3)", [workspaceId, beforeId, options.sourceScanId ?? null]);
          if (!anchor.rows.length) throw new ExtensionStorageError();
        }
        // Use the anchor's exact Postgres timestamp, including sub-millisecond precision.
        const { rows } = await db.query(`select * from extensions where workspace_id=$1
          and ($2::uuid is null or source_scan_id=$2)
          and ($4::uuid is null or (created_at,id) < (select created_at,id from extensions where id=$4 and workspace_id=$1 and ($2::uuid is null or source_scan_id=$2)))
          order by created_at desc,id desc limit $3`, [workspaceId, options.sourceScanId ?? null, limit, beforeId]);
        let operatorCore: Promise<ExtensionCoreData | null> | undefined;
        const readOperator = deps.readOperatorPrices;
        const readOnce = readOperator ? () => operatorCore ??= readOperator() : undefined;
        return Promise.all(rows.map(row => parse(db, row, readOnce)));
      });
    },
  };
}

export type ExtensionRecord = NonNullable<Awaited<ReturnType<ReturnType<typeof createExtensionsDb>["getExtension"]>>>;
export const { getExtensionSourceScan, getExtensionCoreData, reserveExtension, completeExtension, failExtension, getExtension, listExtensions } = createExtensionsDb({ db: getDb, readOperatorPrices: readExtensionOperatorCore });
