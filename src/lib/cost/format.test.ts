import { describe, expect, it } from "vitest";
import { formatCostNote, formatBudgetRatio, formatQuantity, formatQuantityNumber } from "@/lib/cost/format";
import { formatMoney } from "@/i18n/format";

describe("formatMoney", () => {
  it.each([
    [0, "CA$0"],
    [999, "CA$999"],
    [1000, "CA$1,000"],
    [286700, "CA$286,700"],
    [1234567, "CA$1,234,567"],
  ])("%s원을 %s로 표기한다", (amount, expected) => {
    expect(formatMoney(amount, "CAD", "ko")).toBe(expected);
  });
});

describe("formatBudgetRatio", () => {
  it.each([
    [0, "0%"],
    [0.956, "96%"],
    [1, "100%"],
    [2.04, "204%"],
    [0.004, "0%"],
    [0.005, "1%"],
    [17.71, "1,771%"],
    [17.7118, "1,771%"],
    [123.456, "12,346%"],
  ])("예산 대비 비율 %s를 %s로 표기한다", (ratio, expected) => {
    expect(formatBudgetRatio(ratio)).toBe(expected);
  });
});

describe("formatQuantityNumber", () => {
  it.each([
    [1, "1"],
    [0.25, "0.25"],
    [0.00001, "0.00001"],
    [200000, "200,000"],
    [1000000, "1,000,000"],
    [1234.56789, "1,234.56789"],
  ])("수량 %s를 %s로 표기한다", (quantity, expected) => {
    expect(formatQuantityNumber(quantity)).toBe(expected);
  });
});

describe("formatQuantity", () => {
  it.each([
    [1, "대", "1대"],
    [1000, "대", "1,000대"],
    [10, "만 건", "10만 건"],
    [1, "백만 건", "1백만 건"],
    [100, "GB", "100GB"],
    [1234.56789, "GB", "1,234.56789GB"],
    [200000, "GB·초", "200,000GB·초"],
    [1000000, "회", "1,000,000회"],
  ])("수량 %s와 단위 %s를 천 단위 쉼표와 붙인 단위 %s로 표기한다", (quantity, unitLabel, expected) => {
    expect(formatQuantity(quantity, { en: unitLabel, ko: unitLabel }, "ko")).toBe(expected);
  });

  it.each([
    [0.25, "상시 실행 vCPU", "0.25 상시 실행 vCPU"],
    [20, "상시 사용 용량 단위", "20 상시 사용 용량 단위"],
  ])("설명이 앞에 오는 단위는 띄어 쓴다: %s %s", (quantity, unitLabel, expected) => {
    expect(formatQuantity(quantity, { en: unitLabel, ko: unitLabel }, "ko")).toBe(expected);
  });

  it.each([
    [100000, "10회", "100,000 × 10회"],
    [1, "10회", "1 × 10회"],
    [3, "1,000건", "3 × 1,000건"],
  ])("숫자로 시작하는 단위는 수량과 붙여 다른 숫자로 읽히지 않게 곱셈 기호로 나눈다: %s %s", (quantity, unitLabel, expected) => {
    expect(formatQuantity(quantity, { en: unitLabel, ko: unitLabel }, "ko")).toBe(expected);
  });
});

it("formats catalog quantity and notes in both languages", () => {
  const unitLabel = { en: "instance(s)", ko: "대" };
  const line = { componentId: "x", name: { en: "Compute", ko: "컴퓨트" }, unitLabel, quantity: 2, amount: 10, hourly: true, assumptionLabel: null, isAssumption: false };
  expect(formatQuantity(2, unitLabel, "en")).toBe("2 instance(s)");
  expect(formatQuantity(2, unitLabel, "ko")).toBe("2대");
  expect(formatCostNote(line, "en")).toBe("2 instance(s) · 730 hours");
  expect(formatCostNote(line, "ko")).toBe("2대 · 730시간");
  const usage = { ...line, assumptionLabel: { en: "{quantity} GB per month", ko: "월 {quantity}GB" }, isAssumption: true };
  expect(formatCostNote(usage, "en")).toBe("Assumption: 2 GB per month");
  expect(formatCostNote(usage, "ko")).toBe("가정: 월 2GB");
});
