// @vitest-environment node
import { expect, it, vi } from "vitest";
import { settleExtension } from "./read";
import { processedFixture } from "@/lib/extend/proposal.test-data";
import type { ExtensionRecord } from "@/services/db/extensions";

function setup(age = 330_000) {
  const { result } = processedFixture();
  const row: ExtensionRecord = { id: result.id, workspaceId: result.workspaceId, sourceScanId: result.sourceScanId,
    sourceExtensionId: null, input: result.input, sourceScan: result.sourceScan, status: "pending",
    result: null, error: null, usage: null, createdAt: result.createdAt, completedAt: null };
  const deps = { now: () => new Date(Date.parse(row.createdAt) + age),
    getExtension: vi.fn(async (): Promise<ExtensionRecord | null> => row), failExtension: vi.fn(async () => true) };
  return { row, deps, result };
}
it("keeps the exact stale equality boundary pending", async () => {
  const { row, deps } = setup();
  expect(await settleExtension(row, deps)).toBe(row);
  expect(deps.failExtension).not.toHaveBeenCalled();
  expect(deps.getExtension).not.toHaveBeenCalled();
});
it("fails stale pending then rereads concurrent success instead of synthesizing failure", async () => {
  const { row, deps, result } = setup(330_001);
  const succeeded = { ...row, status: "succeeded" as const, result, completedAt: deps.now().toISOString() };
  deps.failExtension.mockResolvedValue(false);
  deps.getExtension.mockResolvedValue(succeeded);
  expect(await settleExtension(row, deps)).toBe(succeeded);
  expect(deps.failExtension).toHaveBeenCalledWith(row.id, "interrupted");
  expect(deps.getExtension).toHaveBeenCalledWith(row.id);
});
it("propagates store errors and a removed reread, and leaves terminal rows intact", async () => {
  const { row, deps } = setup(330_001);
  deps.getExtension.mockResolvedValue(null);
  expect(await settleExtension(row, deps)).toBeNull();
  deps.failExtension.mockRejectedValue(Error("store failure"));
  await expect(settleExtension(row, deps)).rejects.toThrow();
  deps.failExtension.mockClear();
  expect(await settleExtension({ ...row, status: "failed" }, deps)).toMatchObject({ status: "failed" });
  expect(deps.failExtension).not.toHaveBeenCalled();
});
