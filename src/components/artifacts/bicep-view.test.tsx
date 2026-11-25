import { renderWithI18n as render } from "@/test/render-with-i18n";
import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { buildAnalysisResult } from "@/lib/analysis/build-result";
import { validateArtifact } from "@/lib/artifacts/validate";
import sampleInput from "@/lib/analysis/fixtures/sample-input.json";
import sampleModel from "@/lib/analysis/fixtures/sample-model-output.json";
import bicepFixture from "@/lib/artifacts/fixtures/sample-bicep-output.json";
import { loadCatalog } from "@/lib/catalog/load";
import type { BicepContent } from "@/types/artifact";
import type { AnalysisInput } from "@/types/analysis";
import { BicepView } from "@/components/artifacts/bicep-view";

const catalog = loadCatalog();
const built = buildAnalysisResult(sampleModel, sampleInput as AnalysisInput, catalog);
if (!built.ok) throw new Error(built.errors.join("; "));
const plan = built.result.plans.find(({ tier }) => tier === "balanced")!;
const validated = validateArtifact("bicep", bicepFixture, { plan, catalog, region: "canadacentral" });
if (!validated.ok) throw new Error(validated.errors.join("; "));
const content = validated.content as BicepContent;

describe("BicepView", () => {
  it("초안 고지, 안전한 원문 코드, 매개변수와 다운로드를 표시한다", () => {
    render(<BicepView content={content} downloadHref="/download/bicep" />);
    const pre = screen.getByLabelText("Bicep 코드");
    expect(pre.tagName).toBe("PRE");
    expect(pre).toHaveAttribute("tabindex", "0");
    expect(pre.textContent).toBe(content.code);
    expect(screen.getAllByText("검증 전 초안")[0].compareDocumentPosition(pre) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText("Bicep 코드는 검증 전 초안으로 제공됩니다.")).toBeInTheDocument();
    expect(pre.querySelector("script")).toBeNull();
    const download = screen.getByRole("link", { name: "main.bicep 내려받기" });
    expect(download).toHaveAttribute("href", "/download/bicep");
    expect(download).toHaveAttribute("download");
    expect(within(download.parentElement!).getByText("검증 전 초안")).toBeInTheDocument();
    for (const parameter of content.parameters) {
      expect(screen.getByText(parameter.name)).toBeInTheDocument();
      expect(screen.getByText(parameter.description.ko)).toBeInTheDocument();
    }
  });

  it("코드 안의 script 문자열을 텍스트로만 렌더한다", () => {
    const unsafeLooking = { ...content, code: `${content.code}\n// <script>alert(1)</script>` };
    render(<BicepView content={unsafeLooking} downloadHref="/download/bicep" />);
    expect(screen.getByLabelText("Bicep 코드").textContent).toBe(unsafeLooking.code);
    expect(screen.getByLabelText("Bicep 코드").querySelector("script")).toBeNull();
  });
});

it("renders English model content and UI", () => {
render(<BicepView content={content} downloadHref="/download/bicep" />, { locale: "en" });
expect(screen.getAllByText("Unverified draft")).toHaveLength(2);
expect(screen.getByRole("link", { name: "Download main.bicep" })).toBeInTheDocument();
expect(screen.getByLabelText("Bicep code").textContent).toBe(content.code);
});

it("shows English parameter descriptions and deployment notes", () => {
  render(<BicepView content={content} downloadHref="/download/bicep" />, { locale: "en" });
  for (const parameter of content.parameters) expect(screen.getByText(parameter.description.en)).toBeInTheDocument();
  for (const note of content.deploymentNotes) expect(screen.getByText(note.en)).toBeInTheDocument();
});
