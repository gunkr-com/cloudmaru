import { expect, it } from "vitest";
import { parseExtensionHistoryCursor, extensionHistoryCursor } from "./history-cursor";
import { ids } from "@/lib/completion/fixtures.test-data";
it("roundtrips a workspace-bound cursor and rejects malformed, repeated and foreign cursors", () => {
  const cursor = extensionHistoryCursor(ids.workspace, ids.extension);
  expect(parseExtensionHistoryCursor(cursor, ids.workspace)).toEqual({ valid: true, beforeId: ids.extension });
  expect(parseExtensionHistoryCursor(undefined, ids.workspace)).toEqual({ valid: true });
  for (const value of ["", "private", cursor + ".extra", [cursor], extensionHistoryCursor(ids.otherWorkspace, ids.extension)]) {
    expect(parseExtensionHistoryCursor(value, ids.workspace)).toEqual({ valid: false });
  }
});
