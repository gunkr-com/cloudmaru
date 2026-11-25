import { expect, it } from "vitest";
import { extensionArtifacts as en } from "../en/extensionArtifacts";
import { extensionArtifacts as ko } from "../ko/extensionArtifacts";
import { MESSAGES } from "../index";
import { createTranslator } from "@/i18n/translate";


function shape(value: object): unknown {
  return Object.fromEntries(Object.entries(value).map(([key, leaf]) => [key,
    typeof leaf === "string" ? [...leaf.matchAll(/\{([^}]+)\}/g)].map(match => match[1]).sort() : shape(leaf)]));
}
it("extensionArtifacts 사전의 키·매개변수·등록과 실제 상태 라벨을 검증한다", () => {
  expect(shape(ko)).toEqual(shape(en));
  expect(MESSAGES.en.extensionArtifacts).toBe(en);
  expect(MESSAGES.ko.extensionArtifacts).toBe(ko);
  expect(en.status).toEqual({"pending":"Generating artifact","succeeded":"Ready"});

  function check(value: object) {
    for (const child of Object.values(value)) {
      if (typeof child === "string") expect(child.trim().length).toBeGreaterThan(0);
      else check(child);
    }
  }
  check(en);
  check(ko);
});
it("extensionArtifacts의 소유 스캔 문구를 두 언어로 치환한다", () => {
  expect(createTranslator("en")("extensionArtifacts.sourceScan", { id: "saved-scan" })).toContain("saved-scan");
  expect(createTranslator("ko")("extensionArtifacts.sourceScan", { id: "saved-scan" })).toContain("saved-scan");
});
