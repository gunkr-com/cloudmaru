"use client";
import { pickText } from "@/i18n/translate";
import { useI18n } from "@/i18n/provider";
import type { JSX } from "react";
import { Button } from "@/components/ui/button";
import { EVALUATION_AXIS_LABELS, GRADE_LABELS } from "@/lib/artifacts/labels";
import type { EvaluationContent } from "@/types/artifact";

export type EvaluationViewProps = { content: EvaluationContent; downloadHref: string };

export function EvaluationView({ content, downloadHref }: EvaluationViewProps): JSX.Element {
  const { locale, t } = useI18n();
  return (
    <div className="min-w-0 space-y-5 text-sm leading-[1.7] text-body">
      <p>{pickText(content.summary, locale)}</p>
      <div className="relative w-full overflow-x-auto">
        <table className="w-full min-w-[680px] border-collapse text-left">
          <caption className="sr-only">{t("artifacts.evaluationName")}</caption>
          <thead className="border-b border-border-strong text-xs font-semibold tracking-[0.6px] text-subtle">
            <tr>
              <th scope="col" className="pb-3 pr-4 font-semibold">{t("artifacts.axis")}</th>
              <th scope="col" className="pb-3 pr-4 font-semibold">{t("artifacts.grade")}</th>
              <th scope="col" className="pb-3 pr-4 font-semibold">{t("artifacts.rationale")}</th>
              <th scope="col" className="pb-3 font-semibold">{t("artifacts.improvement")}</th>
            </tr>
          </thead>
          <tbody>
            {content.axes.map(({ axis, grade, rationale, improvement }) => (
              <tr className="border-b border-border-row last:border-b-0" key={axis}>
                <th scope="row" className="py-3 pr-4 align-top font-medium text-ink">{t(EVALUATION_AXIS_LABELS[axis])}</th>
                <td className="py-3 pr-4 align-top whitespace-nowrap text-ink">{t(GRADE_LABELS[grade])}</td>
                <td className="py-3 pr-4 align-top">{pickText(rationale, locale)}</td>
                <td className="py-3 align-top">{pickText(improvement, locale)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Button asChild variant="secondary"><a href={downloadHref} download>{t("artifacts.downloadEvaluation")}</a></Button>
    </div>
  );
}
