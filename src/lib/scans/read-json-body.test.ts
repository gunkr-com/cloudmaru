// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { readJsonBody, SCAN_BODY_MAX_BYTES } from "./read-json-body";
import nextConfig from "../../../next.config";

const request = (body: string, length?: string) => new Request("http://local", {
  method: "POST", body, headers: length === undefined ? {} : { "Content-Length": length },
});
describe("readJsonBody", () => {
  it("uses a 64 MiB limit", () => {
    expect(SCAN_BODY_MAX_BYTES).toBe(64 * 1024 * 1024);
  });
  it("keeps the proxy body buffer above the limit so the route sees oversized bodies", () => {
    // proxy는 본문을 이 크기까지만 버퍼링하고 나머지를 오류 없이 자른다. 상한보다 작으면 큰 가져오기가 invalid-body가 된다.
    const proxyLimit = nextConfig.experimental?.proxyClientMaxBodySize;
    expect(typeof proxyLimit).toBe("number");
    expect(proxyLimit as number).toBeGreaterThan(SCAN_BODY_MAX_BYTES);
  });
  it("rejects an oversized header without reading the body", async () => {
    const req = request("{}", "11");
    const read = vi.spyOn(req.body!, "getReader");
    expect(await readJsonBody(req, 10)).toEqual({ ok: false, code: "import-too-large" });
    expect(read).not.toHaveBeenCalled();
  });
  it.each([undefined, "1"])("counts streamed bytes and cancels with header %s", async length => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('"한'));
        controller.enqueue(new TextEncoder().encode('글"'));
      }, cancel,
    });
    const req = new Request("http://local", { method: "POST", body: stream,
      headers: length ? { "Content-Length": length } : {}, duplex: "half",
    } as RequestInit);
    expect(await readJsonBody(req, 5)).toEqual({ ok: false, code: "import-too-large" });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(stream.locked).toBe(false);
  });
  it.each(["{", "", "undefined"])("rejects invalid JSON %s", async body => {
    expect(await readJsonBody(request(body), 20)).toEqual({ ok: false, code: "invalid-body" });
  });
  it("rejects an absent body", async () => {
    expect(await readJsonBody(new Request("http://local", { method: "POST" }), 20))
      .toEqual({ ok: false, code: "invalid-body" });
  });
  it("handles stream failures without exposing errors", async () => {
    const stream = new ReadableStream({ start(controller) { controller.error(Error("private")); } });
    const req = new Request("http://local", { method: "POST", body: stream, duplex: "half" } as RequestInit);
    expect(await readJsonBody(req, 20)).toEqual({ ok: false, code: "invalid-body" });
    expect(stream.locked).toBe(false);
  });
  it("parses UTF-8 split across chunks at the exact byte limit", async () => {
    const bytes = new TextEncoder().encode('{"name":"한글"}');
    const stream = new ReadableStream<Uint8Array>({ start(controller) {
      for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
      controller.close();
    } });
    const req = new Request("http://local", { method: "POST", body: stream, duplex: "half" } as RequestInit);
    expect(await readJsonBody(req, bytes.length)).toEqual({ ok: true, value: { name: "한글" } });
  });
  it.each([null, [1], 42, true])("accepts JSON value %j for later schema validation", async value => {
    expect(await readJsonBody(request(JSON.stringify(value)), 20)).toEqual({ ok: true, value });
  });
});
