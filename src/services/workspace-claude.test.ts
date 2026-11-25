// @vitest-environment node
vi.mock("./workspace-secrets", async original => ({ ...await original<typeof import("./workspace-secrets")>(), readWorkspaceSecret: vi.fn(async () => null) }));
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ getAnalysis: vi.fn(), getCompletionOwner: vi.fn(), getWorkspaceClaudeSettings: vi.fn(), requestStructuredOutput: vi.fn() }));
vi.mock("@/services/db/analyses", () => m);
vi.mock("@/services/db/completion-ownership", () => m);
vi.mock("@/services/db/workspace-claude", () => m);
vi.mock("@/services/claude", async importOriginal => ({ ...await importOriginal<typeof import("./claude")>(), requestStructuredOutput: m.requestStructuredOutput }));
import { readWorkspaceSecret } from "./workspace-secrets";
import { hasCompletionClaudeKey, hasWorkspaceClaudeKey, requestAnalysisStructuredOutput, requestCompletionStructuredOutput } from "./workspace-claude";
import { requestWithValidationRetry } from "@/lib/llm/validation-retry";
import { ids, extensionArtifacts } from "@/lib/completion/fixtures.test-data";
const request: Parameters<typeof requestCompletionStructuredOutput>[1] = { system: "synthetic", user: "synthetic", schemaName: "test", jsonSchema: { type: "object", properties: {}, additionalProperties: false } };
beforeEach(() => { vi.resetAllMocks(); vi.mocked(readWorkspaceSecret).mockResolvedValue(null); m.getAnalysis.mockResolvedValue({ workspaceId: "source-company" }); m.getCompletionOwner.mockResolvedValue(ids.workspace); m.getWorkspaceClaudeSettings.mockResolvedValue({ apiKeyEnv: "CLOUDSIGHT_CLAUDE_KEY_COMPANY" }); m.requestStructuredOutput.mockResolvedValue({ data: {}, usage: null, model: "test" }); vi.stubEnv("CLOUDSIGHT_CLAUDE_KEY_COMPANY", "fake-company-key"); vi.stubEnv("ANTHROPIC_API_KEY", "fake-developer-key"); });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
it("checks the dedicated reference and local value without making an API request", async () => {
  vi.stubEnv("CLOUDSIGHT_CLAUDE_KEY_COMPANY", "fake-company-key");
  expect(await hasWorkspaceClaudeKey("source-company")).toBe(true);
  expect(m.getWorkspaceClaudeSettings).toHaveBeenCalledWith("source-company");
  expect(m.requestStructuredOutput).not.toHaveBeenCalled();
});
it.each([null, "ANTHROPIC_API_KEY", "CLOUDSIGHT_CLAUDE_KEY_MISSING"])("blocks unavailable reference %s even with a developer key", async apiKeyEnv => {
  vi.stubEnv("ANTHROPIC_API_KEY", "fake-developer-key");
  vi.stubEnv("CLOUDSIGHT_CLAUDE_KEY_MISSING", " ");
  m.getWorkspaceClaudeSettings.mockResolvedValue({ apiKeyEnv });
  expect(await hasWorkspaceClaudeKey("source-company")).toBe(false);
  expect(m.requestStructuredOutput).not.toHaveBeenCalled();
});
it.each(["secret-storage", "settings-db", "workspace-missing"])("fails the preflight closed as an unavailable key on %s, without a fallback", async failure => {
  if (failure === "secret-storage") vi.mocked(readWorkspaceSecret).mockRejectedValue(Error("private-secret"));
  if (failure === "settings-db") m.getWorkspaceClaudeSettings.mockRejectedValue(Error("private-secret"));
  if (failure === "workspace-missing") m.getWorkspaceClaudeSettings.mockResolvedValue(null);
  expect(await hasWorkspaceClaudeKey("source-company")).toBe(false);
  expect(m.requestStructuredOutput).not.toHaveBeenCalled();
});
it("uses the persisted analysis workspace, including reruns, and overrides injected references", async () => {
  await requestAnalysisStructuredOutput("analysis-id", { ...request, apiKeyEnv: "CLOUDSIGHT_CLAUDE_KEY_OTHER" } as typeof request);
  expect(m.getAnalysis).toHaveBeenCalledWith("analysis-id");
  expect(m.getWorkspaceClaudeSettings).toHaveBeenCalledWith("source-company");
  expect(m.requestStructuredOutput).toHaveBeenCalledWith({ ...request, apiKeyEnv: "CLOUDSIGHT_CLAUDE_KEY_COMPANY" });
});
it("passes explicit null to block an unconfigured workspace instead of selecting the global key", async () => {
  m.getWorkspaceClaudeSettings.mockResolvedValue({ apiKeyEnv: null });
  await requestAnalysisStructuredOutput("analysis-id", request);
  expect(m.requestStructuredOutput).toHaveBeenCalledWith({ ...request, apiKeyEnv: null });
});
it.each(["analysis", "settings", "storage"])('blocks when %s lookup fails', async failure => {
  if (failure === "analysis") m.getAnalysis.mockResolvedValue(null);
  if (failure === "settings") m.getWorkspaceClaudeSettings.mockResolvedValue(null);
  if (failure === "storage") m.getAnalysis.mockRejectedValue(Error("private-secret"));
  await expect(requestAnalysisStructuredOutput("analysis-id", request)).rejects.toMatchObject({ kind: "config" });
  expect(m.requestStructuredOutput).not.toHaveBeenCalled();
});

