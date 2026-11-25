import { describe, expect, it } from "vitest";
import { buildAnalysisResult } from "@/lib/analysis/build-result";
import sampleInput from "@/lib/analysis/fixtures/sample-input.json";
import sampleOutput from "@/lib/analysis/fixtures/sample-model-output.json";
import guide from "@/lib/artifacts/fixtures/sample-guide-output.json";
import evaluation from "@/lib/artifacts/fixtures/sample-evaluation-output.json";
import bicep from "@/lib/artifacts/fixtures/sample-bicep-output.json";
import { loadCatalog } from "@/lib/catalog/load";
import { renderArtifactFile } from "@/lib/artifacts/render-file";
import { validateArtifact } from "@/lib/artifacts/validate";
import { analysisInputSchema } from "@/lib/analysis/input-schema";
import { formatQuantity } from "@/lib/cost/format";
import type { AnalysisResult } from "@/types/analysis";
import type { GuideContent, EvaluationContent, BicepContent } from "@/types/artifact";

const catalog = loadCatalog();
const built = buildAnalysisResult(sampleOutput, analysisInputSchema.parse(sampleInput), catalog);
if (!built.ok) throw new Error(built.errors.join("\n"));
const target = { result: built.result, tier: "balanced" as const };

describe("renderArtifactFile", () => {
  it("Bicep 다운로드 머리말은 코드가 붙이고 원본 코드가 그대로 이어진다", () => {
    const file = renderArtifactFile("bicep", bicep as BicepContent, target, "ko");
    expect(file.filename).toBe("cloudsight-balanced-main.bicep");
    expect(file.filename).toMatch(/^[\x00-\x7F]+$/);
    expect(file.contentType).toBe("text/plain; charset=utf-8");
    expect(file.body.startsWith(`// 검증 전 초안 — CloudMaru가 생성한 Bicep 코드입니다.\n// bicep build와 배포 검증을 거치지 않았습니다. 배포 전에 반드시 검토하세요.\n// 분석: ${target.result.requestTitle.ko} / 균형 안 / 가격 기준일 ${target.result.priceAsOf}\n${bicep.code}`)).toBe(true);
    const newlineSafe: AnalysisResult = { ...target.result, requestTitle: { en: "Reservation", ko: "예약\n// 주입" } };
    const safe = renderArtifactFile("bicep", bicep as BicepContent, { ...target, result: newlineSafe }, "ko");
    expect(safe.body.split("\n").slice(0, 3).every((line) => line.startsWith("//"))).toBe(true);
  });

  it("구축 가이드는 단계와 카탈로그 참조 URL을 포함하며 다른 URL은 만들지 않는다", () => {
    const file = renderArtifactFile("guide", guide as GuideContent, target, "ko");
    expect(file.filename).toBe("cloudsight-balanced-guide.ko.md");
    expect(file.contentType).toBe("text/markdown; charset=utf-8");
    for (const step of guide.steps) expect(file.body).toContain(step.title.ko);
    for (const source of target.result.plans.find(({ tier }) => tier === "balanced")!.referenceArchitecture.sources) {
      expect(file.body).toContain(source.url);
    }
    expect([...file.body.matchAll(/https?:\/\/[^\s)]+/g)].map(([url]) => url)).toEqual(
      target.result.plans.find(({ tier }) => tier === "balanced")!.referenceArchitecture.sources.map(({ url }) => url),
    );
  });

  it("구축 가이드의 구성 서비스 수량은 화면과 같은 공용 수량 표기를 쓴다", () => {
    const plan = target.result.plans.find(({ tier }) => tier === "balanced")!;
    // 단위가 "10회"이던 때 저장된 결과는 붙여 쓰면 "10000010회"처럼 읽힌다.
    const legacy = { componentId: "functions-consumption-executions", name: { en: "예전 Functions 실행 횟수", ko: "예전 Functions 실행 횟수" }, quantity: 100000, unitLabel: { en: "10회", ko: "10회" } };
    const result: AnalysisResult = {
      ...target.result,
      plans: target.result.plans.map((item) => (item.tier === "balanced" ? { ...item, services: [...item.services, legacy] } : item)),
    };
    const body = renderArtifactFile("guide", guide as GuideContent, { result, tier: "balanced" }, "ko").body;
    for (const service of plan.services) {
      expect(body).toContain(`- ${service.name.ko}: ${formatQuantity(service.quantity, service.unitLabel, "ko")}\n`);
    }
    expect(body).toContain("- 예전 Functions 실행 횟수: 100,000 × 10회");
  });

  it("평가는 다섯 축 라벨과 상·중·하 등급을 표시한다", () => {
    const plan = target.result.plans.find(({ tier }) => tier === "balanced")!;
    const validated = validateArtifact("evaluation", evaluation, { plan, catalog, region: "canadacentral" });
    if (!validated.ok) throw new Error(validated.errors.join("\n"));
    const file = renderArtifactFile("evaluation", validated.content as EvaluationContent, target, "ko");
    expect(file.filename).toBe("cloudsight-balanced-evaluation.ko.md");
    for (const label of ["신뢰성", "보안", "비용", "운영", "성능"]) expect(file.body).toContain(label);
    expect(file.body).toMatch(/\| 상 \||\| 중 \||\| 하 \|/);
  });

  it("평가 표는 머리글부터 마지막 행까지 빈 줄 없이 이어져 Markdown 표로 렌더링된다", () => {
    const plan = target.result.plans.find(({ tier }) => tier === "balanced")!;
    const validated = validateArtifact("evaluation", evaluation, { plan, catalog, region: "canadacentral" });
    if (!validated.ok) throw new Error(validated.errors.join("\n"));
    const lines = renderArtifactFile("evaluation", validated.content as EvaluationContent, target, "ko").body.split("\n");
    const header = lines.indexOf("| 축 | 등급 | 근거 | 개선 제안 |");
    expect(header).toBeGreaterThan(-1);
    expect(lines.slice(header, header + 7).every((line) => line.startsWith("|"))).toBe(true);
  });

  it("평가 칸 안의 세로 막대와 줄바꿈은 표를 깨뜨리지 않게 바꾼다", () => {
    const content: EvaluationContent = {
      summary: { en: "Summary", ko: "요약" },
      axes: (["reliability", "security", "cost", "operations", "performance"] as const).map((axis) => ({
        axis, grade: "medium", rationale: { en: "A | B", ko: "A | B\n다음 줄" }, improvement: { en: "Improve", ko: "개선" },
      })),
    };
    const lines = renderArtifactFile("evaluation", content, target, "ko").body.split("\n");
    const rows = lines.filter((line) => line.startsWith("| 신뢰성"));
    expect(rows).toEqual(["| 신뢰성 | 중 | A \\| B 다음 줄 | 개선 |"]);
  });
});


