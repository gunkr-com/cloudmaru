"use client";
import { useI18n } from "@/i18n/provider";
import type { JSX } from "react";

export type JourneyStep = "input" | "compare" | "build";
export type JourneyStepsProps = { current: JourneyStep };

const steps: ReadonlyArray<{ id: JourneyStep; label: "analysis.requirementsStep" | "analysis.compareStep" | "analysis.buildStep" }> = [
  { id: "input", label: "analysis.requirementsStep" },
  { id: "compare", label: "analysis.compareStep" },
  { id: "build", label: "analysis.buildStep" },
];

export function JourneySteps({ current }: JourneyStepsProps): JSX.Element {
  const { t } = useI18n();
  return (
    <ol aria-label={t("analysis.journeyLabel")} className="flex flex-wrap items-center gap-x-2 text-xs">
      {steps.map((step, index) => (
        <li key={step.id} aria-current={current === step.id ? "step" : undefined} className="flex items-center gap-2">
          <span className={current === step.id ? "font-semibold text-ink" : "text-subtle"}>{t(step.label)}</span>
          {index < steps.length - 1 && <span aria-hidden="true" className="text-subtle">→</span>}
        </li>
      ))}
    </ol>
  );
}
