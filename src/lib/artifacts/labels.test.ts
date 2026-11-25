import { createTranslator } from "@/i18n/translate";
const t = createTranslator("ko");
import { describe, expect, it } from "vitest";
import { ARTIFACT_KINDS, ARTIFACT_LABELS, BICEP_DRAFT_LABEL, BICEP_DRAFT_NOTICE, EVALUATION_AXIS_LABELS, GRADE_LABELS } from "@/lib/artifacts/labels";

describe("artifact labels", () => {
  it("결과물 종류, 평가 축, 등급을 빠짐없이 라벨링한다", () => {
    expect(ARTIFACT_KINDS).toEqual(["guide", "evaluation", "bicep"]);
    expect(Object.keys(ARTIFACT_LABELS).sort()).toEqual([...ARTIFACT_KINDS].sort());
    expect(Object.keys(EVALUATION_AXIS_LABELS).sort()).toEqual(["reliability", "security", "cost", "operations", "performance"].sort());
    expect(Object.values(EVALUATION_AXIS_LABELS).map((key) => t(key))).toEqual(["신뢰성", "보안", "비용", "운영", "성능"]);
    expect(Object.values(GRADE_LABELS).map((key) => t(key)).sort()).toEqual(["상", "중", "하"].sort());
    expect(t(BICEP_DRAFT_LABEL)).toBe("검증 전 초안");
    expect(t(BICEP_DRAFT_NOTICE)).toContain(t(BICEP_DRAFT_LABEL));
  });
});
