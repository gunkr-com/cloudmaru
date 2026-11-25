// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDatabase, insertTestWorkspace } from "@/lib/db/test-db.test-data";
import { createScansDb } from "./db/scans";
import { createExtensionsDb } from "./db/extensions";
import * as extensionDb from "./db/extensions";
import { createExtensionResultServices } from "./extension-job-result";
import { fixture, proposalInput, proposalInventory, proposalScan, proposalCatalog, proposalSupport } from "@/lib/extend/proposal.test-data";
import { createExtensionRequestContext } from "@/lib/extend/validate-proposal";
import { processExtensionOutput } from "@/lib/extend/process";
let db: PGlite;
let id: string;
beforeEach(async () => {
  db = await createTestDatabase();
  const workspaceId = await insertTestWorkspace(db);
  const sourceScanId = await createScansDb({ db: async () => db }).createImportScan({ workspaceId, subscriptionIds: proposalScan.subscriptionIds,
    inventory: proposalInventory, summary: proposalScan.summary!, collectedAt: proposalScan.collectedAt! });
  const store = createExtensionsDb({ db: async () => db });
  const input = { ...proposalInput, workspaceId, sourceScanId };
  id = (await store.reserveExtension(input))!.id;
  const row = (await store.getExtension(id))!;
  const source = (await store.getExtensionSourceScan(sourceScanId))!;
  const context = createExtensionRequestContext(input, source.scan, source.inventory, proposalCatalog, { support: proposalSupport });
  const processed = processExtensionOutput(fixture().raw, context, { id, createdAt: row.createdAt });
  if (!processed.ok) throw Error("fixture");
  await store.completeExtension(id, processed.value);
});
afterEach(async () => { vi.restoreAllMocks(); await db.close(); });
it("delegates the pinned-evidence requirement to the DB reader", async () => {
  const store = createExtensionsDb({ db: async () => db });
  const get = vi.spyOn(store, "getExtension");
  vi.spyOn(extensionDb, "createExtensionsDb").mockReturnValue(store);
  expect(await createExtensionResultServices({ db: async () => db }).getDisplay(id)).not.toBeNull();
  expect(get).toHaveBeenCalledWith(id, { requireSavedEvidence: true });
});
it("reads sealed catalog and the exact baseline after current catalog, workspace and newer inventory change", async () => {
  const services = createExtensionResultServices({ db: async () => db });
  const first = await services.getDisplay(id);
  const catalogModule = await import("@/lib/catalog/load");
  vi.spyOn(catalogModule, "loadCatalog").mockImplementation(() => { throw Error("LATEST MUST NOT LOAD"); });
  await insertTestWorkspace(db, "Different current workspace");
  const row = (await createExtensionsDb({ db: async () => db }).getExtension(id))!;
  await createScansDb({ db: async () => db }).createImportScan({ workspaceId: row.workspaceId, subscriptionIds: proposalScan.subscriptionIds,
    inventory: { ...proposalInventory, resources: proposalInventory.resources.map(r => ({ ...r, name: "LATEST NAME" })) }, summary: proposalScan.summary!, collectedAt: proposalScan.collectedAt! });
  expect(await services.getDisplay(id)).toEqual(first);
  expect(JSON.stringify(first)).not.toContain("LATEST NAME");
  expect((await db.query("select * from llm_calls")).rows).toEqual([]);
});
it("refuses missing saved evidence instead of returning current catalog labels", async () => {
  await db.query("update extensions set saved_evidence=null where id=$1", [id]);
  await expect(createExtensionResultServices({ db: async () => db }).getDisplay(id)).rejects.toThrow("display-unavailable");
});
it("returns no success display for missing and pending rows and sanitizes DB errors", async () => {
  const service = createExtensionResultServices({ db: async () => db });
  expect(await service.getDisplay("invalid")).toBeNull();
  const row = (await createExtensionsDb({ db: async () => db }).getExtension(id))!;
  const pending = (await createExtensionsDb({ db: async () => db }).reserveExtension(row.input))!;
  expect(await service.getDisplay(pending.id)).toBeNull();
  await expect(createExtensionResultServices({ db: async () => { throw Error("SECRET"); } }).getDisplay(id)).rejects.toThrow(/^display-unavailable$/);
});
