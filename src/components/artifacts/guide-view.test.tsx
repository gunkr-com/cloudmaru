import { renderWithI18n as render } from "@/test/render-with-i18n";
import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { buildAnalysisResult } from "@/lib/analysis/build-result";
import { validateArtifact } from "@/lib/artifacts/validate";
import sampleInput from "@/lib/analysis/fixtures/sample-input.json";
import sampleModel from "@/lib/analysis/fixtures/sample-model-output.json";
import guideFixture from "@/lib/artifacts/fixtures/sample-guide-output.json";
import { loadCatalog } from "@/lib/catalog/load";
import type { GuideContent } from "@/types/artifact";
import type { AnalysisInput } from "@/types/analysis";
import { GuideView } from "@/components/artifacts/guide-view";

const catalog = loadCatalog();
const built = buildAnalysisResult(sampleModel, sampleInput as AnalysisInput, catalog);
if (!built.ok) throw new Error(built.errors.join("; "));
const plan = built.result.plans.find(({ tier }) => tier === "balanced")!;
const validated = validateArtifact("guide", guideFixture, { plan, catalog, region: "canadacentral" });
if (!validated.ok) throw new Error(validated.errors.join("; "));
const content = validated.content as GuideContent;

describe("GuideView", () => {
  it("개요와 단계, 카탈로그 서비스 이름, 다운로드 링크를 표시한다", () => {
    render(<GuideView content={content} services={plan.services} downloadHref="/download/guide" />);
    expect(screen.getByText(content.overview.ko)).toBeInTheDocument();
    const titles = screen.getAllByRole("heading", { level: 4 }).filter(({ textContent }) => content.steps.some(({ title }) => title.ko === textContent));
    expect(titles.map(({ textContent }) => textContent)).toEqual(content.steps.map(({ title }) => title.ko));
    const service = plan.services[0];
    expect(screen.getAllByText(service.name.ko).length).toBeGreaterThan(0);
    expect(screen.queryByText("not-in-catalog")).not.toBeInTheDocument();
    const codeInstruction = content.steps.flatMap(({ instructions }) => instructions).find((line) => line.ko.startsWith("az "));
    if (codeInstruction) expect(screen.getByText(codeInstruction.ko, { selector: "code" })).toBeInTheDocument();
    else {
      const commandContent = { ...content, steps: [{ ...content.steps[0], instructions: [{ en: "az webapp list", ko: "az webapp list" }] }] };
      const { unmount } = render(<GuideView content={commandContent} services={plan.services} downloadHref="/download/guide" />);
      expect(screen.getByText("az webapp list", { selector: "code" })).toBeInTheDocument();
      unmount();
    }
    const link = screen.getByRole("link", { name: "가이드 내려받기 (Markdown)" });
    expect(link).toHaveAttribute("href", "/download/guide");
    expect(link).toHaveAttribute("download");
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });

  it("주의 사항이 없으면 제목을 표시하지 않고 모르는 서비스 ID를 건너뛴다", () => {
    const modified = { ...content, cautions: [], steps: [{ ...content.steps[0], componentIds: ["not-in-catalog"] }] };
    render(<GuideView content={modified} services={plan.services} downloadHref="/download/guide" />);
    expect(screen.queryByRole("heading", { name: "주의 사항" })).not.toBeInTheDocument();
    expect(screen.queryByText("not-in-catalog")).not.toBeInTheDocument();
    expect(within(screen.getByRole("list", { name: "사전 준비" })).getAllByRole("listitem")).toHaveLength(content.prerequisites.length);
  });
});

it("renders English model content and UI", () => {
render(<GuideView content={content} services={plan.services} downloadHref="/download/guide" />, { locale: "en" });
expect(screen.getByRole("heading", { name: "Prerequisites" })).toBeInTheDocument();
expect(screen.getByRole("link", { name: "Download guide (Markdown)" })).toBeInTheDocument();
expect(screen.getByText(content.overview.en)).toBeInTheDocument();
});

it("shows English guide steps, instructions, preparation and cautions", () => {
  render(<GuideView content={content} services={plan.services} downloadHref="/download/guide" />, { locale: "en" });
  for (const item of [...content.prerequisites, ...content.cautions]) expect(screen.getByText(item.en)).toBeInTheDocument();
  for (const step of content.steps) {
    expect(screen.getByRole("heading", { name: step.title.en })).toBeInTheDocument();
    expect(screen.getByText(step.goal.en)).toBeInTheDocument();
    expect(screen.getByText(step.verification.en, { exact: false })).toBeInTheDocument();
    for (const item of step.instructions) expect(screen.getByText(item.en)).toBeInTheDocument();
  }
});
