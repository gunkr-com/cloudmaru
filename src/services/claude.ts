import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { jsonSchemaOutputFormat } from "@anthropic-ai/sdk/helpers/json-schema";
import { calculateClaudeCostUsd } from "@/lib/llm/claude-cost";
import type { LlmUsage } from "@/types/llm";
import { claudeApiKeyEnvSchema } from "@/lib/workspace/claude-settings";

const DEFAULT_MAX_TOKENS = 16_000;
const DEFAULT_TIMEOUT_MS = 120_000;

export class ClaudeError extends Error {
  readonly kind: "config" | "timeout" | "http" | "invalid-response";
  readonly status?: number;
  readonly usage: LlmUsage | null;

  constructor(kind: ClaudeError["kind"], message: string, status?: number, usage: LlmUsage | null = null) {
    super(message);
    this.name = "ClaudeError";
    this.kind = kind;
    this.status = status;
    this.usage = usage;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTokenCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function readUsage(value: unknown, model: string): LlmUsage | null {
  if (!isRecord(value) || !isTokenCount(value.input_tokens) || !isTokenCount(value.output_tokens)) return null;
  const cacheRead = value.cache_read_input_tokens ?? 0;
  const cacheCreation = value.cache_creation_input_tokens ?? 0;
  if (!isTokenCount(cacheRead) || !isTokenCount(cacheCreation)) return null;
  // 대체 모델이 응답하면 모델별 청구가 섞이므로 비용을 확정하지 않는다.
  const servedByFallback = Array.isArray(value.iterations)
    && value.iterations.some((entry) => isRecord(entry) && entry.type === "fallback_message");
  return {
    // API의 input_tokens에는 캐시 토큰이 빠져 있으므로 합산한다.
    promptTokens: value.input_tokens + cacheRead + cacheCreation,
    completionTokens: value.output_tokens,
    costUsd: servedByFallback ? null : calculateClaudeCostUsd(model, {
      inputTokens: value.input_tokens,
      outputTokens: value.output_tokens,
      cacheReadInputTokens: cacheRead,
      cacheCreationInputTokens: cacheCreation,
    }),
  };
}

// 대체 모델로 넘어간 경우 마지막 fallback 블록 뒤의 text만 최종 응답이다.
function readText(content: unknown[]): string {
  const lastFallback = content.findLastIndex((block) => isRecord(block) && block.type === "fallback");
  return content.slice(lastFallback + 1)
    .map((block) => (isRecord(block) && block.type === "text" && typeof block.text === "string" ? block.text : ""))
    .join("");
}

export async function requestStructuredOutput(request: {
  system: string;
  user: string;
  schemaName: string;
  jsonSchema: Record<string, unknown>;
  maxTokens?: number;
  timeoutMs?: number;
  // 개발용 평가가 피평가·채점 모델을 따로 고를 때만 쓴다. 생략하면 CLAUDE_MODEL과 effort medium이다.
  model?: string;
  effort?: "low" | "medium" | "high";
  // 생략은 개발용 eval만 사용한다. 앱 호출은 검증된 워크스페이스 참조 또는 null을 전달한다.
  apiKeyEnv?: string | null;
  // Only the server workspace resolver supplies file-backed keys. Never serialize this request.
  apiKey?: string;
}): Promise<{ data: unknown; usage: LlmUsage | null; model: string }> {
  const direct = Object.hasOwn(request, "apiKey");
  const scoped = Object.hasOwn(request, "apiKeyEnv");
  const reference = scoped ? claudeApiKeyEnvSchema.safeParse(request.apiKeyEnv) : null;
  if (!direct && scoped && (!reference?.success || !reference.data)) {
    throw new ClaudeError("config", "workspace.claude.unavailable");
  }
  const apiKey = direct ? request.apiKey : process.env[reference?.success && reference.data ? reference.data : "ANTHROPIC_API_KEY"];
  if (direct && !apiKey?.trim()) throw new ClaudeError("config", "workspace.claude.unavailable");
  if (scoped && !apiKey?.trim()) throw new ClaudeError("config", "workspace.claude.unavailable");
  const model = request.model ?? process.env.CLAUDE_MODEL;
  if (!apiKey?.trim() || !model?.trim()) {
    const missing = [
      ...(!apiKey?.trim() ? ["ANTHROPIC_API_KEY"] : []),
      ...(!model?.trim() ? [request.model === undefined ? "CLAUDE_MODEL" : "model"] : []),
    ];
    throw new ClaudeError("config", missing.join(", "));
  }

  const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const client = new Anthropic({
    apiKey,
    // 셸의 다른 인증 토큰이나 프록시 주소로 키가 새지 않도록 고정한다.
    authToken: null,
    baseURL: "https://api.anthropic.com",
    maxRetries: 0,
    timeout: timeoutMs,
    // SDK 디버그 로그에는 프롬프트가 포함되므로 끈다.
    logLevel: "off",
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let responseUsage: LlmUsage | null = null;

  try {
    let message: unknown;
    try {
      message = await client.beta.messages.create({
        model,
        max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
        system: request.system,
        messages: [{ role: "user", content: request.user }],
        // Opus 5.5의 기본 effort(medium)를 명시한다. 사고(thinking)는 이 모델에서 끌 수 없다.
        // The SDK adapts unsupported wire constraints into descriptions. Callers
        // retain their original schemas and enforce every constraint before save.
        output_config: { effort: request.effort ?? "medium", format: jsonSchemaOutputFormat(
          request.jsonSchema as Parameters<typeof jsonSchemaOutputFormat>[0],
        ) },
        // 안전 분류기가 거절하면 서버가 같은 요청을 대체 모델로 다시 실행한다.
        fallbacks: "default",
        betas: ["server-side-fallback-2026-07-01"],
      }, { signal: controller.signal });
    } catch (error) {
      if (error instanceof Anthropic.APIError && error.status !== undefined) {
        // 오류 본문에는 프롬프트 일부가 포함될 수 있으므로 상태 코드만 전달한다.
        throw new ClaudeError("http", `Claude API 요청에 실패했습니다 (HTTP ${error.status}).`, error.status);
      }
      if (error instanceof Anthropic.APIConnectionError) {
        throw error;
      }
      throw new ClaudeError("invalid-response", "Claude API 응답을 JSON으로 읽을 수 없습니다.");
    }

    const servedModel = isRecord(message) && typeof message.model === "string" && message.model.trim() ? message.model : model;
    // 길이 초과·거절·잘못된 JSON도 청구될 수 있다. 본문 대신 검증한 사용량만 오류에 보존한다.
    responseUsage = isRecord(message) ? readUsage(message.usage, servedModel) : null;
    if (isRecord(message) && message.stop_reason === "max_tokens") {
      throw new ClaudeError("invalid-response", "Claude 출력이 길이 제한으로 잘렸습니다.");
    }
    if (isRecord(message) && message.stop_reason === "refusal") {
      throw new ClaudeError("invalid-response", "Claude가 요청을 거절했습니다.");
    }
    const text = isRecord(message) && Array.isArray(message.content) ? readText(message.content) : "";
    if (!isRecord(message) || !text.trim()) {
      throw new ClaudeError("invalid-response", "Claude 응답에 메시지 내용이 없습니다.");
    }

    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      throw new ClaudeError("invalid-response", "Claude 메시지가 올바른 JSON이 아닙니다.");
    }
    // JSON 내용의 스키마 검증은 호출자가 수행한다.
    return { data, usage: responseUsage, model: servedModel };
  } catch (error) {
    if (controller.signal.aborted || error instanceof Anthropic.APIConnectionTimeoutError) {
      throw new ClaudeError("timeout", "Claude API 요청 시간이 초과되었습니다.", undefined, responseUsage);
    }
    if (error instanceof ClaudeError) throw new ClaudeError(error.kind, error.message, error.status, responseUsage);
    // SDK의 원본 예외나 cause를 전달하면 비밀값이 노출될 수 있다.
    throw new ClaudeError("http", "Claude API에 연결할 수 없습니다.");
  } finally {
    // 헤더 수신뿐 아니라 응답 본문을 모두 읽을 때까지 시간 제한을 유지한다.
    clearTimeout(timer);
  }
}
