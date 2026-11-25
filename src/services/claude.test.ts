// @vitest-environment node
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { ClaudeError, requestStructuredOutput } from "./claude";
import type { LlmUsage } from "@/types/llm";
import { EXTENSION_MODEL_OUTPUT_JSON_SCHEMA } from "@/lib/extend/model-output-schema";
import { roadmapFixture } from "@/lib/assessment/roadmap/fixtures.test-data";
import { buildRoadmapContext } from "@/lib/assessment/roadmap/context";
import { buildRoadmapRequest } from "@/lib/assessment/roadmap/model";

const apiKey = "test-only-secret-never-expose";
const requestedModel = "claude-opus-5-5";
const request = {
  system: "전달받은 스키마에 맞는 JSON을 작성하세요.",
  user: "로그에 남기면 안 되는 사용자 요구사항",
  schemaName: "test_output",
  jsonSchema: {
    type: "object",
    properties: { answer: { type: "string" } },
    required: ["answer"],
    additionalProperties: false,
  },
};

function message(overrides: Record<string, unknown> = {}) {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: requestedModel,
    content: [
      { type: "thinking", thinking: "", signature: "sig" },
      { type: "text", text: '{"answer":"완료"}' },
    ],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 100, output_tokens: 20, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    ...overrides,
  };
}

function mockResponse(body: unknown = message()) {
  vi.mocked(fetch).mockResolvedValueOnce(Response.json(body));
}

function sentBody() {
  return JSON.parse(String(vi.mocked(fetch).mock.lastCall![1]!.body));
}

function sentHeaders() {
  return new Headers(vi.mocked(fetch).mock.lastCall![1]!.headers);
}

async function expectError(
  promise: ReturnType<typeof requestStructuredOutput>,
  kind: ClaudeError["kind"],
  status?: number,
) {
  const error: unknown = await promise.catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(ClaudeError);
  if (!(error instanceof ClaudeError)) throw new Error("예상한 오류가 없습니다.");
  expect(error).toMatchObject({ name: "ClaudeError", kind });
  expect(error.status).toBe(status);
  expect(error.message).not.toContain(apiKey);
  expect(error.message).not.toContain(request.system);
  expect(error.message).not.toContain(request.user);
  expect(error.stack).not.toContain(apiKey);
  expect(error.cause).toBeUndefined();
  return error;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("ANTHROPIC_API_KEY", apiKey);
  vi.stubEnv("CLAUDE_MODEL", requestedModel);
  vi.stubEnv("ANTHROPIC_AUTH_TOKEN", undefined);
  vi.stubEnv("ANTHROPIC_BASE_URL", undefined);
  vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockRejectedValue(new Error("실제 네트워크 금지")));
  for (const method of ["log", "info", "warn", "error", "debug"] as const) {
    vi.spyOn(console, method).mockImplementation(() => {});
  }
});