const jobs = [
  { source: "assessment-roadmap", sourceId: ids.assessment },
  { source: "extension", sourceId: ids.extension },
  { source: "extension-artifact", sourceId: extensionArtifacts[0].id },
] as const;
it.each(jobs)("uses saved $source owner, ignoring injected workspace and key references", async job => {
  const injectedJob = { ...job, workspaceId: ids.otherWorkspace };
  expect(await hasCompletionClaudeKey(injectedJob)).toBe(true);
  expect(m.requestStructuredOutput).not.toHaveBeenCalled();
  await requestCompletionStructuredOutput(injectedJob, { ...request, apiKeyEnv: "ANTHROPIC_API_KEY" } as typeof request);
  expect(m.getCompletionOwner).toHaveBeenCalledWith(job.source, job.sourceId);
  expect(m.getWorkspaceClaudeSettings).toHaveBeenCalledWith(ids.workspace);
  expect(m.getWorkspaceClaudeSettings).not.toHaveBeenCalledWith(ids.otherWorkspace);
  expect(m.requestStructuredOutput).toHaveBeenCalledExactlyOnceWith({ ...request, apiKeyEnv: "CLOUDSIGHT_CLAUDE_KEY_COMPANY" });
});

it.each(["owner-missing", "owner-db", "settings-missing", "settings-db", "null-reference", "invalid-reference", "missing-value"])(
  "sanitizes %s before calling the SDK, with no global fallback", async failure => {
    vi.stubEnv("CLOUDSIGHT_CLAUDE_KEY_MISSING", " ");
    if (failure === "owner-missing") m.getCompletionOwner.mockResolvedValue(null);
    if (failure === "owner-db") m.getCompletionOwner.mockRejectedValue(Error("private-secret-owner"));
    if (failure === "settings-missing") m.getWorkspaceClaudeSettings.mockResolvedValue(null);
    if (failure === "settings-db") m.getWorkspaceClaudeSettings.mockRejectedValue(Error("private-secret-settings"));
    if (failure === "null-reference") m.getWorkspaceClaudeSettings.mockResolvedValue({ apiKeyEnv: null });
    if (failure === "invalid-reference") m.getWorkspaceClaudeSettings.mockResolvedValue({ apiKeyEnv: "ANTHROPIC_API_KEY" });
    if (failure === "missing-value") m.getWorkspaceClaudeSettings.mockResolvedValue({ apiKeyEnv: "CLOUDSIGHT_CLAUDE_KEY_MISSING" });
    const error = await requestCompletionStructuredOutput(jobs[0], request).catch(error => error);
    expect(error).toMatchObject({ kind: "config", message: "workspace.claude.unavailable" });
    expect(error.cause).toBeUndefined();
    expect(String(error.stack)).not.toMatch(/private-secret|fake-company|fake-developer/);
    if (failure.endsWith("-db")) {
      await expect(hasCompletionClaudeKey(jobs[0])).rejects.toMatchObject({ kind: "config", message: "workspace.claude.unavailable" });
    } else expect(await hasCompletionClaudeKey(jobs[0])).toBe(false);
    expect(m.requestStructuredOutput).not.toHaveBeenCalled();
  },
);

it("keeps different saved companies on their own dedicated key", async () => {
  m.getCompletionOwner.mockImplementation(async (_source, id) => id === ids.extension ? ids.otherWorkspace : ids.workspace);
  m.getWorkspaceClaudeSettings.mockImplementation(async id => ({ apiKeyEnv: id === ids.workspace ? "CLOUDSIGHT_CLAUDE_KEY_COMPANY" : "CLOUDSIGHT_CLAUDE_KEY_OTHER" }));
  vi.stubEnv("CLOUDSIGHT_CLAUDE_KEY_OTHER", "fake-other-company-key");
  await requestCompletionStructuredOutput(jobs[0], request);
  await requestCompletionStructuredOutput(jobs[1], request);
  expect(m.requestStructuredOutput.mock.calls.map(([r]) => r.apiKeyEnv)).toEqual(["CLOUDSIGHT_CLAUDE_KEY_COMPANY", "CLOUDSIGHT_CLAUDE_KEY_OTHER"]);
});

