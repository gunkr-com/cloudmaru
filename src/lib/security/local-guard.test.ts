import { describe, expect, it } from "vitest";
import { checkLocalRequest, parseAllowedHosts, type LocalRequest } from "./local-guard";

const defaults = parseAllowedHosts(undefined);
const base: LocalRequest = {
  method: "POST", pathname: "/api/analyses", host: "localhost:3000",
  origin: "http://localhost:3000", secFetchSite: null, contentType: "application/json",
};
const check = (changes: Partial<LocalRequest>) => checkLocalRequest({ ...base, ...changes }, defaults);

describe("parseAllowedHosts", () => {
  it("includes loopback hosts and normalizes comma-separated additions", () => {
    expect(defaults).toEqual(["localhost", "127.0.0.1", "[::1]"]);
    expect(parseAllowedHosts(" Mac.Tail.ts.net , , example.test ")).toEqual([
      ...defaults, "mac.tail.ts.net", "example.test",
    ]);
  });
});

describe("checkLocalRequest", () => {
  it.each(["localhost", "localhost:3100", "127.0.0.1:80", "[::1]", "[::1]:3000", "LOCALHOST:3000"])("allows local host %s", (host) => {
    expect(check({ host, origin: `http://${host}` })).toEqual({ ok: true });
  });
  it.each([null, "", "evil.test", "localhost.evil.test:3000", "localhost:3000@evil.test", "localhost/path", "localhost:abc", "localhost:3000,evil.test"])("rejects missing, remote or malformed host %s", (host) => {
    expect(check({ host })).toEqual({ ok: false, status: 403, reason: "host" });
  });
  it.each(["GET", "HEAD", "OPTIONS"])("allows %s without origin or JSON but checks Host", (method) => {
    expect(check({ method, origin: null, contentType: null })).toEqual({ ok: true });
    expect(check({ method, host: "evil.test" })).toEqual({ ok: false, status: 403, reason: "host" });
  });
  it.each(["https://evil.test", "http://localhost:3001", "http://127.0.0.1:3000", "null", "bad url", "http://localhost:3000@evil.test", "http://localhost:3000/path"])("rejects origin %s even with same-origin fetch metadata", (origin) => {
    expect(check({ origin, secFetchSite: "same-origin" })).toEqual({ ok: false, status: 403, reason: "origin" });
  });
  it.each([null, "same-site", "cross-site", "none"])("rejects absent origin with fetch site %s", (secFetchSite) => {
    expect(check({ origin: null, secFetchSite })).toEqual({ ok: false, status: 403, reason: "origin" });
  });
  it("allows absent origin only with same-origin fetch metadata", () => {
    expect(check({ origin: null, secFetchSite: "same-origin" })).toEqual({ ok: true });
  });
  it.each(["POST", "PUT", "PATCH", "DELETE"])("requires JSON for API %s", (method) => {
    for (const contentType of [null, "text/plain", "application/x-www-form-urlencoded", "application/jsonp"]) {
      expect(check({ method, contentType })).toEqual({ ok: false, status: 415, reason: "content-type" });
    }
    expect(check({ method, contentType: "Application/JSON; charset=utf-8" })).toEqual({ ok: true });
  });
  it("allows same-origin form POSTs outside API routes", () => {
    expect(check({ pathname: "/workspaces", contentType: "application/x-www-form-urlencoded" })).toEqual({ ok: true });
    expect(check({ pathname: "/workspaces", origin: "https://evil.test" })).toEqual({ ok: false, status: 403, reason: "origin" });
  });
  it("allows exact extra hosts, without wildcard matching", () => {
    const allowed = parseAllowedHosts("mac.tail.ts.net,*.example.test,*");
    expect(checkLocalRequest({ ...base, host: "MAC.TAIL.TS.NET:3100", origin: "http://mac.tail.ts.net:3100" }, allowed)).toEqual({ ok: true });
    expect(checkLocalRequest({ ...base, host: "evil.example.test" }, allowed)).toEqual({ ok: false, status: 403, reason: "host" });
  });
});
