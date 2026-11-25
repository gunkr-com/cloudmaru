import "server-only";
import type { PGlite } from "@electric-sql/pglite";
import { buildExtensionDisplay } from "@/lib/extend-app/result";
import { createExtensionsDb, readExtensionOperatorCore } from "./db/extensions";
import { getDb } from "./db/client";

export function createExtensionResultServices(deps: { db: () => Promise<PGlite>; readOperatorPrices?: typeof readExtensionOperatorCore }) {
  const store = createExtensionsDb(deps);
  return {
    async getDisplay(id: string) {
      try {
        const record = await store.getExtension(id, { requireSavedEvidence: deps.readOperatorPrices === undefined });
        if (!record || record.status !== "succeeded") return null;
        const core = await store.getExtensionCoreData(id);
        if (!record?.result || !core) throw Error();
        const saved = await store.getExtensionSourceScan(record.sourceScanId);
        if (!saved || saved.scan.workspaceId !== record.workspaceId) throw Error();
        return buildExtensionDisplay(record.result, core, saved.inventory);
      } catch {
        throw Error("display-unavailable");
      }
    },
  };
}
export const extensionResults = createExtensionResultServices({ db: getDb, readOperatorPrices: readExtensionOperatorCore });
