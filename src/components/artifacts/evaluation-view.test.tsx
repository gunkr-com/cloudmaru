import { renderWithI18n as render } from "@/test/render-with-i18n";
import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { buildAnalysisResult } from "@/lib/analysis/build-result";
import { validateArtifact } from "@/lib/artifacts/validate";
import sampleInput from "@/lib/analysis/fixtures/sample-input.json";
import sampleModel from "@/lib/analysis/fixtures/sample-model-output.json";
import evaluationFixture from "@/lib/artifacts/fixtures/sample-evaluation-output.json";
import { loadCatalog } from "@/lib/catalog/load";
import type { EvaluationContent } from "@/types/artifact";
import type { AnalysisInput } from "@/types/analysis";
import { EvaluationView } from "@/components/artifacts/evaluation-view";

const catalog = loadCatalog();
const built = buildAnalysisResult(sampleModel, sampleInput as AnalysisInput, catalog);
if (!built.ok) throw new Error(built.errors.join("; "));
const plan = built.result.plans.find(({ tier }) => tier === "balanced")!;
const validated = validateArtifact("evaluation", evaluationFixture, { plan, catalog, region: "canadacentral" });
if (!validated.ok) throw new Error(validated.errors.join("; "));
const content = validated.content as EvaluationContent;

describe("EvaluationView", () => {
  it("축 순서, 글자 등급, 근거와 개선 제안을 표로 표시한다", () => {
    render(<EvaluationView content={content} downloadHref="/download/evaluation" />);
    expect(screen.getByText(content.summary.ko)).toBeInTheDocument();
    const table = screen.getByRole("table");
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows.map((row) => within(row).getByRole("rowheader").textContent)).toEqual(["신뢰성", "보안", "비용", "운영", "성능"]);
    expect(rows.map((row) => within(row).getAllByRole("cell")[0].textContent)).toEqual(["중", "중", "상", "중", "중"]);
    for (const axis of content.axes) {
      expect(screen.getByText(axis.rationale.ko)).toBeInTheDocument();
      expect(screen.getByText(axis.improvement.ko)).toBeInTheDocument();
    }
    const link = screen.getByRole("link", { name: "평가 내려받기 (Markdown)" });
    expect(link).toHaveAttribute("href", "/download/evaluation");
    expect(link).toHaveAttribute("download");
  });
});

it("renders English model content and UI", () => {
render(<EvaluationView content={content} downloadHref="/download/evaluation" />, { locale: "en" });
expect(screen.getByRole("rowheader", { name: "Reliability" })).toBeInTheDocument();
expect(screen.getByRole("link", { name: "Download evaluation (Markdown)" })).toBeInTheDocument();
expect(screen.getByText(content.summary.en)).toBeInTheDocument();
});

it("shows English axis explanations", () => {
  render(<EvaluationView content={content} downloadHref="/download/evaluation" />, { locale: "en" });
  for (const axis of content.axes) {
    expect(screen.getByText(axis.rationale.en)).toBeInTheDocument();
    expect(screen.getByText(axis.improvement.en)).toBeInTheDocument();
  }
});
