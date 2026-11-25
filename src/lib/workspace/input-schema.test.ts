import { expect, it } from "vitest";
import { isMessageKey } from "@/i18n/translate";
import { workspaceInputSchema } from "./input-schema";
const valid = { name: " Team ", companyName: " Company ", defaultRegion: "canadacentral" };
it("trims text and converts empty company names to null", () => {
  expect(workspaceInputSchema.parse(valid)).toEqual({ name: "Team", companyName: "Company", defaultRegion: "canadacentral" });
  for (const companyName of [null, "", "  "]) expect(workspaceInputSchema.parse({ ...valid, companyName }).companyName).toBeNull();
  expect(workspaceInputSchema.parse({ ...valid, defaultRegion: " canadacentral " }).defaultRegion).toBe("canadacentral");
});
it("accepts maximum lengths after trimming", () => {
  expect(workspaceInputSchema.safeParse({ ...valid, name: "a".repeat(80), companyName: "b".repeat(120) }).success).toBe(true);
});
it.each([{ name: " " }, { name: "a".repeat(81) }, { companyName: "a".repeat(121) }, { defaultRegion: "koreacentral" }, { name: null }, { companyName: 42 }, { defaultRegion: "" }])("rejects invalid input %j", patch => {
  const result = workspaceInputSchema.safeParse({ ...valid, ...patch });
  expect(result.success).toBe(false);
  if (!result.success) expect(result.error.issues.every(issue => isMessageKey(issue.message))).toBe(true);
});
