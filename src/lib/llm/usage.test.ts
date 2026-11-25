import { describe, expect, it } from "vitest";
import { addLlmUsage, readLlmErrorUsage } from "./usage";

const a = { promptTokens: 10, completionTokens: 20, costUsd: 0.1 };
const b = { promptTokens: 1, completionTokens: 2, costUsd: 0.25 };

it("reads only valid token/cost fields from sanitized failure usage", () => {
  expect(readLlmErrorUsage(Object.assign(Error("synthetic"), { usage: { ...a, response: "private" } }))).toEqual(a);
  expect(readLlmErrorUsage({ usage: { ...a, costUsd: null } })).toEqual({ ...a, costUsd: null });
  for (const error of [null, "bad", {}, { usage: null }, { usage: {} }, { usage: { ...a, costUsd: Infinity } },
    { usage: { ...a, costUsd: -1 } }, { usage: { ...a, promptTokens: 1.5 } }, { usage: { ...a, completionTokens: -1 } }]) {
    expect(readLlmErrorUsage(error)).toBeNull();
  }
});

describe("addLlmUsage", () => {
  it("둘 다 없으면 null", () => {
    expect(addLlmUsage(null, null)).toBeNull();
  });
  it("한쪽만 있으면 그 값을 그대로 돌려준다", () => {
    expect(addLlmUsage(a, null)).toEqual(a);
    expect(addLlmUsage(null, b)).toEqual(b);
  });
  it("토큰과 비용을 더한다", () => {
    expect(addLlmUsage(a, b)).toEqual({ promptTokens: 11, completionTokens: 22, costUsd: 0.35 });
  });
  it("어느 한쪽 비용을 모르면 합계 비용도 null로 둔다", () => {
    expect(addLlmUsage(a, { ...b, costUsd: null })).toEqual({ promptTokens: 11, completionTokens: 22, costUsd: null });
    expect(addLlmUsage({ ...a, costUsd: null }, b)).toEqual({ promptTokens: 11, completionTokens: 22, costUsd: null });
  });
  it("입력을 바꾸지 않는다", () => {
    const left = { ...a }; const right = { ...b };
    addLlmUsage(left, right);
    expect(left).toEqual(a); expect(right).toEqual(b);
  });
});
