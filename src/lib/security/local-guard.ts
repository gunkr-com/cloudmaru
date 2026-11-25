export type LocalRequest = {
  method: string;
  pathname: string;
  host: string | null;
  origin: string | null;
  secFetchSite: string | null;
  contentType: string | null;
};

export type GuardDecision =
  | { ok: true }
  | { ok: false; status: 403 | 415; reason: "host" | "origin" | "content-type" };

export function parseAllowedHosts(extra: string | undefined): string[] {
  return ["localhost", "127.0.0.1", "[::1]", ...(extra ?? "").split(",").map((host) => host.trim().toLowerCase()).filter(Boolean)];
}

// URL 파서의 사용자 정보·경로 처리나 호스트 정규화로 잘못된 Host가 허용되지 않게 한다.
function hostname(host: string): string | null {
  const match = /^(\[[0-9a-f:]+\]|[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?)(?::([0-9]+))?$/i.exec(host);
  if (!match || (match[2] !== undefined && Number(match[2]) > 65535)) return null;
  return match[1].toLowerCase();
}

export function checkLocalRequest(request: LocalRequest, allowedHosts: readonly string[]): GuardDecision {
  const host = request.host?.toLowerCase();
  const name = host ? hostname(host) : null;
  if (!name || !allowedHosts.includes(name)) return { ok: false, status: 403, reason: "host" };

  const method = request.method.toUpperCase();
  if (["GET", "HEAD", "OPTIONS"].includes(method)) return { ok: true };

  if (request.origin !== null) {
    // Origin의 호스트는 포트를 포함해 요청 Host와 같아야 한다.
    const originHost = /^https?:\/\/([^/?#]+)$/i.exec(request.origin)?.[1].toLowerCase();
    const originName = originHost ? hostname(originHost) : null;
    if (!originName || !allowedHosts.includes(originName) || originHost !== host) {
      return { ok: false, status: 403, reason: "origin" };
    }
  } else if (request.secFetchSite !== "same-origin") {
    return { ok: false, status: 403, reason: "origin" };
  }

  if (request.pathname.startsWith("/api/") && ["POST", "PUT", "PATCH", "DELETE"].includes(method)
    && request.contentType?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    return { ok: false, status: 415, reason: "content-type" };
  }
  return { ok: true };
}
