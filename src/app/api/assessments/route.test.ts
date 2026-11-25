// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { ids } from "@/lib/completion/fixtures.test-data";
import { ASSESSMENT_TIMEOUT_MS } from "@/lib/assessment/app/job";
const m = vi.hoisted(() => ({ workspace: vi.fn(), start: vi.fn(), after: vi.fn() }));
vi.mock("@/services/current-workspace", () => ({ getCurrentWorkspace: m.workspace }));
vi.mock("@/services/assessment-job", () => ({ assessmentJobs: { start: m.start } }));
vi.mock("next/server", () => ({ after: m.after }));
import { POST, maxDuration } from "./route";
const input = { workspaceId: ids.workspace, sourceScanId: ids.scan, previousScanId: null };
const post = (body: unknown = input) => POST(new Request("http://localhost/api/assessments", { method: "POST", body: JSON.stringify(body) }));
beforeEach(() => {
  vi.resetAllMocks();
  m.workspace.mockResolvedValue({ id: ids.workspace });
  m.start.mockResolvedValue({ status: 202, id: ids.assessment });
});
it("connects only the actual job scheduler and uses the job duration", async () => {
  const response = await post();
  expect(response.status).toBe(202);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toEqual({ id: ids.assessment });
  expect(m.start).toHaveBeenCalledWith({ workspaceId: ids.workspace, body: { schemaVersion: 1, ...input } }, expect.any(Function));
  const task = vi.fn();
  m.start.mock.calls[0][1](task);
  expect(m.after).toHaveBeenCalledExactlyOnceWith(task);
  expect(task).not.toHaveBeenCalled();
  expect(maxDuration * 1000).toBe(ASSESSMENT_TIMEOUT_MS);
});
it.each([null, [], {}, { ...input, sourceScanId: "bad" }, { ...input, workspaceId: "bad" },
  { ...input, previousScanId: "bad" }, { ...input, previousScanId: undefined },
  ...["schemaVersion", "resourceId", "ruleId", "result", "url", "options"].map(key => ({ ...input, [key]: "untrusted" })),
])("rejects non-contract input %j before any services", async body => {
  const response = await post(body);
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ code: "invalid-body" });
  expect(m.workspace).not.toHaveBeenCalled(); expect(m.start).not.toHaveBeenCalled();
});
it("rejects malformed JSON and header/stream byte overflow", async () => {
  for (const [body, headers, status] of [
    ["{", {}, 400], ["{}", { "Content-Length": "4097" }, 413], [" ".repeat(4097), {}, 413],
    ['"' + "한".repeat(1400) + '"', { "Content-Length": "1" }, 413],
  ] as const) {
    const response = await POST(new Request("http://localhost", { method: "POST", body, headers }));
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ code: "invalid-body" });
  }
  expect(m.workspace).not.toHaveBeenCalled(); expect(m.start).not.toHaveBeenCalled();
});
it.each(["workspace", "start"] as const)("sanitizes %s failures", async key => {
  m[key].mockRejectedValue(Error("PRIVATE token /private/certificate.pem"));
  const response = await post();
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ code: "internal" });
});
it("returns the job's coded rejection unchanged", async () => {
  m.start.mockResolvedValue({ status: 409, code: "workspace-changed" });
  const response = await post();
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ code: "workspace-changed" });
  expect(m.after).not.toHaveBeenCalled();
});
