export const SCAN_BODY_MAX_BYTES = 64 * 1024 * 1024;

type ReadJsonResult =
  | { ok: true; value: unknown }
  | { ok: false; code: "invalid-body" | "import-too-large" };

export async function readJsonBody(request: Request, maxBytes: number): Promise<ReadJsonResult> {
  const length = request.headers.get("content-length");
  if (length !== null && Number(length) > maxBytes) return { ok: false, code: "import-too-large" };
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    if (!request.body) return { ok: false, code: "invalid-body" };
    reader = request.body.getReader();
    const decoder = new TextDecoder();
    let bytes = 0;
    let text = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        // 취소 실패도 크기 초과 판정을 바꾸지 않는다.
        void reader.cancel().catch(() => {});
        return { ok: false, code: "import-too-large" };
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, code: "invalid-body" };
  } finally {
    reader?.releaseLock();
  }
}
