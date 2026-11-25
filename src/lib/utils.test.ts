import { describe, expect, it } from "vitest";
import { cn } from "@/lib/utils";

describe("cn", () => {
  it("조건부 클래스와 중첩 배열을 합치고 빈 값을 제외한다", () => {
    expect(
      cn("flex", ["items-center", ["gap-4"]], {
        "font-semibold": true,
        hidden: false,
      }, null, undefined, false),
    ).toBe("flex items-center gap-4 font-semibold");
  });

  it("충돌하는 Tailwind 클래스는 뒤에 전달한 값을 적용한다", () => {
    expect(cn("p-2 text-ink bg-canvas", "p-4 text-body bg-surface-1")).toBe(
      "p-4 text-body bg-surface-1",
    );
  });

  it("상태별 클래스는 기본 클래스와 독립적으로 병합한다", () => {
    expect(cn("p-2 hover:p-4", "hover:p-6")).toBe("p-2 hover:p-6");
  });

  it("입력이 없으면 빈 문자열을 반환한다", () => {
    expect(cn()).toBe("");
  });
});