it.each(["reference", "value", "disabled", "database"])("rereads %s during actual validation retry with a mocked HTTP boundary", async change => {
  const actualClaude = await vi.importActual<typeof import("./claude")>("./claude");
  m.requestStructuredOutput.mockImplementation(actualClaude.requestStructuredOutput);
  vi.stubEnv("CLAUDE_MODEL", "claude-opus-5-5");
  const sentKeys: (string | null)[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
    sentKeys.push(new Headers(init?.headers).get("x-api-key"));
    return Response.json({ model: "claude-opus-5-5", content: [{ type: "text", text: '{}' }],
      usage: { input_tokens: 10, output_tokens: 2 }, stop_reason: "end_turn" });
  }));
  let attempts = 0;
  const result = await requestWithValidationRetry(
    r => requestCompletionStructuredOutput(jobs[0], r), request, () => {
      if (++attempts === 1) {
        if (change === "reference") {
          m.getWorkspaceClaudeSettings.mockResolvedValue({ apiKeyEnv: "CLOUDSIGHT_CLAUDE_KEY_ROTATED" });
          vi.stubEnv("CLOUDSIGHT_CLAUDE_KEY_ROTATED", "fake-rotated-key");
        }
        if (change === "value") vi.stubEnv("CLOUDSIGHT_CLAUDE_KEY_COMPANY", "fake-rotated-key");
        if (change === "disabled") m.getWorkspaceClaudeSettings.mockResolvedValue({ apiKeyEnv: null });
        if (change === "database") m.getCompletionOwner.mockRejectedValue(Error("private-secret"));
        return { ok: false, errors: ["synthetic validation failure"] };
      }
      return { ok: true, value: "synthetic validated result" };
    },
  );
  const blocked = change === "disabled" || change === "database";
  expect(sentKeys).toEqual(blocked ? ["fake-company-key"] : ["fake-company-key", "fake-rotated-key"]);
  expect(result.kind).toBe(blocked ? "invalid" : "ok");
  expect(result).toMatchObject({ usage: { promptTokens: blocked ? 10 : 20, completionTokens: blocked ? 2 : 4 } });
  expect(m.getCompletionOwner).toHaveBeenCalledTimes(2);
  expect(JSON.stringify(result)).not.toMatch(/fake-|private-secret/);
});

 it("uses file key and model for saved owner and rereads rotation without personal fallback", async () => {
  const { readWorkspaceSecret } = await import("./workspace-secrets");
  vi.mocked(readWorkspaceSecret).mockResolvedValue({ source: "key", apiKey: "synthetic-file-one", model: "claude-sonnet-5-5" });
  await requestCompletionStructuredOutput(jobs[0], { ...request, apiKey: "injected" } as typeof request);
  expect(m.requestStructuredOutput).toHaveBeenLastCalledWith({ ...request, apiKey: "synthetic-file-one", apiKeyEnv: null, model: "claude-sonnet-5-5" });
  vi.mocked(readWorkspaceSecret).mockResolvedValue({ source: "disabled" });
  await expect(requestCompletionStructuredOutput(jobs[0], request)).rejects.toMatchObject({ kind: "config" });
  expect(m.requestStructuredOutput).toHaveBeenCalledTimes(1);
 });
it.each(["analysis", "completion"] as const)("ignores an injected %s model so the saved or global model is used", async kind => {
  const injected = { ...request, model: "claude-sonnet-5-5" } as typeof request;
  if (kind === "analysis") await requestAnalysisStructuredOutput("analysis-id", injected);
  else await requestCompletionStructuredOutput(jobs[0], injected);
  expect(m.requestStructuredOutput).toHaveBeenLastCalledWith({ ...request, apiKeyEnv: "CLOUDSIGHT_CLAUDE_KEY_COMPANY" });
  vi.mocked(readWorkspaceSecret).mockResolvedValue({ source: "env", apiKeyEnv: "CLOUDSIGHT_CLAUDE_KEY_COMPANY", model: "claude-opus-5-5" });
  if (kind === "analysis") await requestAnalysisStructuredOutput("analysis-id", injected);
  else await requestCompletionStructuredOutput(jobs[0], injected);
  expect(m.requestStructuredOutput).toHaveBeenLastCalledWith({ ...request, apiKeyEnv: "CLOUDSIGHT_CLAUDE_KEY_COMPANY", model: "claude-opus-5-5" });
});
