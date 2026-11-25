import { describe, expect, it } from "vitest";
import { formatBudgetInput, getFormattedBudgetCaret, parseBudgetInput } from "@/lib/form/budget";

describe("budget input helpers", () => {
  it.each([
    ["1500000", "1,500,000"],
    ["1,5000", "15,000"],
    ["12.5", "12.5"],
    ["abc", "abc"],
    ["", ""],
    ["0001", "1"],
  ])("formats %s as %s", (raw, formatted) => {
    expect(formatBudgetInput(raw)).toBe(formatted);
  });

  it.each([
    ["1,500,000", 1_500_000],
    ["", Number.NaN],
    [" 1,000 ", 1_000],
  ])("parses %s", (raw, parsed) => {
    const result = parseBudgetInput(raw);
    if (Number.isNaN(parsed)) expect(result).toBeNaN();
    else expect(result).toBe(parsed);
  });

  it.each([
    ["1,2500,000", 3, 2],
    ["12,50,000", 5, 5],
    ["1500000", 7, 9],
    ["1500000", 0, 0],
    ["0012", 3, 1],
    ["0012", 1, 0],
    ["12.5", 2, 2],
    ["1,500,000", 4, 4],
  ])("keeps the caret of %s at %i after the same digits (%i)", (raw, caret, expected) => {
    expect(getFormattedBudgetCaret(raw, caret)).toBe(expected);
  });
});
