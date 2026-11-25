import { expect, it } from "vitest";
import { extension as en } from "../en/extension";
import { extension as ko } from "../ko/extension";
import { MESSAGES } from "../index";
import { createTranslator } from "@/i18n/translate";


function shape(value: object): unknown {
  return Object.fromEntries(Object.entries(value).map(([key, leaf]) => [key,
    typeof leaf === "string" ? [...leaf.matchAll(/\{([^}]+)\}/g)].map(match => match[1]).sort() : shape(leaf)]));
}
it("extension 사전의 키·매개변수·등록과 실제 상태 라벨을 검증한다", () => {
  expect(shape(ko)).toEqual(shape(en));
  expect(MESSAGES.en.extension).toBe(en);
  expect(MESSAGES.ko.extension).toBe(ko);
  expect(en.status).toEqual({"pending":"Analyzing extension","succeeded":"Completed","failed":"Failed"});
  expect(en.verdict).toEqual({"pass":"Pass","violation":"Violation","unknown":"Unknown"});

  function check(value: object) {
    for (const child of Object.values(value)) {
      if (typeof child === "string") expect(child.trim().length).toBeGreaterThan(0);
      else check(child);
    }
  }
  check(en);
  check(ko);
});
it("extension의 소유 스캔 문구를 두 언어로 치환한다", () => {
  expect(createTranslator("en")("extension.sourceScan", { id: "saved-scan" })).toContain("saved-scan");
  expect(createTranslator("ko")("extension.sourceScan", { id: "saved-scan" })).toContain("saved-scan");
});
it("labels explicit deployment cardinality in both languages", () => {
  expect(createTranslator("en")("extension.result.instanceCount", { count: 2 })).toBe("Deployment instances: 2");
  expect(createTranslator("ko")("extension.result.instanceCount", { count: 2 })).toBe("배포 인스턴스 수: 2");
});

it("provides bilingual Extend form/history, pinned-source guidance and cost assumption", () => {
  for (const dictionary of [en, ko]) {
    expect(dictionary.ui.new).toBeTruthy();
    expect(dictionary.ui.history).toBeTruthy();
    expect(dictionary.ui.foreignRerun).toBeTruthy();
    expect(dictionary.ui.scanHelp).toBeTruthy();
    expect(dictionary.freeGrantNotice).toBeTruthy();
  }
});
