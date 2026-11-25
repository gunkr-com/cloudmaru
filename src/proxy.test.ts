// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { proxy, config } from "./proxy";

function request(path = "/api/analyses", headers: Record<string, string> = {}, method = "POST") {
  return new NextRequest(`http://localhost:3000${path}`, {
    method, headers: { host: "localhost:3000", origin: "http://localhost:3000", "content-type": "application/json", ...headers },
  });
}

afterEach(() => vi.unstubAllEnvs());

describe("proxy", () => {
  it.each(["/analyses/new", "/api/analyses", "/workspaces"])("passes local requests without session checks: %s", async (path) => {
    const result = await proxy(request(path));
    expect(result.headers.get("x-middleware-next")).toBe("1");
  });
  it.each([
    [{ host: "evil.test" }, 403],
    [{ origin: "http://localhost:3001" }, 403],
    [{ "content-type": "text/plain" }, 415],
  ] as const)("rejects invalid headers %j without caching", async (headers, status) => {
    const result = await proxy(request("/api/analyses", headers));
    expect(result.status).toBe(status);
    expect(result.headers.get("Cache-Control")).toBe("no-store");
    expect(result.headers.get("location")).toBeNull();
  });
  it("uses the actual Host header rather than URL or forwarded headers", async () => {
    const req = request();
    req.headers.delete("host");
    req.headers.set("x-forwarded-host", "localhost:3000");
    expect((await proxy(req)).status).toBe(403);
  });
  it("passes fetch metadata and form content types to the guard", async () => {
    const req = request("/workspaces", { "content-type": "multipart/form-data; boundary=test", "sec-fetch-site": "same-origin" });
    req.headers.delete("origin");
    expect((await proxy(req)).headers.get("x-middleware-next")).toBe("1");
    req.headers.set("sec-fetch-site", "same-site");
    expect((await proxy(req)).status).toBe(403);
  });
  it("reads additional allowed hosts from the environment", async () => {
    vi.stubEnv("CLOUDSIGHT_ALLOWED_HOSTS", "mac.tail.ts.net");
    expect((await proxy(request("/api/analyses", { host: "mac.tail.ts.net:3100", origin: "http://mac.tail.ts.net:3100" }))).headers.get("x-middleware-next")).toBe("1");
  });
  // 앱 경로가 확장자처럼 끝나도 proxy를 건너뛰면 안 된다. 건너뛰면 DNS 리바인딩으로
  // 레이아웃(워크스페이스 이름·회사명)이 담긴 404 페이지를 읽을 수 있다.
  it.each([
    "/", "/analyses/new", "/analyses/x.png", "/workspaces/x.svg", "/api/analyses/abc.png",
    "/analyses/x.woff2", "/_next/image?url=%2Ffile.svg&w=64&q=75", "/file.svg", "/_next/staticx",
  ])("runs on app paths even when they look like static files: %s", (path) => {
    expect(unstable_doesMiddlewareMatch({ config, url: `http://localhost:3000${path}` })).toBe(true);
  });
  it.each(["/_next/static/chunks/app.js", "/_next/static/media/font.woff2", "/favicon.ico"])("skips only built static assets: %s", (path) => {
    expect(unstable_doesMiddlewareMatch({ config, url: `http://localhost:3000${path}` })).toBe(false);
  });
});