afterEach(() => {
  expect(vi.getTimerCount()).toBe(0);
  for (const method of ["log", "info", "warn", "error", "debug"] as const) {
    expect(console[method]).not.toHaveBeenCalled();
  }
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("requestStructuredOutput", () => {
  it("uses an explicit server-only key and never falls back from an empty explicit key", async () => {
    mockResponse();
    await requestStructuredOutput({ ...request, apiKey: "synthetic-file-key", apiKeyEnv: null });
    expect(sentHeaders().get("x-api-key")).toBe("synthetic-file-key");
    await expect(requestStructuredOutput({ ...request, apiKey: "", apiKeyEnv: null })).rejects.toMatchObject({ kind: "config" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("adapts generated constraints for the provider without mutating local validation schemas", async () => {
    const schema = {
      type: "object", additionalProperties: false, required: ["phases"],
      properties: { phases: { type: "array", minItems: 1, maxItems: 4,
        items: { type: "object", additionalProperties: false, required: ["title", "count"], properties: {
          title: { type: "string", minLength: 1, maxLength: 120 },
          count: { type: "number", minimum: 1, maximum: 20 },
        } } } },
    };
    const roadmap = roadmapFixture();
    const roadmapRequest = buildRoadmapRequest(buildRoadmapContext(roadmap.parent, roadmap.catalogData));
    for (const original of [schema, EXTENSION_MODEL_OUTPUT_JSON_SCHEMA, roadmapRequest.jsonSchema]) {
      const before = JSON.stringify(original);
      mockResponse();
      await requestStructuredOutput({ ...request, jsonSchema: original });
      const wire = sentBody().output_config.format.schema;
      const inspect = (value: unknown) => {
        if (!value || typeof value !== "object") return;
        for (const [key, child] of Object.entries(value)) {
          expect(["minLength", "maxLength", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "maxItems", "$schema"]).not.toContain(key);
          inspect(child);
        }
      };
      inspect(wire);
      expect(wire.additionalProperties).toBe(false);
      expect(JSON.stringify(wire)).toContain("description");
      expect(JSON.stringify(original)).toBe(before);
    }
    expect(sentBody().messages[0].content).toBe(request.user);
  });
  it.each(["max_tokens", "refusal", "bad-json", "no-text"])("retains billable usage on %s without retaining response copy", async failure => {
    mockResponse(message({ stop_reason: failure === "max_tokens" || failure === "refusal" ? failure : "end_turn",
      content: failure === "no-text" ? [] : [{ type: "text", text: `private invalid JSON ${apiKey}` }] }));
    const error = await expectError(requestStructuredOutput(request), "invalid-response");
    expect(error).toMatchObject({ usage: { promptTokens: 100, completionTokens: 20, costUsd: 0.0008 } });
    expect(JSON.stringify(error)).not.toMatch(/private|test-only-secret/);
  });
  it("preserves unknown cost on failed fallback output and never invents missing usage", async () => {
    mockResponse(message({ content: [{ type: "text", text: "invalid" }],
      usage: { input_tokens: 11, output_tokens: 3, iterations: [{ type: "fallback_message" }] } }));
    expect(await expectError(requestStructuredOutput(request), "invalid-response"))
      .toMatchObject({ usage: { promptTokens: 11, completionTokens: 3, costUsd: null } });
    mockResponse(message({ content: [], usage: null }));
    expect((await expectError(requestStructuredOutput(request), "invalid-response")).usage).toBeNull();
  });
  it("uses only the explicitly selected workspace key and rereads it on each call", async () => {
    for (const value of ["fake-company-key-one", "fake-company-key-two"]) {
      vi.stubEnv("CLOUDSIGHT_CLAUDE_KEY_ACME", value);
      mockResponse();
      const result = await requestStructuredOutput({ ...request, apiKeyEnv: "CLOUDSIGHT_CLAUDE_KEY_ACME" });
      expect(sentHeaders().get("x-api-key")).toBe(value);
      expect(JSON.stringify(result)).not.toContain(value);
      expect(String(vi.mocked(fetch).mock.lastCall![1]!.body)).not.toContain(value);
    }
  });

  it.each([undefined, "", "   "])("never falls back when the selected key is %s", async value => {
    vi.stubEnv("CLOUDSIGHT_CLAUDE_KEY_ACME", value);
    await expectError(requestStructuredOutput({ ...request, apiKeyEnv: "CLOUDSIGHT_CLAUDE_KEY_ACME" }), "config");
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([undefined, null, "", "ANTHROPIC_API_KEY", "HOME", "fake-secret-value"])("blocks unconfigured or invalid workspace references %s", async apiKeyEnv => {
    const error = await expectError(requestStructuredOutput({ ...request, apiKeyEnv }), "config");
    expect(error.message).toBe("workspace.claude.unavailable");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("API 키·시스템·사용자 메시지·JSON 스키마·모델을 보내고 JSON과 사용량을 반환한다", async () => {
    mockResponse(message({ debug: { authorization: apiKey } }));

    const result = await requestStructuredOutput({ ...request, maxTokens: 4096 });

    expect(fetch).toHaveBeenCalledOnce();
    const [url, options] = vi.mocked(fetch).mock.calls[0];
    expect(String(url)).toBe("https://api.anthropic.com/v1/messages?beta=true");
    expect(options).toMatchObject({ method: "POST", signal: expect.any(AbortSignal) });
    const headers = sentHeaders();
    expect(headers.get("x-api-key")).toBe(apiKey);
    expect(headers.get("authorization")).toBeNull();
    expect(headers.get("anthropic-beta")).toBe("server-side-fallback-2026-07-01");
    expect(headers.get("anthropic-version")).toBeTruthy();
    expect(sentBody()).toEqual({
      model: requestedModel,
      max_tokens: 4096,
      system: request.system,
      messages: [{ role: "user", content: request.user }],
      output_config: { effort: "medium", format: { type: "json_schema", schema: request.jsonSchema } },
      fallbacks: "default",
    });
    expect(String(options!.body)).not.toContain(apiKey);
    expect(result).toEqual({
      data: { answer: "완료" },
      usage: { promptTokens: 100, completionTokens: 20, costUsd: 0.0008 },
      model: requestedModel,
    });
    expect(JSON.stringify(result)).not.toContain(apiKey);
    expectTypeOf(result).toEqualTypeOf<{ data: unknown; usage: LlmUsage | null; model: string }>();
  });

  it("토큰 한도를 생략하면 기본 16000을 보낸다", async () => {
    mockResponse();
    await requestStructuredOutput(request);
    expect(sentBody().max_tokens).toBe(16000);
  });

  it("요청에 모델·effort를 주면 CLAUDE_MODEL·기본 effort 대신 그 값을 보낸다", async () => {
    mockResponse(message({ model: "claude-sonnet-5-5" }));
    const result = await requestStructuredOutput({ ...request, model: "claude-sonnet-5-5", effort: "low" });
    expect(sentBody()).toMatchObject({ model: "claude-sonnet-5-5", output_config: { effort: "low" } });
    expect(result.model).toBe("claude-sonnet-5-5");
  });

  it("요청에 모델을 주면 CLAUDE_MODEL이 없어도 호출한다", async () => {
    vi.stubEnv("CLAUDE_MODEL", undefined);
    mockResponse();
    await requestStructuredOutput({ ...request, model: requestedModel });
    expect(sentBody().model).toBe(requestedModel);
  });

  it("요청에 모델을 줘도 API 키가 없으면 키 이름만 오류에 넣고 요청하지 않는다", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", undefined);
    const error = await expectError(requestStructuredOutput({ ...request, model: requestedModel }), "config");
    expect(error.message).toBe("ANTHROPIC_API_KEY");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("요청 모델이 공백이면 CLAUDE_MODEL로 대신하지 않고 요청하지 않는다", async () => {
    const error = await expectError(requestStructuredOutput({ ...request, model: "  " }), "config");
    expect(error.message).toBe("model");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("셸의 ANTHROPIC_AUTH_TOKEN·ANTHROPIC_BASE_URL을 쓰지 않는다", async () => {
    vi.stubEnv("ANTHROPIC_AUTH_TOKEN", "other-token");
    vi.stubEnv("ANTHROPIC_BASE_URL", "https://proxy.example.com");
    mockResponse();
    await requestStructuredOutput(request);
    expect(String(vi.mocked(fetch).mock.lastCall![0])).toBe("https://api.anthropic.com/v1/messages?beta=true");
    expect(sentHeaders().get("authorization")).toBeNull();
    expect(sentHeaders().get("x-api-key")).toBe(apiKey);
  });

  it("환경 변수 없이 모듈을 불러오고 매 호출 시 최신 환경 변수를 읽는다", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", undefined);
    vi.stubEnv("CLAUDE_MODEL", undefined);
    const service = await import("./claude");
    expect(fetch).not.toHaveBeenCalled();

    for (const suffix of ["first", "second"]) {
      vi.stubEnv("ANTHROPIC_API_KEY", `${apiKey}-${suffix}`);
      vi.stubEnv("CLAUDE_MODEL", `test-${suffix}`);
      mockResponse();
      await service.requestStructuredOutput(request);
      expect(sentHeaders().get("x-api-key")).toBe(`${apiKey}-${suffix}`);
      expect(sentBody().model).toBe(`test-${suffix}`);
    }
  });

  it.each([
    ["ANTHROPIC_API_KEY", undefined],
    ["ANTHROPIC_API_KEY", ""],
    ["ANTHROPIC_API_KEY", "   "],
    ["CLAUDE_MODEL", undefined],
    ["CLAUDE_MODEL", ""],
    ["CLAUDE_MODEL", "   "],
  ] as const)("%s가 %s이면 누락된 변수 이름만 반환하고 요청하지 않는다", async (name, value) => {
    vi.stubEnv(name, value);
    const error = await expectError(requestStructuredOutput(request), "config");
    expect(error.message).toBe(name);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("두 환경 변수가 없으면 빠진 이름 둘만 오류에 넣는다", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", undefined);
    vi.stubEnv("CLAUDE_MODEL", undefined);
    const error = await expectError(requestStructuredOutput(request), "config");
    expect(error.message).toBe("ANTHROPIC_API_KEY, CLAUDE_MODEL");
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([undefined, null])("usage가 %s이면 null을 반환한다", async (usage) => {
    mockResponse(message({ usage }));
    expect((await requestStructuredOutput(request)).usage).toBeNull();
  });

  it.each([{}, "usage", { input_tokens: 10 }, { input_tokens: "10", output_tokens: 2 },
    { input_tokens: -1, output_tokens: 2 }, { input_tokens: 10, output_tokens: 0.5 },
    { input_tokens: 10, output_tokens: 2, cache_read_input_tokens: -1 }])(
    "토큰 사용량이 잘못되면 숫자를 만들지 않고 null을 반환한다: %j", async (usage) => {
      mockResponse(message({ usage }));
      expect((await requestStructuredOutput(request)).usage).toBeNull();
    },
  );

  it("캐시 토큰은 입력 토큰에 합산하고 비용은 확정하지 않는다", async () => {
    mockResponse(message({ usage: { input_tokens: 10, output_tokens: 2, cache_creation_input_tokens: 5, cache_read_input_tokens: 7 } }));
    expect((await requestStructuredOutput(request)).usage).toEqual({ promptTokens: 22, completionTokens: 2, costUsd: null });
  });

  it("0 토큰과 0 비용을 누락으로 취급하지 않는다", async () => {
    mockResponse(message({ usage: { input_tokens: 0, output_tokens: 0 } }));
    expect((await requestStructuredOutput(request)).usage).toEqual({ promptTokens: 0, completionTokens: 0, costUsd: 0 });
  });

  it("단가표에 없는 모델이면 토큰만 반환하고 비용은 null이다", async () => {
    vi.stubEnv("CLAUDE_MODEL", "test-model");
    mockResponse(message({ model: "test-model" }));
    expect((await requestStructuredOutput(request)).usage).toEqual({ promptTokens: 100, completionTokens: 20, costUsd: null });
  });

  it("응답 모델이 없으면 요청한 환경 변수 모델을 반환한다", async () => {
    mockResponse(message({ model: undefined }));
    expect((await requestStructuredOutput(request)).model).toBe(requestedModel);
  });

  it("거절 후 대체 모델이 답하면 대체 모델의 JSON과 모델을 반환하고 비용은 확정하지 않는다", async () => {
    mockResponse(message({
      model: "claude-opus-5",
      content: [
        { type: "text", text: '{"answer":' },
        { type: "fallback", from: { model: requestedModel }, to: { model: "claude-opus-5" }, trigger: { type: "refusal" } },
        { type: "text", text: '{"answer":"대체"}' },
      ],
      usage: {
        input_tokens: 200, output_tokens: 40,
        iterations: [{ type: "message", input_tokens: 100, output_tokens: 5 }, { type: "fallback_message", input_tokens: 100, output_tokens: 35 }],
      },
    }));
    expect(await requestStructuredOutput(request)).toEqual({
      data: { answer: "대체" },
      usage: { promptTokens: 200, completionTokens: 40, costUsd: null },
      model: "claude-opus-5",
    });
  });

  it("여러 text 블록은 이어 붙여 파싱한다", async () => {
    mockResponse(message({ content: [{ type: "text", text: '{"answer":' }, { type: "text", text: '"완료"}' }] }));
    expect((await requestStructuredOutput(request)).data).toEqual({ answer: "완료" });
  });

  it.each([null, [1, 2], { unrelated: true }])("JSON 내용의 스키마 검증은 호출자에게 맡긴다: %j", async (data) => {
    mockResponse(message({ content: [{ type: "text", text: JSON.stringify(data) }] }));
    expect((await requestStructuredOutput(request)).data).toEqual(data);
  });

  it.each([401, 429, 500, 529])("HTTP %i는 본문을 노출하지 않고 재시도 없이 실패한다", async (status) => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json(
      { type: "error", error: { type: "api_error", message: `${apiKey} ${request.user}` } },
      { status },
    ));
    await expectError(requestStructuredOutput(request), "http", status);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("네트워크 오류의 원문을 숨기고 상태 코드 없는 http 오류로 처리한다", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error(`${apiKey} ${request.system} ${request.user}`));
    await expectError(requestStructuredOutput(request), "http");
    expect(fetch).toHaveBeenCalledOnce();
  });

  it.each([null, [], {}, { content: null }, { content: [] }, { content: [null] },
    { content: [{ type: "thinking", thinking: "", signature: "sig" }] },
    ...[null, "", "  ", 123].map((text) => ({ content: [{ type: "text", text }] })),
  ])("메시지 내용이 없는 응답은 invalid-response이다: %j", async (body) => {
    mockResponse(body);
    await expectError(requestStructuredOutput(request), "invalid-response");
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("외부 응답 본문 자체가 JSON이 아니면 원문을 노출하지 않는다", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(`${apiKey} ${request.user}`));
    await expectError(requestStructuredOutput(request), "invalid-response");
    expect(fetch).toHaveBeenCalledOnce();
  });

  it.each([`아직 JSON이 아닙니다 ${apiKey}`, '```json\n{"answer":"완료"}\n```'])(
    "메시지 내용을 JSON으로 파싱할 수 없으면 실패한다: %s", async (text) => {
      mockResponse(message({ content: [{ type: "text", text }] }));
      await expectError(requestStructuredOutput(request), "invalid-response");
      expect(fetch).toHaveBeenCalledOnce();
    },
  );

  it.each(['{"answer":', '{"answer":"완료"}'])("길이 제한으로 잘리면 JSON 파싱 가능 여부와 무관하게 실패한다: %s", async (text) => {
    mockResponse(message({ content: [{ type: "text", text }], stop_reason: "max_tokens" }));
    await expectError(requestStructuredOutput(request), "invalid-response");
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("대체 모델까지 모두 거절하면 실패한다", async () => {
    mockResponse(message({ content: [{ type: "text", text: '{"answer":"완료"}' }], stop_reason: "refusal" }));
    await expectError(requestStructuredOutput(request), "invalid-response");
    expect(fetch).toHaveBeenCalledOnce();
  });

  it.each([undefined, 25])("시간 제한 %s을 넘기면 요청을 중단하고 timeout 오류를 반환한다", async (timeoutMs) => {
    let signal: AbortSignal | undefined;
    vi.mocked(fetch).mockImplementationOnce((_url, options) => {
      signal = options!.signal!;
      return new Promise((_resolve, reject) => {
        signal!.addEventListener("abort", () => reject(new Error(apiKey)), { once: true });
      });
    });
    const pending = expectError(requestStructuredOutput({ ...request, timeoutMs }), "timeout");
    const duration = timeoutMs ?? 120_000;
    await vi.advanceTimersByTimeAsync(duration - 1);
    expect(signal!.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(signal!.aborted).toBe(true);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("헤더를 받은 뒤 본문을 읽는 동안에도 시간 제한이 적용된다", async () => {
    vi.mocked(fetch).mockImplementationOnce(async (_url, options) => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          options!.signal!.addEventListener("abort", () => controller.error(new Error(apiKey)), { once: true });
        },
      });
      return new Response(body, { headers: { "content-type": "application/json" } });
    });
    const pending = expectError(requestStructuredOutput({ ...request, timeoutMs: 25 }), "timeout");
    await vi.advanceTimersByTimeAsync(25);
    await pending;
    expect(fetch).toHaveBeenCalledOnce();
  });
});