describe.each(["en", "ko"] as const)("%s downloads", (locale) => {
  it("renders guide headings, every model field and catalog quantities in the selected language", () => {
    const file = renderArtifactFile("guide", guide as GuideContent, target, locale);
    expect(file.filename).toBe(`cloudsight-balanced-guide${locale === "ko" ? ".ko" : ""}.md`);
    const headings = locale === "en"
      ? [`# ${target.result.requestTitle.en} — Balanced option build guide`, "## Services in this option", "## Overview", "## Prerequisites", "## Build steps", "**Goal:**", "**Verification:**", "## Cautions", "## Reference architectures"]
      : [`# ${target.result.requestTitle.ko} — 균형 안 구축 가이드`, "## 구성 서비스", "## 개요", "## 사전 준비", "## 구축 단계", "**목적:**", "**확인 방법:**", "## 주의 사항", "## 참고한 참조 아키텍처"];
    for (const heading of headings) expect(file.body).toContain(heading);
    const fields = [guide.overview, ...guide.prerequisites, ...guide.cautions, ...guide.steps.flatMap((step) => [step.title, step.goal, ...step.instructions, step.verification])];
    for (const field of fields) expect(file.body).toContain(field[locale]);
    for (const service of target.result.plans.find(({ tier }) => tier === "balanced")!.services) {
      expect(file.body).toContain(`- ${service.name[locale]}: ${formatQuantity(service.quantity, service.unitLabel, locale)}`);
    }
    const empty = renderArtifactFile("guide", { ...guide, cautions: [] } as GuideContent, target, locale);
    expect(empty.body).toContain(locale === "en" ? "## Cautions\n\nNone" : "## 주의 사항\n\n없음");
    if (locale === "en") expect(file.body).not.toMatch(/[가-힣ㄱ-ㅎㅏ-ㅣ]/);
  });

  it("renders evaluation titles, table labels and escaped model text", () => {
    const plan = target.result.plans.find(({ tier }) => tier === "balanced")!;
    const validated = validateArtifact("evaluation", evaluation, { plan, catalog, region: "canadacentral" });
    if (!validated.ok) throw new Error(validated.errors.join("\n"));
    const content = validated.content as EvaluationContent;
    const file = renderArtifactFile("evaluation", content, target, locale);
    expect(file.filename).toBe(`cloudsight-balanced-evaluation${locale === "ko" ? ".ko" : ""}.md`);
    expect(file.body).toContain(locale === "en" ? "# Well-Architected five-pillar evaluation" : "# Well-Architected 5축 평가");
    expect(file.body).toContain(locale === "en" ? "## Summary" : "## 요약");
    expect(file.body).toContain(locale === "en" ? "## Evaluation by pillar" : "## 축별 평가");
    const header = locale === "en" ? "| Pillar | Grade | Rationale | Improvement |" : "| 축 | 등급 | 근거 | 개선 제안 |";
    const lines = file.body.split("\n");
    expect(lines).toContain(header);
    expect(lines.slice(lines.indexOf(header), lines.indexOf(header) + 7).every((line) => line.startsWith("|"))).toBe(true);
    for (const text of [content.summary, ...content.axes.flatMap((axis) => [axis.rationale, axis.improvement])]) expect(file.body).toContain(text[locale]);
    const axes = locale === "en" ? ["Reliability", "Security", "Cost", "Operations", "Performance"] : ["신뢰성", "보안", "비용", "운영", "성능"];
    for (const axis of axes) expect(file.body).toContain(`| ${axis} |`);
    const escaped = renderArtifactFile("evaluation", { summary: { en: "Summary", ko: "요약" }, axes: [{ axis: "reliability", grade: "medium", rationale: { en: "A | B\nNext line", ko: "A | B\n다음 줄" }, improvement: { en: "Improve", ko: "개선" } }] }, target, locale);
    expect(escaped.body).toContain(locale === "en" ? "| Reliability | Medium | A \\| B Next line | Improve |" : "| 신뢰성 | 중 | A \\| B 다음 줄 | 개선 |");
    if (locale === "en") expect(file.body).not.toMatch(/[가-힣ㄱ-ㅎㅏ-ㅣ]/);
  });

  it("adds a safe three-line draft header and preserves the shared Bicep code", () => {
    const file = renderArtifactFile("bicep", bicep as BicepContent, target, locale);
    expect(file.filename).toBe("cloudsight-balanced-main.bicep");
    const lines = file.body.split("\n");
    expect(lines[0]).toBe(locale === "en" ? "// Unverified draft — Bicep code generated by CloudMaru." : "// 검증 전 초안 — CloudMaru가 생성한 Bicep 코드입니다.");
    expect(lines[1]).toBe(locale === "en" ? "// This code has not been validated with bicep build or deployment validation. Review it before deploying." : "// bicep build와 배포 검증을 거치지 않았습니다. 배포 전에 반드시 검토하세요.");
    expect(lines[2]).toBe(locale === "en" ? `// Analysis: ${target.result.requestTitle.en} / Balanced option / Price as of ${target.result.priceAsOf}` : `// 분석: ${target.result.requestTitle.ko} / 균형 안 / 가격 기준일 ${target.result.priceAsOf}`);
    expect(lines.slice(3).join("\n")).toBe(bicep.code);
    const injected = { ...target.result, requestTitle: { en: "Reservation\nparam injected", ko: "예약\nparam injected" }, priceAsOf: "2026-11-07\nparam injected" };
    const safe = renderArtifactFile("bicep", bicep as BicepContent, { ...target, result: injected }, locale);
    expect(safe.body.split("\n").slice(3).join("\n")).toBe(bicep.code);
    if (locale === "en") expect(file.body).not.toMatch(/[가-힣ㄱ-ㅎㅏ-ㅣ]/);
  });
});
