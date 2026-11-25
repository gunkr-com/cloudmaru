import { expect, it } from "vitest";
import { inventory as en } from "../en/inventory";
import { inventory as ko } from "../ko/inventory";
import { MESSAGES } from "../index";
import { createTranslator } from "@/i18n/translate";
import type { ResourceFamily, ResourceStage } from "@/lib/inventory/classify";

it("인벤토리 사전을 등록하고 두 언어의 구조와 매개변수를 맞춘다", () => {
  const shape = (value: object): unknown => Object.fromEntries(Object.entries(value).map(([key, leaf]) => [key, typeof leaf === "string" ? [...leaf.matchAll(/\{([^}]+)\}/g)].map(match => match[1]).sort() : shape(leaf)]));
  expect(shape(ko)).toEqual(shape(en));
  expect(MESSAGES.en.inventory).toBe(en);
  expect(MESSAGES.ko.inventory).toBe(ko);
  const families: Record<ResourceFamily, string> = en.families;
  const stages: Record<ResourceStage, string> = en.stages;
  expect(Object.keys(families)).toHaveLength(23);
  expect(Object.keys(stages)).toHaveLength(7);
  expect(en.errors.api["connection-missing"]).toBe(en.errors.scan["connection-missing"]);
  expect(ko.errors.api["connection-missing"]).toBe(ko.errors.scan["connection-missing"]);
});
it("두 언어의 매개변수를 치환한다", () => {
  const en = createTranslator("en");
  expect(en("inventory.connection.summaryOne", { tenant: "abc", count: 1 })).toBe("Tenant abc · 1 target subscription");
  expect(en("inventory.summary.unreadOne", { count: 1 })).toBe("1 subscription returned no resources. The app may not have the Reader role on it.");
  expect(en("inventory.summary.skippedOne", { count: 1 })).toBe("1 row could not be read and was skipped.");
  expect(en("inventory.detail.familyCountOne", { count: 1 })).toBe("1 resource");
  expect(en("inventory.table.tagCountOne", { count: 1 })).toBe("1 tag");
  expect(en("inventory.table.matchedOne", { from: 1, to: 1, matched: 1 })).toBe("Showing 1–1 of 1 resource");
  expect(en("workspace.connectedOne", { count: 1 })).toBe("Connected · 1 subscription");
  expect(createTranslator("en")("inventory.connection.summary", { tenant: "abc", count: 2 })).toBe("Tenant abc · 2 target subscriptions");
  expect(createTranslator("ko")("inventory.table.matched", { from: 1, to: 50, matched: 80 })).toBe("리소스 80개 중 1–50");
});
