import { expect, it } from "vitest";
import { network as en } from "../en/network";
import { network as ko } from "../ko/network";
import { MESSAGES } from "../index";
import { createTranslator } from "@/i18n/translate";
import type { NetworkEngineResult } from "@/types/network-diagnostics";

function shape(value: object): unknown {
  return Object.fromEntries(Object.entries(value).map(([key, leaf]) => [key,
    typeof leaf === "string" ? [...leaf.matchAll(/\{([^}]+)\}/g)].map(match => match[1]).sort() : shape(leaf)]));
}
it("network 사전의 키·매개변수·등록과 실제 상태 라벨을 검증한다", () => {
  expect(shape(ko)).toEqual(shape(en));
  expect(MESSAGES.en.network).toBe(en);
  expect(MESSAGES.ko.network).toBe(ko);
  expect(en.status).toEqual({"pending":"Checking path","succeeded":"Completed","failed":"Failed"});
  expect(en.verdict).toEqual({"allowed":"Allowed","blocked":"Blocked","unknown":"Unknown"});
  const verdicts: Record<NetworkEngineResult["verdict"], string> = en.verdict;
  expect(Object.keys(verdicts)).toHaveLength(3);
  function check(value: object) {
    for (const child of Object.values(value)) {
      if (typeof child === "string") expect(child.trim().length).toBeGreaterThan(0);
      else check(child);
    }
  }
  check(en);
  check(ko);
});
it("network의 소유 스캔 문구를 두 언어로 치환한다", () => {
  expect(createTranslator("en")("network.sourceScan", { id: "saved-scan" })).toContain("saved-scan");
  expect(createTranslator("ko")("network.sourceScan", { id: "saved-scan" })).toContain("saved-scan");
});
it("localizes every structured engine reason in both languages",async()=>{
 const {networkReasonCodeSchema}=await import("@/lib/completion/schema");
 expect(Object.keys(en.reasons).sort()).toEqual([...networkReasonCodeSchema.options].sort());
 expect(Object.keys(ko.reasons).sort()).toEqual([...networkReasonCodeSchema.options].sort());
 for(const code of networkReasonCodeSchema.options){
  expect(createTranslator("en")(`network.reasons.${code}`)).not.toBe(code);
  expect(createTranslator("ko")(`network.reasons.${code}`)).toMatch(/[가-힣]/);
 }
});

it("uses a distinct action label for loading a baseline in each language", () => {
  expect(createTranslator("en")("network.loadBaseline")).toBe("Load baseline scan");
  expect(createTranslator("ko")("network.loadBaseline")).toBe("기준 스캔 불러오기");
});
