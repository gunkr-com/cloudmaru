import { describe, expect, it, vi } from "vitest";

describe("server-only 테스트 별칭", () => {
  it("서버 전용 모듈을 테스트에서 예외 없이 불러온다", async () => {
    const serverOnly = await vi.importActual("server-only");

    expect(Object.keys(serverOnly)).toEqual([]);
  });
});
