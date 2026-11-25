import "server-only";

export const ARM_BASE_URL = "https://management.azure.com";
export class AzureRequestError extends Error {
  readonly kind: "forbidden" | "not-found" | "throttled" | "timeout" | "http" | "invalid-response" | "too-many-rows" | "disallowed";
  readonly status?: number;
  readonly retryAfterSeconds?: number;

  constructor(kind: AzureRequestError["kind"], status?: number, retryAfterSeconds?: number) {
    super(`Azure request failed (${kind}).`);
    this.name = "AzureRequestError";
    this.kind = kind;
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}
export type AzureRequest = { method: "GET" | "POST"; path: string; body?: unknown };
export type AzureRequestDeps = { getToken: () => Promise<string>; fetch?: typeof fetch; timeoutMs?: number };

export function isAllowedAzureRequest(request: AzureRequest): boolean {
  if (!request || typeof request.path !== "string") return false;
  const { path, method } = request;
  // URL 정규화로 호스트·경로가 바뀌는 입력도 인증 전에 거절한다.
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("://")
    || /[\\\s#]/u.test(path)) return false;
  try {
    const url = new URL(path, ARM_BASE_URL);
    const pathname = path.split("?")[0];
    const decoded = decodeURIComponent(pathname);
    const hasDotSegment = (value: string) => value.split("/").some(segment => segment === "." || segment === "..");
    if (url.origin !== ARM_BASE_URL || url.pathname !== pathname
      || hasDotSegment(pathname) || hasDotSegment(decoded) || /[\\?#]/u.test(decoded) || decoded.startsWith("//")) return false;
    if (!url.searchParams.get("api-version")?.trim()) return false;
    if (method === "GET") return true;
    if (method !== "POST") return false;
    // 디코딩한 경로로 판정한다. 인코딩한 유니코드 리소스 그룹 이름은 받고, 인코딩한 슬래시(%2F)는
    // 세그먼트가 늘어나 맞지 않으며, 두 번 인코딩한 값(%25…)은 디코딩 뒤에도 %가 남아 거절된다.
    const lower = decoded.toLowerCase();
    return lower === "/providers/microsoft.resourcegraph/resources"
      || /^\/subscriptions\/[^/%]+(?:\/resourcegroups\/[^/%]+)?\/providers\/microsoft\.costmanagement\/query$/u.test(lower);
  } catch {
    return false;
  }
}

export async function azureRequest(request: AzureRequest, deps: AzureRequestDeps): Promise<unknown> {
  if (!isAllowedAzureRequest(request)) throw new AzureRequestError("disallowed");
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new AzureRequestError("timeout"));
    }, deps.timeoutMs ?? 30_000);
  });
  try {
    // 토큰 조회와 본문 읽기도 시간 제한에 포함한다. 재시도하지 않는다.
    return await Promise.race([timeout, (async () => {
      const token = await deps.getToken();
      controller.signal.throwIfAborted();
      const response = await (deps.fetch ?? globalThis.fetch)(ARM_BASE_URL + request.path, {
        method: request.method,
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: request.body === undefined ? undefined : JSON.stringify(request.body),
        signal: controller.signal,
        redirect: "error",
        cache: "no-store",
      });
      if (!response.ok) {
        const status = response.status;
        const kind = status === 401 || status === 403 ? "forbidden"
          : status === 404 ? "not-found" : status === 429 ? "throttled" : "http";
        const retry = response.headers.get("Retry-After");
        const seconds = retry !== null && /^\d+$/u.test(retry) ? Number(retry) : NaN;
        throw new AzureRequestError(kind, status, kind === "throttled" && Number.isFinite(seconds) ? seconds : undefined);
      }
      // Cost Management는 조회할 행이 없으면 204를 돌려준다. 0원으로 추정하지 않는다.
      if (response.status === 204) return null;
      try {
        return await response.json();
      } catch {
        throw new AzureRequestError("invalid-response");
      }
    })()]);
  } catch (error) {
    if (controller.signal.aborted) throw new AzureRequestError("timeout");
    if (error instanceof AzureRequestError) throw error;
    // 자격 증명 오류(credential.ts)는 message에 kind만 담는다. 그대로 올려 스캔 오류 코드를 보존한다.
    if (error instanceof Error && error.name === "AzureCredentialError") throw error;
    // 원본 오류와 cause에는 토큰이나 응답 본문이 있을 수 있다.
    throw new AzureRequestError("http");
  } finally {
    clearTimeout(timer);
  }
}
