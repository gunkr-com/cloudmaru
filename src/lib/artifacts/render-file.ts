import { createTranslator, pickText } from "@/i18n/translate";
import { EVALUATION_AXIS_LABELS, GRADE_LABELS } from "@/lib/artifacts/labels";
import { TIER_LABELS } from "@/lib/analysis/input-schema";
import { formatQuantity } from "@/lib/cost/format";
import type { AnalysisResult } from "@/types/analysis";
import type { ArtifactContentMap, ArtifactFile, ArtifactKind } from "@/types/artifact";
import type { Tier } from "@/types/catalog";
import type { Locale } from "@/types/i18n";

const artifactNames: Record<ArtifactKind, string> = {
  guide: "guide.md",
  evaluation: "evaluation.md",
  bicep: "main.bicep",
};

function singleLine(value: string): string {
  return value.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
}

function renderGuide(content: ArtifactContentMap["guide"], result: AnalysisResult, tier: Tier, locale: Locale): string {
  const t = createTranslator(locale);
  const plan = result.plans.find(({ tier: planTier }) => planTier === tier)!;
  const services = plan.services.map((service) => `- ${pickText(service.name, locale)}: ${formatQuantity(service.quantity, service.unitLabel, locale)}`).join("\n");
  const steps = content.steps.map((step, index) => [
    `### ${index + 1}. ${singleLine(pickText(step.title, locale))}`,
    `**${t("artifacts.download.goal")}:** ${pickText(step.goal, locale)}`,
    ...step.instructions.map((instruction) => `- ${pickText(instruction, locale)}`),
    `**${t("artifacts.download.verification")}:** ${pickText(step.verification, locale)}`,
  ].join("\n\n")).join("\n\n");
  const sources = plan.referenceArchitecture.sources.map((source) => `- [${source.title}](${source.url})`).join("\n");
  return [
    `# ${t("artifacts.download.guideTitle", { requestTitle: singleLine(pickText(result.requestTitle, locale)), option: pickText(TIER_LABELS[tier], locale) })}`,
    `## ${t("artifacts.download.services")}`, services,
    `## ${t("artifacts.download.overview")}`, pickText(content.overview, locale),
    `## ${t("artifacts.download.prerequisites")}`, ...content.prerequisites.map((item) => `- ${pickText(item, locale)}`),
    `## ${t("artifacts.download.steps")}`, steps,
    `## ${t("artifacts.download.cautions")}`, content.cautions.length ? content.cautions.map((item) => `- ${pickText(item, locale)}`).join("\n") : t("artifacts.download.none"),
    `## ${t("artifacts.download.references")}`, sources,
  ].join("\n\n");
}

// 표 칸 안의 세로 막대와 줄바꿈은 Markdown 표를 깨뜨리므로 바꾼다.
function tableCell(value: string): string {
  return singleLine(value).replace(/\|/g, "\\|");
}

function renderEvaluation(content: ArtifactContentMap["evaluation"], locale: Locale): string {
  const t = createTranslator(locale);
  const rows = content.axes.map(({ axis, grade, rationale, improvement }) =>
    `| ${t(EVALUATION_AXIS_LABELS[axis])} | ${t(GRADE_LABELS[grade])} | ${tableCell(pickText(rationale, locale))} | ${tableCell(pickText(improvement, locale))} |`,
  );
  // 표의 행 사이에 빈 줄이 있으면 표로 렌더링되지 않는다.
  const table = [`| ${t("artifacts.download.pillar")} | ${t("artifacts.download.grade")} | ${t("artifacts.download.rationale")} | ${t("artifacts.download.improvement")} |`, "| --- | --- | --- | --- |", ...rows].join("\n");
  return [
    `# ${t("artifacts.download.evaluationTitle")}`,
    `## ${t("artifacts.download.summary")}`, pickText(content.summary, locale),
    `## ${t("artifacts.download.axes")}`,
    table,
  ].join("\n\n");
}

export function renderArtifactFile<K extends ArtifactKind>(
  kind: K,
  content: ArtifactContentMap[K],
  target: { result: AnalysisResult; tier: Tier },
  locale: Locale,
): ArtifactFile {
  const t = createTranslator(locale);
  const name = artifactNames[kind];
  const filename = `cloudsight-${target.tier}-${locale === "ko" && kind !== "bicep" ? name.replace(/\.md$/, ".ko.md") : name}`;
  if (kind === "bicep") {
    const bicep = content as ArtifactContentMap["bicep"];
    const heading = [
      `// ${t("artifacts.download.bicepDraft")}`,
      `// ${t("artifacts.download.bicepNotice")}`,
      `// ${t("artifacts.download.bicepContext", { requestTitle: singleLine(pickText(target.result.requestTitle, locale)), option: pickText(TIER_LABELS[target.tier], locale), priceAsOf: singleLine(target.result.priceAsOf) })}`,
    ].join("\n");
    return { filename, contentType: "text/plain; charset=utf-8", body: `${heading}\n${bicep.code}` };
  }
  if (kind === "guide") {
    return {
      filename,
      contentType: "text/markdown; charset=utf-8",
      body: renderGuide(content as ArtifactContentMap["guide"], target.result, target.tier, locale),
    };
  }
  return {
    filename,
    contentType: "text/markdown; charset=utf-8",
    body: renderEvaluation(content as ArtifactContentMap["evaluation"], locale),
  };
}
